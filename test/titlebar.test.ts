import { expect, test } from "bun:test";
import { titleBarView } from "../src/titlebar";
import { withLife, loadLife, closeLife, type ViewLife } from "../src/life";
import { compileView } from "../src/compiler";

test("titlebar declarations compile into owned lifecycle setup", () => {
  const { code } = compileView(`
    export const titleBar = { enabled: true };
    export default () => <main>Hello</main>;
  `, { id: "/app/example.tsx" });
  expect(code).toContain("titleBarView as __titleBar");
  expect(code).toContain("__titleBar(titleBar)");
});

test("overlapping owners restore in order even with pending host calls", async () => {
  const previous = globalThis.window;
  const calls: boolean[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  globalThis.window = { luon: { setTitlebar: async (value: boolean) => {
    calls.push(value);
    if (calls.length === 1) await pending;
  } } } as any;
  try {
    const parent: ViewLife = { load: [], close: [] };
    const child: ViewLife = { load: [], close: [] };
    withLife(parent, () => titleBarView({ enabled: true }));
    withLife(child, () => titleBarView({ enabled: false }));
    loadLife(parent);
    await Promise.resolve(); await Promise.resolve();
    loadLife(child);
    closeLife(child);
    closeLife(parent);
    release();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(calls).toEqual([true, false, true, false]);
  } finally { globalThis.window = previous; }
});
