import { effect, untrack } from "@luon/act";
import { currentLife } from "./life.ts";

export type Persist<Data> = Record<string, readonly (keyof Data & string)[]>;
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
  const groups = Object.entries(rules);
  for (const [key, fields] of groups) {
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
  // Restore every group before attaching effects or invoking View callbacks.
  for (const [key, fields] of groups) {
    try {
      const text = storage.getItem(prefix + encodeURIComponent(key));
      if (!text) continue;
      const value: unknown = JSON.parse(text);
      if (!plain(value)) continue;
      for (const field of fields) {
        if (!Object.hasOwn(value, field)) continue;
        if (data[field] != null && kind(data[field]) !== kind(value[field]))
          continue;
        try {
          const restored = json(value[field]);
          (data as Record<string, unknown>)[field] = restored;
        } catch {
          /* Keep the initial field when its saved value is invalid. */
        }
      }
    } catch {
      /* Unavailable storage or malformed JSON keeps initial values. */
    }
  }
  for (const [key, fields] of groups) {
    let previous: string | undefined;
    const stop = effect(() => {
      try {
        const value: Record<string, unknown> = Object.create(null);
        for (const field of fields) {
          if (data[field] !== undefined) value[field] = json(data[field]);
        }
        const text = JSON.stringify(value);
        if (text === previous) return;
        untrack(() => storage.setItem(prefix + encodeURIComponent(key), text));
        previous = text;
      } catch {
        /* Quota and non-JSON values never interrupt memory state. */
      }
    });
    life.close.push(stop);
  }
}
