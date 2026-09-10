import { batch, state, untrack, type Child, type Read } from "@luon/act";
import { currentLife } from "./life.ts";
import { liveView } from "./reactive.ts";

type Rule<Value = unknown> = {
  load(context: { signal: AbortSignal }): Value | PromiseLike<Value>;
};
export type Resource<Value> = {
  readonly status: "pending" | "ready" | "error";
  readonly value: Value | undefined;
  readonly error: unknown;
  reload(): Promise<void>;
};
export type Resources<Rules extends Record<string, Rule>> = {
  [Name in keyof Rules]: Resource<Awaited<ReturnType<Rules[Name]["load"]>>>;
};

export function resourceView<Rules extends Record<string, Rule>>(
  rules: Rules,
): Resources<Rules> {
  const life = currentLife();
  if (!life || life.closed) throw new Error("Resources require an active View.");
  const result: Record<string, Resource<unknown>> = {};
  for (const [name, rule] of Object.entries(rules)) {
    if (typeof rule.load !== "function") {
      throw new TypeError(`resource.${name}.load must be a function.`);
    }
    const data = state({ status: "pending" as Resource<unknown>["status"],
      value: undefined as unknown, error: undefined as unknown });
    let generation = 0;
    let controller: AbortController | undefined;
    const reload = async () => {
      if (life.closed) return;
      const token = ++generation;
      controller?.abort();
      controller = new AbortController();
      batch(() => { data.status = "pending"; data.error = undefined; });
      try {
        const value = await untrack(() => rule.load({
          signal: controller!.signal,
        }));
        if (life.closed || token !== generation) return;
        batch(() => { data.value = value; data.status = "ready"; });
      } catch (error) {
        if (life.closed || token !== generation) return;
        batch(() => { data.error = error; data.status = "error"; });
      }
    };
    result[name] = Object.freeze({
      get status() { return data.status; },
      get value() { return data.value; },
      get error() { return data.error; },
      reload,
    });
    life.load.push(() => { void reload(); });
    life.close.push(() => { generation++; controller?.abort(); });
  }
  return result as Resources<Rules>;
}

export function Await<Value>(props: {
  value: Resource<Value> | Read<Resource<Value>>;
  pending?: () => Child;
  error?: (error: unknown) => Child;
  children?: (value: Value) => Child;
}): Read<Child> {
  return liveView(() => {
    const source = props.value;
    const resource = "__act" in source ? source.read() : source;
    if (resource.status === "pending") return props.pending?.();
    if (resource.status === "error") return props.error?.(resource.error);
    return props.children?.(resource.value as Value);
  });
}
