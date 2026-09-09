import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { timer, timerView, type TimerRule } from "../src/timer.ts";
import { componentView } from "../src/view.ts";
import type { Read, Child } from "@luon/act";
import {
  closeLife, currentLife, loadLife, withLife, type ViewLife,
} from "../src/life.ts";
import { ViewError } from "../src/error.ts";

type Task = { run: () => unknown; repeat: boolean };
const tasks = new Map<number, Task>();
let next = 0;
let spies: Array<{ mockRestore(): void }> = [];
function life(): ViewLife {
  return { close: [], load: [], frame: {
    file: "app/timer.tsx", view: "Timer", phase: "setup",
  } };
}
function flush() {
  for (const [id, task] of [...tasks]) {
    if (!tasks.has(id)) continue;
    if (!task.repeat) tasks.delete(id);
    task.run();
  }
}
beforeEach(() => {
  const start = (repeat: boolean) => (run: () => unknown) => {
    const id = ++next;
    tasks.set(id, { run, repeat });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  const clear = (id: unknown) => { tasks.delete(Number(id)); };
  spies = [
    spyOn(globalThis, "setTimeout").mockImplementation(start(false) as any),
    spyOn(globalThis, "setInterval").mockImplementation(start(true) as any),
    spyOn(globalThis, "clearTimeout").mockImplementation(clear),
    spyOn(globalThis, "clearInterval").mockImplementation(clear),
  ];
});
afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  tasks.clear();
});

test("closing one owner leaves other Views and native timers running", () => {
  const first = life(), second = life();
  const count = { first: 0, second: 0, native: 0 };
  withLife(first, () => timer.interval(() => count.first++, 10));
  withLife(second, () => timer.interval(() => count.second++, 10));
  const native = setInterval(() => count.native++, 10);
  flush();
  closeLife(first);
  closeLife(first);
  flush();
  expect(count).toEqual({ first: 1, second: 2, native: 2 });
  closeLife(second);
  flush();
  expect(count).toEqual({ first: 1, second: 2, native: 3 });
  clearInterval(native);
});

test("manual cancellation and completed timeouts release cleanup entries", () => {
  const owner = life();
  let count = 0;
  const cancel = withLife(owner, () => timer.interval(() => count++, 10));
  const late = [...tasks.values()][0]!.run;
  cancel(); cancel(); late();
  expect(owner.close).toHaveLength(0);
  withLife(owner, () => timer.timeout(() => count++, 10));
  flush(); flush();
  expect(count).toBe(1);
  expect(owner.close).toHaveLength(0);
  closeLife(owner);
  expect(tasks.size).toBe(0);
});

test("closing suppresses callbacks already queued and survives cleanup errors", () => {
  const owner = life();
  let count = 0;
  withLife(owner, () => timer.timeout(() => count++, 10));
  const late = [...tasks.values()][0]!.run;
  owner.close.push(() => { throw Error("cleanup failed"); });
  expect(() => closeLife(owner)).toThrow("cleanup failed");
  late(); flush();
  expect(count).toBe(0);
  expect(tasks.size).toBe(0);
});

test("nested timers inherit the callback owner, never a different View", () => {
  const owner = life(), other = life();
  withLife(owner, () => timer.timeout(() => {
    expect(currentLife()).toBe(owner);
    timer.interval(() => {}, 10);
  }, 10));
  withLife(other, flush);
  expect(owner.close).toHaveLength(1);
  expect(other.close).toHaveLength(0);
  closeLife(owner);
  expect(tasks.size).toBe(0);
});

test("registration without an owner, after await, or after close is rejected", async () => {
  expect(() => timer.timeout(() => {}, 10)).toThrow("active View");
  const owner = life();
  await withLife(owner, async () => {
    await Promise.resolve();
    expect(() => timer.interval(() => {}, 10)).toThrow("before await");
  });
  closeLife(owner);
  expect(() => withLife(owner, () => timer.timeout(() => {}, 10)))
    .toThrow("active View");
  expect(tasks.size).toBe(0);
});

test("invalid delays allocate no timer", () => {
  const owner = life();
  for (const delay of [-1, Infinity, NaN, 2_147_483_648]) {
    expect(() => withLife(owner, () => timer.timeout(() => {}, delay)))
      .toThrow("milliseconds");
  }
  expect(tasks.size).toBe(0);
  expect(owner.close).toHaveLength(0);
});

test("callback failures retain View context, including async rejection", async () => {
  const owner = life();
  const cause = Error("tick failed");
  withLife(owner, () => timer.timeout(() => { throw cause; }, 10));
  let error: any;
  try { flush(); } catch (value) { error = value; }
  expect(error).toBeInstanceOf(ViewError);
  expect(error.frames[0].phase).toBe("timer.timeout");
  expect(error.cause).toBe(cause);
  withLife(owner, () => timer.timeout(async () => {
    await Promise.resolve(); throw cause;
  }, 10));
  const task = [...tasks.values()][0]!;
  await expect(task.run()).rejects.toBeInstanceOf(ViewError);
  expect(owner.close).toHaveLength(0);
  closeLife(owner);
});


