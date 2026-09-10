import { visibleGate } from "./gate.ts";
import { currentLife, lifeCall, type ViewLife } from "./life.ts";

type Cancel = () => void;
type Callback = () => unknown;

export type TimerRule = {
  active?: boolean;
  run: Callback;
} & (
  | { interval: number; timeout?: never }
  | { timeout: number; interval?: never }
);

export type TimerControl = {
  readonly active: boolean;
  start(): void;
  stop(): void;
};

export type Timers<Rules extends Record<string, TimerRule>> = {
  readonly [Name in keyof Rules]: TimerControl;
};

function validDelay(delay: number) {
  if (!Number.isFinite(delay) || delay < 0 || delay > 2_147_483_647) {
    throw new RangeError("Timer delay must be 0..2147483647 milliseconds.");
  }
}

function control(life: ViewLife, name: string, rule: TimerRule) {
  const repeat = rule.interval !== undefined;
  const delay = (repeat ? rule.interval : rule.timeout)!;
  const clear = repeat ? clearInterval : clearTimeout;
  const run = rule.run;
  let wanted = rule.active !== false;
  let active = false;
  let running = false;
  let generation = 0;
  let handle: ReturnType<typeof setTimeout>;
  const stop = () => {
    wanted = false;
    active = false;
    generation++;
    clear(handle);
  };
  const start = () => {
    if (life.closed || active) return;
    wanted = true;
    active = true;
    const token = ++generation;
    const tick = () => {
      if (life.closed || !active || token !== generation) return;
      if (!visibleGate(life.gate)) {
        if (!repeat) stop();
        return;
      }
      if (!repeat) stop();
      if (running) return;
      running = true;
      let async = false;
      try {
        const value = lifeCall(life, `timer.${name}`, run);
        if (value && typeof (value as PromiseLike<unknown>).then
          === "function") {
          async = true;
          return Promise.resolve(value).finally(() => { running = false; });
        }
        return value;
      } finally {
        if (!async) running = false;
      }
    };
    handle = repeat ? setInterval(tick, delay) : setTimeout(tick, delay);
  };
  life.load.push(() => { if (wanted) start(); });
  life.close.push(stop);
  return Object.freeze({ get active() { return active; }, start, stop });
}

/** Compiler entry: bind named timers to the owning View instance. */
export function timerView<Rules extends Record<string, TimerRule>>(
  rules: Rules,
): Timers<Rules> {
  const life = currentLife();
  if (!life || life.closed) {
    throw new Error("Timer declarations require an active View.");
  }
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
    throw new TypeError("Timer declarations require an object.");
  }
  const entries = Object.entries(rules);
  for (const [name, rule] of entries) {
    if (!rule || typeof rule !== "object" || typeof rule.run !== "function"
      || (rule.interval === undefined) === (rule.timeout === undefined)
      || (rule.active !== undefined && typeof rule.active !== "boolean")) {
      throw new TypeError(`timer.${name} requires run, one interval or `
        + "timeout, and an optional boolean active.");
    }
    validDelay((rule.interval ?? rule.timeout)!);
  }
  return Object.freeze(Object.fromEntries(entries.map(([name, rule]) =>
    [name, control(life, name, rule)]))) as Timers<Rules>;
}

function schedule(kind: "timeout" | "interval", run: Callback, delay: number) {
  const life = currentLife();
  if (!life || life.closed) {
    throw new Error("View timers require an active View. Register during "
      + "setup, render, load, or an event callback, before await.");
  }
  if (typeof run !== "function") {
    throw new TypeError("A View timer requires a callback.");
  }
  validDelay(delay);
  const repeat = kind === "interval";
  const clear = repeat ? clearInterval : clearTimeout;
  let active = true;
  let handle: ReturnType<typeof setTimeout>;
  const cancel: Cancel = () => {
    if (!active) return;
    active = false;
    clear(handle);
    const index = life.close.indexOf(cancel);
    if (index >= 0) life.close.splice(index, 1);
  };
  const tick = () => {
    if (!active) return;
    if (life.closed) return cancel();
    if (!visibleGate(life.gate)) {
      if (!repeat) cancel();
      return;
    }
    if (!repeat) cancel();
    return lifeCall(life, `timer.${kind}`, run);
  };
  handle = repeat ? setInterval(tick, delay) : setTimeout(tick, delay);
  life.close.push(cancel);
  return cancel;
}

/** Timers owned by the current View scope; each call returns a cancel function. */
export const timer = Object.freeze({
  timeout: (run: Callback, delay: number): Cancel =>
    schedule("timeout", run, delay),
  interval: (run: Callback, delay: number): Cancel =>
    schedule("interval", run, delay),
});
