import { effect, mount, untrack, type Child, type Read } from "@luon/act";
import { currentGate, withGate, type Gate } from "./gate.ts";
import { currentLife } from "./life.ts";

type Value<Type> = Type | Read<Type>;
function read<Type>(value: Value<Type>): Type {
  return value && typeof value === "object" && "__act" in value
    ? (value as Read<Type>).read() : value as Type;
}

export function KeepAlive(props: {
  cacheKey: Value<string | number>;
  max?: Value<number>;
  children?: Child | (() => Child);
}): Child {
  const life = currentLife();
  if (!life || life.closed) throw new Error("KeepAlive requires an active View.");
  const host = document.createElement("div");
  host.style.display = "contents";
  const entries = new Map<string | number, {
    node: HTMLDivElement; gate: Gate; close: () => void;
  }>();
  const parent = currentGate() || life.gate;
  const stop = effect(() => {
    const key = read(props.cacheKey);
    const max = props.max === undefined ? 2 : read(props.max);
    if ((typeof key !== "string" && typeof key !== "number")
      || (typeof key === "number" && !Number.isFinite(key))) {
      throw new TypeError("KeepAlive cacheKey must be a string or finite number.");
    }
    if (!Number.isSafeInteger(max) || max < 1) {
      throw new RangeError("KeepAlive max must be a positive integer.");
    }
    untrack(() => {
      for (const [id, entry] of entries) {
        entry.gate.active = id === key;
        entry.node.hidden = id !== key;
        entry.node.style.display = id === key ? "contents" : "none";
      }
      let entry = entries.get(key);
      if (!entry) {
        const node = document.createElement("div");
        node.style.display = "contents";
        const gate: Gate = { active: true, parent };
        host.append(node);
        try {
          const close = withGate(gate, () => {
            const source = props.children;
            const child = typeof source === "function" ? source()
              : source && typeof source === "object"
              && "__act" in source ? (source as Read<Child>).read() : source;
            return mount(child, node);
          });
          entry = { node, gate, close };
        } catch (error) { node.remove(); throw error; }
      }
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > max) {
        const id = entries.keys().next().value!;
        const old = entries.get(id)!;
        entries.delete(id);
        old.gate.active = false;
        try { old.close(); } finally { old.node.remove(); }
      }
    });
  });
  life.close.push(() => {
    stop();
    const errors: unknown[] = [];
    for (const entry of entries.values()) {
      entry.gate.active = false;
      try { entry.close(); } catch (error) { errors.push(error); }
      finally { entry.node.remove(); }
    }
    entries.clear();
    if (errors.length) throw new AggregateError(errors, "KeepAlive cleanup failed.");
  });
  return host;
}
