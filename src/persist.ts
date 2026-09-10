import { batch, effect, untrack } from "@luon/act";
import { currentLife } from "./life.ts";

type Fields<Data> = readonly (keyof Data & string)[];
export type Persist<Data> = Record<
  string,
  | Fields<Data>
  | {
      fields: Fields<Data>;
      expire?: number;
    }
>;

function duration(value: unknown): number | undefined {
  if (value === undefined) return;
  const time = typeof value === "number" ? value * 1000 : NaN;
  if (
    !Number.isSafeInteger(value) ||
    !Number.isSafeInteger(time) ||
    time <= 0
  ) {
    throw new TypeError(
      "Persist expire must be a positive integer in seconds.",
    );
  }
  return time;
}
const unsafe = new Set(["__proto__", "constructor", "prototype"]);

function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function json(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!Array.isArray(value) && !plain(value)) {
    throw new TypeError("Persist values must be JSON data.");
  }
  if (seen.has(value)) throw new TypeError("Persist values cannot be cyclic.");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => json(item, seen));
    const output: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value)) {
      if (!unsafe.has(key)) output[key] = json(value[key], seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function kind(value: unknown) {
  return value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : typeof value;
}

/** Restore and save selected state fields for the current View. */
export function persistView<Data extends Record<string, unknown>>(
  data: Data,
  rules: Persist<Data>,
  scope: string,
) {
  const life = currentLife();
  if (!life || life.closed) {
    throw new Error("Persist must be created inside an active View.");
  }
  const used = new Set<string>();
  const groups = Object.entries(rules).map(([key, rule]) => {
    const options = rule as { fields: Fields<Data>; expire?: number };
    return {
      key,
      fields: Array.isArray(rule) ? rule : options.fields,
      time: duration(Array.isArray(rule) ? undefined : options.expire),
      saved: undefined as string | undefined,
      skip: false,
      stamp: 0,
      defaults: {} as Record<string, unknown>,
    };
  });
  for (const { key, fields } of groups) {
    if (!key || !Array.isArray(fields) || !fields.length) {
      throw new TypeError("Persist requires named, nonempty field arrays.");
    }
    for (const field of fields) {
      if (
        typeof field !== "string" ||
        unsafe.has(field) ||
        !Object.hasOwn(data, field) ||
        used.has(field)
      ) {
        throw new TypeError(`Invalid or repeated persist field: ${field}`);
      }
      used.add(field);
    }
  }
  let storage: Storage;
  let base = "/";
  try {
    storage = globalThis.localStorage;
    if (!storage) return;
    const href = globalThis.document
      ?.querySelector("base[href]")
      ?.getAttribute("href");
    if (href) base = new URL(href, globalThis.location.href).pathname;
  } catch {
    return;
  }
  const prefix =
    `luon:persist:${encodeURIComponent(base)}:` +
    `${encodeURIComponent(scope)}:`;
  const snapshot = (fields: readonly string[]) => {
    const value: Record<string, unknown> = Object.create(null);
    for (const field of fields) {
      if (data[field] !== undefined) value[field] = json(data[field]);
    }
    return value;
  };
  // Restore every group before attaching effects or invoking View callbacks.
  for (const group of groups) {
    const { key, fields, time } = group;
    for (const field of fields) {
      try {
        group.defaults[field] = json(data[field]);
      } catch {
        group.defaults[field] = data[field];
      }
    }
    try {
      const name = prefix + encodeURIComponent(key);
      const text = storage.getItem(name);
      if (!text) continue;
      const raw: unknown = JSON.parse(text);
      const stamped =
        Array.isArray(raw) &&
        raw.length === 3 &&
        raw[0] === 1 &&
        Number.isSafeInteger(raw[1]) &&
        raw[1] >= 0 &&
        plain(raw[2]);
      const value = stamped ? raw[2] : raw;
      if (!plain(value)) continue;
      group.stamp = stamped ? raw[1] : 0;
      if (
        time !== undefined &&
        (!stamped || Date.now() - group.stamp >= time)
      ) {
        group.skip = true;
        storage.removeItem(name);
        continue;
      }
      for (const field of fields) {
        if (!Object.hasOwn(value, field)) continue;
        if (data[field] != null && kind(data[field]) !== kind(value[field]))
          continue;
        try {
          (data as Record<string, unknown>)[field] = json(value[field]);
        } catch {
          /* Keep the initial field for invalid saved values. */
        }
      }
      group.saved = text;
      group.skip = true;
    } catch {
      /* Unavailable storage or malformed JSON keeps initial values. */
    }
  }
  for (const group of groups) {
    const { key, fields, time } = group;
    const name = prefix + encodeURIComponent(key);
    let previous: string | undefined;
    let muted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (time === undefined || !group.saved || life.closed) return;
      const remaining = time - (Date.now() - group.stamp);
      timer = setTimeout(
        () => {
          if (life.closed) return;
          if (Date.now() - group.stamp < time) return arm();
          try {
            // An older instance must not remove a newer instance's saved value.
            if (storage.getItem(name) === group.saved) storage.removeItem(name);
          } catch {
            /* Expiry still resets memory if storage is unavailable. */
          }
          group.saved = undefined;
          muted = true;
          try {
            batch(() => {
              for (const field of fields) {
                const value = group.defaults[field];
                let initial = value;
                try {
                  initial = json(value);
                } catch {
                  /* Non-JSON default. */
                }
                (data as Record<string, unknown>)[field] = initial;
              }
            });
          } finally {
            muted = false;
          }
        },
        Math.max(0, Math.min(remaining, 2147483647)),
      );
    };
    const stop = effect(() => {
      try {
        const value = snapshot(fields);
        const text = JSON.stringify(value);
        if (muted || group.skip) {
          previous = text;
          group.skip = false;
          return;
        }
        if (text === previous) return;
        const stamp = Date.now();
        const saved = JSON.stringify([1, stamp, value]);
        untrack(() => storage.setItem(name, saved));
        group.stamp = stamp;
        group.saved = saved;
        previous = text;
        arm();
      } catch {
        /* Quota and non-JSON values never interrupt memory state. */
      }
    });
    arm();
    life.close.push(() => {
      stop();
      clearTimeout(timer);
    });
  }
}
