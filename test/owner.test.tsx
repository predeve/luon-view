/** @jsxImportSource @luon/view */
import { expect, test } from "bun:test";
import { mount } from "@luon/act";
import { Window } from "happy-dom";
import {
  componentView, computedView, effectView, liveView, memoView,
  namedView, onClose, onLoad, state, ViewError, watchView,
} from "../src/index.ts";

const window = new Window();
Object.assign(globalThis, { window, document: window.document,
  Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  Event: window.Event });

function host() {
  const node = document.createElement("div");
  document.body.append(node);
  return node;
}

test("render helpers own subscriptions and cleanup for each render", async () => {
  const data = state({ page: 0, value: 1 });
  const calls: string[] = [];
  let computed = 0;
  const helper = () => {
    const page = data.page;
    onLoad(() => {
      calls.push(`load ${page}`);
      onClose(() => calls.push(`late close ${page}`));
    });
    onClose(() => calls.push(`close ${page}`));
    effectView(() => { calls.push(`effect ${page}:${data.value}`); });
    const value = memoView(() => { computed++; return data.value * 2; });
    return <p>{liveView(() => value())}<b>{liveView(() => value())}</b></p>;
  };
  const Demo = componentView("Helper", () => ({ render: helper }));
  const node = host();
  const close = mount(<Demo />, node);
  await Promise.resolve();
  expect(computed).toBe(1);
  data.value++;
  expect(computed).toBe(2);
  expect(node.textContent).toBe("44");
  data.page++;
  await Promise.resolve();
  expect(calls).toContain("close 0");
  const count = calls.length;
  data.value++;
  expect(calls.slice(count)).toEqual(["effect 1:3"]);
  close(); close();
  expect(calls.filter(v => v === "close 1")).toHaveLength(1);
  expect(calls).toContain("late close 1");
  const ended = calls.length;
  data.value++;
  expect(calls).toHaveLength(ended);
  node.remove();
});

test("cleanup continues after errors and removes DOM and named subscriptions", () => {
  const node = host();
  const data = state({ n: 1 });
  let effects = 0;
  let closes = 0;
  const Named = namedView("Named", () => {
    effectView(() => { void data.n; effects++; });
    onClose(() => closes++);
    return <i>Named</i>;
  });
  const Demo = componentView("Closing", () => ({ render: () => {
    onClose(() => { throw Error("close failed"); });
    return <div><Named /></div>;
  } }));
  const close = mount(<Demo />, node);
  expect(() => close()).toThrow("close failed");
  expect(node.childNodes.length).toBe(0);
  expect(closes).toBe(1);
  data.n++;
  expect(effects).toBe(1);
  node.remove();
});

test("setup/render failure releases subscriptions and includes source context", () => {
  const node = host();
  const data = state({ n: 1 });
  let effects = 0;
  let closed = 0;
  const cause = Error("bad cell");
  const Demo = componentView("Broken", () => {
    effectView(() => { void data.n; effects++; });
    onClose(() => closed++);
    return { render: () => { throw cause; } };
  }, undefined, { file: "app/broken.view.tsx" });
  let error: unknown;
  try { mount(<Demo />, node); } catch (value) { error = value; }
  expect(error).toBeInstanceOf(ViewError);
  expect((error as ViewError).cause).toBe(cause);
  expect((error as ViewError).frames[0]).toEqual({
    file: "app/broken.view.tsx", view: "Broken", phase: "render",
  });
  expect(node.childNodes.length).toBe(0);
  expect(closed).toBe(1);
  data.n++;
  expect(effects).toBe(1);
  node.remove();
});

test("computed caches per instance and opt-out getters remain live", () => {
  const data = state({ n: 2 });
  let plain = 1;
  let calls = 0;
  const computed = computedView({
    doubled: () => { calls++; return data.n * 2; },
    plain: { cache: false, get: () => plain },
    number: { get: () => data.n, set: (n: number) => { data.n = n; } },
  });
  expect(computed.doubled()).toBe(4);
  expect(computed.doubled()).toBe(4);
  expect(calls).toBe(1);
  expect(computed.number(3)).toBe(3);
  expect(computed.doubled()).toBe(6);
  expect(computed.plain()).toBe(1);
  plain++;
  expect(computed.plain()).toBe(2);
});

test("watch tracks queued updates after load and stops after removal", async () => {
  const data = state({ n: 1 });
  const calls: number[] = [];
  const Demo = componentView("Watch", () => {
    watchView(data, { n: (value) => { calls.push(value); } });
    return { render: () => <p>Watch</p> };
  });
  const node = host();
  const close = mount(<Demo />, node);
  await Promise.resolve(); await Promise.resolve();
  data.n = 2;
  await Promise.resolve();
  data.n = 3;
  await Promise.resolve();
  expect(calls).toEqual([2, 3]);
  close();
  data.n = 4;
  await Promise.resolve();
  expect(calls).toEqual([2, 3]);
  node.remove();
});

test("later updates and computed errors preserve their original cause", () => {
  const data = state({ fail: false });
  const cause = Error("query failed");
  const Demo = componentView("Query", () => {
    const computed = computedView({ rows: () => {
      if (data.fail) throw cause;
      return "Ready";
    } });
    return { render: () => <p>{liveView(() => computed.rows())}</p> };
  }, undefined, { file: "app/query.tsx" });
  const node = host();
  const close = mount(<Demo />, node);
  let error: any;
  try { data.fail = true; } catch (value) { error = value; }
  expect(error).toBeInstanceOf(ViewError);
  expect(error.frames.some((frame: any) => frame.phase === "computed.rows"))
    .toBeTrue();
  expect(error.frames.every((frame: any) => frame.file === "app/query.tsx"))
    .toBeTrue();
  while (error.cause) error = error.cause;
  expect(error).toBe(cause);
  close(); node.remove();
});

test("async event errors keep their phase after await", async () => {
  const { currentLife, lifeCall } = await import("../src/life.ts");
  let run: () => unknown = () => {};
  const Demo = componentView("Async", () => {
    const life = currentLife()!;
    run = () => lifeCall(life, "event.save", async () => {
      await Promise.resolve();
      throw Error("save failed");
    });
    return { render: () => <p>Async</p> };
  }, undefined, { file: "app/async.tsx" });
  const node = host();
  const close = mount(<Demo />, node);
  let error: any;
  try { await run(); } catch (value) { error = value; }
  expect(error).toBeInstanceOf(ViewError);
  expect(error.frames[0].phase).toBe("event.save");
  expect(error.cause.message).toBe("save failed");
  close(); node.remove();
});