test("render replacement cancels render timers and preserves setup timers", () => {
  const count = { setup: 0, old: 0, next: 0 };
  let render = 0;
  const View = componentView("Timer", () => {
    timer.interval(() => count.setup++, 10);
    return { render: () => {
      const key = render++ === 0 ? "old" : "next";
      timer.interval(() => count[key]++, 10);
      return null;
    } };
  });
  const view = View({}) as Read<Child>;
  view.read(); flush();
  view.read(); flush();
  expect(count).toEqual({ setup: 2, old: 1, next: 1 });
  view.dispose?.();
  flush();
  expect(count).toEqual({ setup: 2, old: 1, next: 1 });
  expect(tasks.size).toBe(0);
});

test("failed View setup releases timers before propagating the error", () => {
  const View = componentView("Failed", () => {
    timer.interval(() => {}, 10);
    throw Error("setup failed");
  });
  expect(() => View({})).toThrow("setup failed");
  expect(tasks.size).toBe(0);
});

test("declarations start on load and isolate instances from native timers", () => {
  const a = life(), b = life();
  let calls = 0;
  const rules = { poll: { interval: 10, run: () => calls++ } };
  const first = withLife(a, () => timerView(rules));
  const second = withLife(b, () => timerView(rules));
  expect(tasks.size).toBe(0);
  loadLife(a); loadLife(b);
  first.poll.start(); first.poll.start();
  expect(tasks.size).toBe(2);
  flush();
  closeLife(a);
  first.poll.start();
  flush();
  expect(calls).toBe(3);
  expect(first.poll.active).toBe(false);
  expect(second.poll.active).toBe(true);
  closeLife(b);
  expect(tasks.size).toBe(0);
});

test("bound controls work after await but cannot revive a closed View", async () => {
  const owner = life();
  let calls = 0;
  const value = withLife(owner, () => timerView({
    poll: { interval: 10, active: false, run: () => calls++ },
  }));
  loadLife(owner);
  expect(tasks.size).toBe(0);
  await Promise.resolve();
  value.poll.start();
  const stale = [...tasks.values()][0]!.run;
  value.poll.stop(); value.poll.stop(); value.poll.start();
  stale();
  expect(calls).toBe(0);
  flush();
  expect(calls).toBe(1);
  closeLife(owner);
  await Promise.resolve();
  value.poll.start(); stale(); flush();
  expect(calls).toBe(1);
  expect(tasks.size).toBe(0);
});

test("stop before load disables auto start and timeouts can restart", () => {
  const owner = life();
  let calls = 0;
  const value = withLife(owner, () => timerView({
    once: { timeout: 10, run: () => calls++ },
  }));
  value.once.stop(); loadLife(owner);
  expect(tasks.size).toBe(0);
  value.once.start(); flush(); flush();
  expect(value.once.active).toBe(false);
  expect(calls).toBe(1);
  value.once.start(); flush();
  expect(calls).toBe(2);
  closeLife(owner);
});

test("async runs skip overlap even across stop and start", async () => {
  const owner = life();
  let calls = 0;
  let done!: () => void;
  const value = withLife(owner, () => timerView({
    poll: { interval: 10, run: async () => {
      calls++;
      await new Promise<void>(resolve => { done = resolve; });
    } },
  }));
  loadLife(owner);
  const pending = [...tasks.values()][0]!.run();
  flush(); value.poll.stop(); value.poll.start(); flush();
  expect(calls).toBe(1);
  done(); await pending;
  const next = [...tasks.values()][0]!.run();
  expect(calls).toBe(2);
  closeLife(owner);
  done(); await next;
  expect(tasks.size).toBe(0);
});

test("invalid declarations do not partially register lifecycle callbacks", () => {
  const owner = life();
  const invalid = [
    { interval: 10, timeout: 10, run() {} },
    { run() {} }, { timeout: -1, run() {} },
    { timeout: 10, active: "yes", run() {} },
    { interval: 10, run: null },
  ];
  for (const rule of invalid) {
    expect(() => withLife(owner, () => timerView({
      valid: { interval: 10, run() {} }, invalid: rule as TimerRule,
    }))).toThrow();
  }
  expect(owner.close).toHaveLength(0);
  expect(owner.load).toHaveLength(0);
});

test("named callback failures retain context and release the busy state", async () => {
  const owner = life();
  const cause = Error("poll failed");
  let calls = 0;
  withLife(owner, () => timerView({
    poll: { interval: 10, async run() { calls++; throw cause; } },
  }));
  loadLife(owner);
  const task = [...tasks.values()][0]!;
  for (let index = 0; index < 2; index++) {
    try { await task.run(); } catch (error) {
      expect(error).toBeInstanceOf(ViewError);
      expect((error as ViewError).frames[0]!.phase).toBe("timer.poll");
      expect((error as Error).cause).toBe(cause);
    }
  }
  expect(calls).toBe(2);
  closeLife(owner);
});
