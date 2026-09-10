import { currentGate, withGate, type Gate } from "./gate.ts";
import { traceView, ViewError, type ViewFrame } from "./error.ts";

export type ViewLife = {
  gate?: Gate;
  close: Array<() => void>;
  load: Array<() => void>;
  frame?: ViewFrame;
  closed?: boolean;
  loaded?: boolean;
};

let active: ViewLife | undefined;

export function currentLife() {
  return active;
}

export function withLife<Value>(life: ViewLife, run: () => Value) {
  const previous = active;
  active = life;
  try {
    return run();
  } finally {
    active = previous;
  }
}

export function runLife<Value>(
  life: ViewLife, phase: string, run: () => Value,
): Value {
  const call = () => withGate(currentGate() || life.gate,
    () => withLife(life, run));
  return life.frame ? traceView({ ...life.frame, phase }, call) : call();
}

export function lifeCall(
  life: ViewLife, phase: string, run: () => unknown,
) {
  const value = runLife(life, phase, run);
  if (value && typeof (value as PromiseLike<unknown>).then === "function") {
    return Promise.resolve(value).catch((cause) => {
      if (life.frame) throw new ViewError(cause, { ...life.frame, phase });
      throw cause;
    });
  }
  return value;
}

export function closeLife(life: ViewLife) {
  if (life.closed) return;
  life.closed = true;
  const errors: unknown[] = [];
  for (const run of life.close.splice(0).reverse()) {
    try { lifeCall(life, "close", run); }
    catch (error) { errors.push(error); }
  }
  life.load.length = 0;
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "View cleanup failed.");
}

export function loadLife(life: ViewLife) {
  if (life.loaded || life.closed) return;
  life.loaded = true;
  for (const run of life.load.splice(0)) lifeCall(life, "load", run);
}

export function addLife(name: "load" | "close", run: () => void) {
  if (!active || active.closed) {
    throw new Error(`Luon ${name} must be registered inside an active View. `
      + "Call it synchronously during setup, render, or load, before await.");
  }
  if (name === "load" && active.loaded) {
    throw new Error("Register onLoad during View setup or render, before load.");
  }
  active[name].push(run);
}
