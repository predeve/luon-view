import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import { mount, type Child } from "@luon/act";
import { compileView } from "../src/compiler.ts";
const dom = new Window({ url: "http://localhost" });
Object.assign(globalThis, { document: dom.document, window: dom,
  Node: dom.Node, Element: dom.Element, HTMLElement: dom.HTMLElement,
  Event: dom.Event, getComputedStyle: dom.getComputedStyle.bind(dom) });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function fixture(source: string) {
  await mkdir(resolve("luon-temp"), { recursive: true });
  const dir = await mkdtemp(resolve("luon-temp/view-features-"));
  const path = resolve(dir, "demo.js");
  await Bun.write(path, compileView(source, { id: path }).code);
  const mod = await import(path);
  const root = document.createElement("main");
  document.body.append(root);
  let close: () => void;
  try { close = mount(mod.default({}) as Child, root); }
  catch (error) { root.remove(); await rm(dir, { recursive: true }); throw error; }
  await tick();
  return { root, async close() {
    close(); root.remove(); await rm(dir, { recursive: true });
  } };
}

test("compiled resources retry, ignore stale results, and abort on close", async () => {
  const requests: Array<{ signal: AbortSignal; resolve(v: string): void;
    reject(e: Error): void }> = [];
  (globalThis as any).loadProfile = ({ signal }: { signal: AbortSignal }) =>
    new Promise<string>((resolve, reject) => {
      requests.push({ signal, resolve, reject });
    });
  const app = await fixture(`
    import { Await } from "@luon/view";
    export const resource = {
      profile: { load: (ctx) => globalThis.loadProfile(ctx) },
    };
    export default () => <div>
      <button onClick={() => resource.profile.reload()}>Reload</button>
      <Await value={resource.profile} pending={() => <p>Waiting</p>}
        error={(error) => <p>{error.message}</p>}>
        {(value) => <p>{value}</p>}
      </Await>
    </div>;
  `);
  try {
    expect(app.root.textContent).toContain("Waiting");
    app.root.querySelector("button")!.click();
    expect(requests[0]!.signal.aborted).toBe(true);
    requests[0]!.resolve("stale");
    requests[1]!.resolve("fresh");
    await tick();
    expect(app.root.textContent).toContain("fresh");
    expect(app.root.textContent).not.toContain("stale");
    app.root.querySelector("button")!.click();
    requests[2]!.reject(new Error("Offline"));
    await tick();
    expect(app.root.textContent).toContain("Offline");
    app.root.querySelector("button")!.click();
  } finally { await app.close(); }
  expect(requests.at(-1)!.signal.aborted).toBe(true);
  delete (globalThis as any).loadProfile;
});

test("KeepAlive preserves nodes, gates events and evicts the oldest entry", async () => {
  const app = await fixture(`
    import { KeepAlive, componentView, eventView, liveView, state }
      from "@luon/view";
    import { jsx } from "@luon/view/jsx-runtime";
    const Page = componentView("Page", () => {
      const data = state({ count: 0 });
      const events = eventView({ window: { resize() { data.count++; } } });
      return { load: events.load, close: events.close,
        render: () => jsx("input", { value: liveView(() => data.count) }) };
    });
    export const data = { tab: 0 };
    export default () => <div>
      <button id="next" onClick={() => data.tab++}>Next</button>
      <button id="first" onClick={() => data.tab = 0}>First</button>
      <KeepAlive cacheKey={data.tab} max={2}><Page /></KeepAlive>
    </div>;
  `);
  const active = () => [...app.root.querySelectorAll("input")]
    .find(node => !node.closest("[hidden]"))!;
  try {
    const first = active();
    window.dispatchEvent(new Event("resize"));
    expect(first.value).toBe("1");
    app.root.querySelector<HTMLButtonElement>("#next")!.click();
    await tick();
    window.dispatchEvent(new Event("resize"));
    expect(first.value).toBe("1");
    expect(active().value).toBe("1");
    app.root.querySelector<HTMLButtonElement>("#first")!.click();
    await tick();
    expect(active() === first).toBe(true);
    app.root.querySelector<HTMLButtonElement>("#next")!.click();
    app.root.querySelector<HTMLButtonElement>("#next")!.click();
    await tick();
    expect(first.isConnected).toBe(false);
    app.root.querySelector<HTMLButtonElement>("#first")!.click();
    await tick();
    expect(active() === first).toBe(false);
    expect(active().value).toBe("0");
  } finally { await app.close(); }
});

test("fade delays removal and owner cleanup cancels pending animations", async () => {
  const pending: Array<() => void> = [];
  const original = dom.Element.prototype.animate;
  dom.Element.prototype.animate = (() => {
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    pending.push(finish);
    return { finished, cancel: finish };
  }) as any;
  let app: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    app = await fixture(`
      export const data = { open: true };
      export default () => <div>
        <button onClick={() => data.open = !data.open}>Toggle</button>
        {data.open && <aside transition={{ effect: "fade", duration: 180 }}>
          Notice
        </aside>}
      </div>;
    `);
    pending.shift()?.();
    await tick();
    app.root.querySelector("button")!.click();
    expect(app.root.querySelector("aside")).not.toBeNull();
    pending.shift()?.();
    await tick();
    expect(app.root.querySelector("aside")).toBeNull();
    app.root.querySelector("button")!.click();
    await tick();
    app.root.querySelector("button")!.click();
    await app.close(); app = undefined;
    await tick();
    expect(document.querySelector("aside")).toBeNull();
  } finally {
    await app?.close();
    dom.Element.prototype.animate = original;
  }
});

test("compiled API integrates with resource reload and closes its requests", async () => {
  const original = globalThis.fetch;
  const requests: Array<{ signal: AbortSignal; resolve(value: Response): void }>
    = [];
  globalThis.fetch = ((_url: unknown, init: RequestInit) =>
    new Promise<Response>(resolve => {
      requests.push({ signal: init.signal!, resolve });
    })) as typeof fetch;
  const app = await fixture(`
    import { Await } from "@luon/view";
    export const api = { profile: { url: "/profile" } };
    export const resource = {
      profile: { load: ({ signal }) => api.profile(undefined, { signal }) },
    };
    export default () => <div>
      <button onClick={() => resource.profile.reload()}>Reload</button>
      <Await value={resource.profile} pending={() => <p>Waiting</p>}>
        {(value) => <p>{value.name}</p>}
      </Await>
    </div>;
  `);
  try {
    app.root.querySelector("button")!.click();
    expect(requests[0]!.signal.aborted).toBe(true);
    requests[0]!.resolve(Response.json({ name: "Stale" }));
    requests[1]!.resolve(Response.json({ name: "Luon" }));
    await tick();
    expect(app.root.textContent).toContain("Luon");
    expect(app.root.textContent).not.toContain("Stale");
    app.root.querySelector("button")!.click();
  } finally {
    await app.close();
    globalThis.fetch = original;
    for (const request of requests) request.resolve(Response.json({}));
  }
  expect(requests.at(-1)!.signal.aborted).toBe(true);
});
