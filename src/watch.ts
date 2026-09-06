import { effect } from "@luon/act";

import { addLife, currentLife, lifeCall, runLife } from "./life.ts";

type Clean = (callback: () => void) => void;

export type WatchRun = (
  value: any,
  previous: any,
  clean: Clean,
) => unknown;

export type WatchRule = {
  deep?: boolean;
  flush?: "post" | "pre" | "sync";
  immediate?: boolean;
  once?: boolean;
  run: WatchRun;
  source?: () => unknown;
};

export type WatchDefs = Record<string, WatchRule | WatchRun>;

function statePath(data: Record<string, any>, path: string) {
  return path.split("_").reduce((value, name) => value?.[name], data);
}

function copy(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value.getTime();
  const found = seen.get(value);
  if (found) return found;
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(value, output);
    value.forEach((item) => output.push(copy(item, seen)));
    return output;
  }
  const output: Record<string, unknown> = {};
  seen.set(value, output);
  for (const [name, item] of Object.entries(value)) {
    output[name] = copy(item, seen);
  }
  return output;
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object"
    || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)
      || left.length !== right.length) return false;
    return left.every((item, index) => equal(item, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((name) => (
      Object.hasOwn(right, name)
      && equal(
        (left as Record<string, unknown>)[name],
        (right as Record<string, unknown>)[name],
      )
    ));
}

function same(left: unknown, right: unknown, deep = false) {
  if (deep) return equal(left, right);
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return Object.is(left, right);
  }
  return left.length === right.length
    && left.every((item, index) => Object.is(item, right[index]));
}

function watchRule(
  data: Record<string, any>,
  path: string,
  input: WatchRule | WatchRun,
) {
  const life = currentLife();
  const rule = typeof input === "function" ? { run: input } : input;
  const source = rule.source || (() => statePath(data, path));
  let cleanup: (() => void) | undefined;
  let current: unknown;
  let snapshot: unknown;
  let queued = false;
  let stopped = true;
  let onceDone = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = () => {};

  const value = () => {
    const next = source();
    return {
      next,
      snapshot: rule.deep || Array.isArray(next) ? copy(next) : next,
    };
  };
  const close = () => {
    const run = cleanup;
    cleanup = undefined;
    if (run) {
      if (life) lifeCall(life, `watch.${path}.cleanup`, run);
      else run();
    }
  };
  const run = (next: unknown, previous: unknown) => {
    close();
    const execute = () => rule.run(next, previous, (callback) => {
      if (stopped) callback();
      else cleanup = callback;
    });
    if (life) lifeCall(life, `watch.${path}`, execute);
    else execute();
    if (rule.once) {
      onceDone = true;
      stopped = true;
      stop();
    }
  };
  const check = () => {
    queued = false;
    if (stopped) return;
    const next = value();
    if (same(snapshot, next.snapshot, rule.deep)) return;
    const previous = current;
    current = next.next;
    snapshot = next.snapshot;
    run(current, previous);
  };
  const schedule = () => {
    if (stopped || queued) return;
    if (rule.flush === "sync") return check();
    queued = true;
    if (rule.flush === "post") {
      timer = setTimeout(check, 0);
    } else {
      queueMicrotask(check);
    }
  };
  const load = () => {
    if (!stopped || onceDone) return;
    stopped = false;
    const initial = value();
    current = initial.next;
    snapshot = initial.snapshot;
    stop = effect(() => {
      // Read dependencies synchronously; queue only the callback comparison.
      if (life) runLife(life, `watch.${path}.source`, value);
      else value();
      schedule();
    });
    if (rule.immediate) run(current, undefined);
  };
  const finish = () => {
    stopped = true;
    stop();
    stop = () => {};
    queued = false;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    close();
  };
  addLife("load", load);
  addLife("close", finish);
}

export function watchView(data: Record<string, any>, definitions: WatchDefs) {
  for (const [path, rule] of Object.entries(definitions)) {
    watchRule(data, path, rule);
  }
}
