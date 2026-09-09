import { describe, expect, test } from "bun:test";

import { CompileError, compileView } from "../src/compiler.ts";

describe("compileView", () => {
  test("binds timer declarations inside each default View setup", () => {
    const code = compileView(`
      export default () => <p />;
      export const timer = {
        refresh: { interval: 1000, run() { timer.refresh.stop(); } },
      };
    `).code;
    expect(code).toContain("timerView as __timer");
    expect(code.indexOf("const timer = __timer("))
      .toBeGreaterThan(code.indexOf("export default __component("));
    expect(code).toContain('"timer.refresh"');
    expect(() => compileView(`
      export const timer = [];
      export default () => <p />;
    `)).toThrow("object literal");
    expect(() => compileView(`
      export const timer = {};
      export function Named() { return <p />; }
    `)).toThrow("requires a default View");
  });

  test("transforms reserved exports and bind options", () => {
    const source = `
      import type { ReactNode } from "react";
      export type Props = { children?: ReactNode };
      export const config = { mode: "test" };
      export const data = { name: "Luon", open: false, tools: ["bun"] };
      export const computed = {
        title: () => data.name,
        open: { get: () => data.open, set: (value: boolean) => data.open = value },
      };
      export const watch = {
        name: { immediate: true, run: () => undefined },
      };
      export const event = {
        load() { data.name += "!"; },
        close() {},
      };
      export default ({ children }: Props) => (
        <main>
          <input bind={data.name} clean="trim" update="input" />
          <Field bindName={data.name} bindOpen={computed.open} />
          <select multiple bind={data.tools}>{children}</select>
        </main>
      );
    `;
    const code = compileView(source, { id: "/app/user-profile.tsx" }).code;

    expect(code).toContain("export const config = { mode: \"test\" }");
    expect(code).toContain("const data = __state");
    expect(code).toContain("const computed = __computed");
    expect(code).toContain("__watch(data, watch)");
    expect(code).toContain("__events.load()");
    expect(code).toContain("__events.close()");
    expect(code).toContain("clean: \"trim\"");
    expect(code).toContain("update: \"input\"");
    expect(code).toContain("tag: \"component\", name: \"name\"");
    expect(code).toContain("tag: \"component\", name: \"open\"");
    expect(code).toContain("() => computed.open()");
    expect(code).toContain("__value => computed.open(__value)");
    expect(code).toContain("multiple: true");
    expect(code).toContain("export default __component(\"UserProfile\"");
    expect(code).toContain("(props) => {");
  });

  test("isolates reactive native props and children as Act reads", () => {
    const code = compileView(`
      export const data = { count: 0, shown: false };
      export default () => <button
        aria-label={data.shown ? "Hide" : "Show"}
        onClick={() => data.count++}
      >{data.count}</button>;
    `, { id: "/app/counter.tsx" }).code;

    expect(code).toContain('"aria-label": __live(() => data.shown');
    expect(code).toContain("children: __live(() => data.count)");
    expect(code).not.toContain("onClick: __live");
  });

  test("supports a default function declaration", () => {
    const source = `
      export default function Card(props: { title: string }) {
        return <h1>{props.title}</h1>;
      }
    `;
    const code = compileView(source, { id: "/app/Card.tsx" }).code;

    expect(code).toContain("const __view = function Card(props)");
    expect(code).toContain("export default __component(\"Card\"");
  });

  test("supports scoped styles declared after the default view", () => {
    const code = compileView(`
      export default () => <main class={[style.box, "p-4"]} />;
      export const style = {
        main: { width: 100 },
        box: { opacity: 0.8 },
      };
      const { box } = style;
    `, { id: "/app/pages/index.tsx" }).code;

    expect(code).toContain("styleView as __style");
    expect(code).toContain("const __styleSource = __styleState");
    expect(code).toContain("const style = __styleSource.rules");
    expect(code).toContain("const styles = style");
    expect(code).toContain("let __styles = __style(__styleScope");
    expect(code).toContain("__styleId, false");
    expect(code).toContain("const __refreshStyles = () =>");
    expect(code).toContain("render: (__props) => {");
    expect(code).toContain("__refreshStyles();");
    expect(code).toContain('"data-luon-s":');
    expect(code).toContain("const { box } = __styles");
    expect(code).toContain("__styles.box");
  });

  test("applies dynamic element styles on every render", () => {
    const code = compileView(`
      export const data = { open: true };
      export default () => <main style={{ color: "red" }}>Content</main>;
      export const style = {
        main: () => ({
          opacity: data.open ? 1 : 0,
          width: data.open ? 720 : 480,
        }),
      };
    `, { id: "/app/pages/dynamic.tsx" }).code;

    expect(code).toContain("dynamicView as __dynamic");
    expect(code).toContain("style: __dynamic(__styles.main, { color: \"red\" })");
    expect(code).toContain("width: data.open ? 720 : 480");
  });

  test("refreshes direct style values on every render", () => {
    const code = compileView(`
      export const data = { open: true };
      export default () => <main>Content</main>;
      export const style = {
        main: {
          opacity: data.open ? 1 : 0,
          width: data.open ? 720 : 480,
        },
      };
    `, { id: "/app/pages/reactive-style.tsx" }).code;

    expect(code).toContain("opacity: data.open ? 1 : 0");
    expect(code).toContain("__styles = __style(__styleScope");
    expect(code).toContain("__styleId, true");
    expect(code).toContain("__refreshStyles();");
    expect(code).toContain("class: __styles.main");
  });

  test("keeps style rules mutable while applying generated classes", () => {
    const code = compileView(`
      export const style = {
        main: { opacity: 1, width: 480 },
      };
      function resize() {
        style.main.width = 300;
      }
      export default () => <main onClick={resize}>Content</main>;
    `, { id: "/app/pages/mutable-style.tsx" }).code;

    expect(code).toContain("style.main.width = 300");
    expect(code).toContain("class: __styles.main");
    expect(code).toContain("__styleId, true");
  });

  test("applies Tailwind class rules to matching elements", () => {
    const code = compileView(`
      export default () => <main class="p-4">Content</main>;
      export const style = {
        main: ["mx-auto max-w-xl", "space-y-3"],
      };
    `, { id: "/app/pages/tailwind.tsx" }).code;

    expect(code).toContain("class: [__styles.main, \"p-4\"]");
    expect(code).toContain('["mx-auto max-w-xl", "space-y-3"]');
  });

  test("keeps local recipes out of automatic element matching", () => {
    const code = compileView(`
      export default () => <main><Button>Save</Button></main>;
      export const style = {
        $surface: "rounded-xl border",
        main: "$surface p-6",
      };
      export const deepStyle = {
        $control: "rounded-lg font-semibold",
        Button: "$control px-4 py-2",
      };
    `, { id: "/app/pages/recipes.tsx" }).code;

    expect(code).toContain('$surface: "rounded-xl border"');
    expect(code).toContain('main: "$surface p-6"');
    expect(code).toContain('$control: "rounded-lg font-semibold"');
    expect(code).toContain('__deep(deepStyle.Button');
    expect(code).not.toContain("__styles.$surface");
  });

  test("keeps recipe-only styles free of scoped DOM work", () => {
    const code = compileView(`
      export default () => <button class={style.$control}>Save</button>;
      export const style = {
        $surface: "rounded-lg border",
        $control: "$surface px-4 py-2",
      };
    `, { id: "/ui/button.view.tsx" }).code;

    expect(code).toContain("const style = __style(__styleId");
    expect(code).toContain("class: __styles.$control");
    expect(code).not.toContain("styleState");
    expect(code).not.toContain("data-luon-s");
    expect(code).not.toContain("__refreshStyles");
  });

  test("updates dynamic class styles without a scoped DOM attribute", () => {
    const code = compileView(`
      export default () => <button class="root">Save</button>;
      export const style = {
        $base: "rounded-lg border",
        root: ["$base", props.block && "w-full"],
      };
    `, { id: "/ui/button.view.tsx" }).code;

    expect(code).toContain("styleState as __styleState");
    expect(code).toContain("__refreshStyles();");
    expect(code).toContain("class: [__styles.root, \"root\"]");
    expect(code).not.toContain("data-luon-s");
  });

  test("applies styles by tag, ID, name, and class", () => {
    const code = compileView(`
      export default () => (
        <main id="hero" name="shell" class="card p-4">Content</main>
      );
      export const style = {
        main: "min-h-screen",
        shell: { maxWidth: 960 },
        card: "rounded-xl",
        hero: () => ({ opacity: 0.9 }),
      };
    `, { id: "/app/pages/selectors.tsx" }).code;

    expect(code).toContain("__styles.main");
    expect(code).toContain("__styles.shell");
    expect(code).toContain("__styles.card");
    expect(code).toContain("__dynamic(__styles.hero");
    expect(code).toContain('"card p-4"');
    expect(code).not.toContain("style.p-4");
  });

  test("applies static and prop-based deep component styles", () => {
    const code = compileView(`
      export const data = { active: true };
      export default () => <>
        <Button class="primary">Save</Button>
        <Card active={data.active} style={{ width: 720 }} />
      </>;
      export const deepStyle = {
        Button: { padding: 12 },
        Card: ({ active }) => ({ opacity: active ? 1 : 0.5, width: 480 }),
      };
    `, { id: "/app/pages/deep.tsx" }).code;

    expect(code).toContain("deepView as __deep");
    expect(code).toContain("const deepStyle = __style(__deepId");
    expect(code).toContain("__deep(deepStyle.Button");
    expect(code).toContain("class: \"primary\"");
    expect(code).toContain("__deep(deepStyle.Card");
    expect(code).toContain("active: data.active");
    expect(code).not.toContain('"data-luon-s"');
  });

  test("keeps plural style exports as compatibility aliases", () => {
    const code = compileView(`
      export const styles = { main: { width: 480 } };
      export const deepStyles = { Button: { padding: 12 } };
      export default () => <main><Button /></main>;
    `, { id: "/app/pages/legacy-style.tsx" }).code;

    expect(code).toContain("const styles = style");
    expect(code).toContain("const deepStyles = deepStyle");
    expect(code).toContain("__deep(deepStyle.Button");
  });

  test("compiles plural declarations into isolated named Views", () => {
    const source = `
      const label = (value: string) => value;
      export const datas = {
        Button: { count: 0 },
        Dialog: { open: false },
      };
      export const styles = {
        Button: { root: "rounded-md" },
        Dialog: { panel: "rounded-xl" },
      };
      export const events = {
        Button: {
          load() {},
          close() {},
          click() { data.count++; },
          document: { beforeinput() { data.count++; } },
          window: { resize() { data.count++; } },
        },
        Dialog: { dismiss() {} },
      };
      export const specs = {
        Button: { disabled: r.boolean() },
        Dialog: { modal: r.boolean() },
      };
      export function Button() {
        return <button onClick={event.click}>
          {label(String(data.count))}
        </button>;
      }
      export const Dialog = () => <dialog aria-label={label("Dialog")} />;
    `;
    const code = compileView(source).code;

    expect(code).toContain("export const Button = (() => {");
    expect(code).toContain("export const Dialog = (() => {");
    expect(code).toContain('return __component("Button"');
    expect(code).toContain('return __component("Dialog"');
    expect(code).toContain("const data = __state({ count: 0 })");
    expect(code).toContain("const data = __state({ open: false })");
    expect(code).toContain("const event = {");
    expect(code).toContain("const __events = __event(event)");
    expect(code).toContain("onClick: event.click");
    expect(code).toContain(
      "children: __live(() => label(String(data.count)))",
    );
    expect(code).toContain("__events.load()");
    expect(code).toContain("__events.close()");
    expect(code).toContain("document: { beforeinput()");
    expect(code).toContain("window: { resize()");
    expect(code).toContain("}, __spec, {");
    expect(code).toContain('{ root: "rounded-md" }');
    expect(code).toContain('{ panel: "rounded-xl" }');
    const styleIds = [...code.matchAll(
      /const __styleId = "([a-f0-9]+)"/g,
    )].map((match) => match[1]);
    expect(styleIds).toHaveLength(2);
    expect(new Set(styleIds).size).toBe(2);
    expect(code).not.toContain("export const datas");
    expect(code).not.toContain("export const events");
    expect(code.match(/const label =/g)).toHaveLength(1);
  });

  test("rejects plural keys without a named View", () => {
    expect(() => compileView(`
      export const datas = {
        Button: { count: 0 },
        Missing: { count: 0 },
      };
      export function Button() { return <button />; }
    `)).toThrow("`datas.Missing` has no named View");
  });

  test("rejects single declarations in a named-only module", () => {
    expect(() => compileView(`
      export const data = { count: 0 };
      export function Counter() { return <button>{data.count}</button>; }
    `, { id: "/ui/counter.tsx" })).toThrow(
      "`data` requires a default View. Use `datas` for named Views.",
    );

    expect(() => compileView(`
      export const computed = { total: () => 1 };
      export function Counter() { return <button />; }
    `)).toThrow(
      "Add a default View or keep this value inside a named View function.",
    );
  });

  test("rejects duplicate named View declarations", () => {
    expect(() => compileView(`
      export function Card() { return <article />; }
      export const Card = () => <section />;
    `, { id: "/ui/card.tsx" })).toThrow(
      "Named View `Card` is declared more than once.",
    );
  });

  test("batches package named Views with shared source", () => {
    const code = compileView(`
      export const label = (value: string) => value;
      export const specs = {
        Action: { label: r.string() },
        Panel: { label: r.string() },
      };
      export function Action(props) {
        return <button>{label(props.label)}</button>;
      }
      export function Panel(props) {
        return <section>{label(props.label)}</section>;
      }
    `, { batch: true }).code;

    expect(code).toContain("namedViews as __namedViews");
    expect(code).toContain('import { r, rule } from "@luon/rule"');
    expect(code).toContain("Action: r.object({ label: r.string() })");
    expect(code).toContain("Panel: r.object({ label: r.string() })");
    expect(code).toContain("export const { Action, Panel, } = __namedViews");
    expect(code).toContain("export const label =");
    expect(code.match(/const label =/g)).toHaveLength(1);
    expect(code).not.toContain("componentView as __component");
  });

  test("recognizes a named View group", () => {
    const code = compileView(`
      export const datas = {
        Dialog: { open: false },
      };
      export const events = {
        Dialog: { show() { data.open = true; } },
        DialogTrigger: { click() { event.show(); } },
      };
      export const group = {
        Dialog: [DialogTrigger, DialogContent, DialogClose],
      };
      export function Dialog() { return <dialog open={data.open} />; }
      export const DialogTrigger = () => (
        <button onClick={event.click}>Open</button>
      );
      export const DialogContent = () => <section />;
      export const DialogClose = () => <button>Close</button>;
    `).code;

    expect(code).toContain("export const Dialog = (() => {");
    expect(code).toContain("export const DialogTrigger = (() => {");
    expect(code).toContain("export const DialogContent = (() => {");
    expect(code).toContain("export const DialogClose = (() => {");
    expect(code).toContain("groupView as __group");
    expect(code).toContain("groupData as __groupData");
    expect(code).toContain("groupEvent as __groupEvent");
    expect(code).toContain("groupScope as __groupScope");
    expect(code).toContain("const __events = __event(__eventSource)");
    expect(code).toContain('__group(__component("Dialog"');
    expect(code).toContain('"file": "View.tsx"');
    expect(code).toContain('}), "Dialog", true)');
    expect(code).toContain('}), "Dialog", false)');
    expect(code).not.toContain("export const group");
  });

  test("keeps group data on its root", () => {
    expect(() => compileView(`
      export const datas = {
        Dialog: { open: false },
        DialogTrigger: { pressed: false },
      };
      export const group = { Dialog: [DialogTrigger] };
      export function Dialog() { return <dialog />; }
      export function DialogTrigger() { return <button />; }
    `)).toThrow(
      "Group data must be declared on `Dialog`, not `DialogTrigger`",
    );
  });

  test("rejects invalid named View groups", () => {
    expect(() => compileView(`
      export const group = [Dialog];
      export function Dialog() { return <dialog />; }
    `)).toThrow("`group` must be an object literal");

    expect(() => compileView(`
      export const group = { Missing: [Dialog] };
      export function Dialog() { return <dialog />; }
    `)).toThrow("`group.Missing` has no named View");

    expect(() => compileView(`
      export const group = { Dialog: ["DialogContent"] };
      export function Dialog() { return <dialog />; }
      export function DialogContent() { return <section />; }
    `)).toThrow("Group members must be named View identifiers");

    expect(() => compileView(`
      export const group = {
        Dialog: [DialogTrigger],
        DialogTrigger: [DialogContent],
      };
      export function Dialog() { return <dialog />; }
      export function DialogTrigger() { return <button />; }
      export function DialogContent() { return <section />; }
    `)).toThrow("`DialogTrigger` belongs to more than one group");

    expect(() => compileView(`
      export const group = { Dialog: [Dialog] };
      export function Dialog() { return <dialog />; }
    `)).toThrow("`Dialog` cannot contain itself");
  });

  test("reports removed lifecycle exports", () => {
    expect(() => compileView(`
      export const onLoad = () => undefined;
      export default () => <main />;
    `)).toThrow("`onLoad` was replaced by `event.load`");

    expect(() => compileView(`
      export function onClose() {}
      export default () => <main />;
    `)).toThrow("`onClose` was replaced by `event.close`");

    expect(() => compileView(`
      export const onLoad = () => undefined, ready = true;
      export default () => <main />;
    `)).toThrow("`onLoad` was replaced by `event.load`");
  });

  test("connects event lifecycle and keeps ordinary handlers", () => {
    const code = compileView(`
      export const data = { count: 0 };
      export const event = {
        load() { data.count++; },
        close() { data.count = 0; },
        add() { data.count++; },
      };
      export default () => (
        <button onClick={event.add}>{data.count}</button>
      );
    `, { id: "/app/counter.tsx" }).code;

    expect(code).toContain("const event = {");
    expect(code).toContain("eventView as __event");
    expect(code).toContain("const __events = __event(event)");
    expect(code).toContain("__events.load()");
    expect(code).toContain("__events.close()");
    expect(code).toContain("onClick: event.add");
    expect(code).not.toContain("onClick: __live");
    expect(code).not.toContain("export const event");
  });

  test("requires one literal event definition", () => {
    expect(() => compileView(`
      const handlers = { load() {} };
      export const event = handlers;
      export default () => <main />;
    `)).toThrow("`event` must be an object literal");

    expect(() => compileView(`
      const page = { resize() {} };
      export const event = { window: page };
      export default () => <main />;
    `)).toThrow("event.window must be an object literal");
  });

  test("automatically imports Rule for a View", () => {
    const source = `
      const Input = rule.object({ name: r.string(1, 40) });
      export const valid = (value: unknown) => Input.parse(value);
      export default () => <main>{valid({ name: "Luon" }).name}</main>;
    `;
    const code = compileView(source).code;

    expect(code).toContain('import { r, rule } from "@luon/rule"');
    expect(code).toContain("Input.parse");
  });

  test("connects a props spec to the View boundary", () => {
    const code = compileView(`
      export const spec = {
        size: r.enum(["sm", "md", "lg"]),
      };
      export default () => <button {...attrs}>{props.size}</button>;
    `, { id: "/ui/button.view.tsx" }).code;

    expect(code).toContain('import { r, rule } from "@luon/rule"');
    expect(code).toContain('export default __component("Button"');
    expect(code).toContain("attrsView as __attrs");
    expect(code).toContain("const __spec = r.object({");
    expect(code).toContain("const attrs = __attrs(props, __spec)");
    expect(code).toContain("}, __spec, {");
    expect(code).not.toContain("export const spec");
  });

  test("wraps an empty props shape and imports Rule", () => {
    const code = compileView(`
      export const spec = {};
      export default () => <main {...attrs} />;
    `).code;

    expect(code).toContain('import { r, rule } from "@luon/rule"');
    expect(code).toContain("const __spec = r.object({})");
  });

  test("keeps an existing props Rule expression", () => {
    const code = compileView(`
      const base = r.object({ label: r.string() });
      export const spec = base.extend({ disabled: r.boolean() });
      export default () => <button>{props.label}</button>;
    `).code;

    expect(code).toContain("const __spec = base.extend({");
    expect(code).not.toContain("r.object(base.extend");
  });

  test("reports the removed format export", () => {
    expect(() => compileView(`
      export const format = r.object({ label: r.string() });
      export default () => <button {...attrs}>{props.label}</button>;
    `, { id: "/ui/legacy.view.tsx" }))
      .toThrow("`format` was replaced by `spec`");
  });

  test("normalizes input attributes before component rendering", () => {
    const output = compileView(`
      export default () => (
        <Input
          autocomplete="current-password"
          maxlength="72"
          minlength="8"
        />
      );
    `).code;

    expect(output).toContain('autoComplete: "current-password"');
    expect(output).toContain('maxLength: "72"');
    expect(output).toContain('minLength: "8"');
    expect(output).not.toContain('autocomplete: "current-password"');
  });

  test("keeps an explicit Rule import", () => {
    const source = `
      import { rule } from "@luon/rule";
      const Input = rule.string();
      export default () => <main>{Input.parse("Luon")}</main>;
    `;
    const code = compileView(source).code;

    expect(code).toContain('import { rule } from "@luon/rule"');
    expect(code.match(/@luon\/rule/g)).toHaveLength(1);
  });

  test("reports the removed global Zod value", () => {
    expect(() => compileView(`
      const Input = z.object({ name: z.string() });
      export default () => <p>{Input.parse({ name: "Luon" }).name}</p>;
    `, { id: "legacy.tsx" })).toThrow(
      "Global z was removed. Use rule or r, or import Zod explicitly.",
    );
  });

  test("leaves a module without a default view unchanged", () => {
    const source = "export const value = 1;";

    expect(compileView(source).code).toBe(source);
  });

  test("rejects invalid view syntax with a clear error", () => {
    const cases = [
      {
        message: "variable or property",
        source: "export default () => <input bind={read()} />;",
      },
      {
        message: "variable or property",
        source: `
          export const data = { name: "" };
          export default () => <input bind={data?.name} />;
        `,
      },
      {
        message: "mutable state expression",
        source: "export default () => <input bind />;",
      },
      {
        message: "mutable state expression",
        source: "export default () => <input bind=\"name\" />;",
      },
      {
        message: "declared separately",
        source: `
          export const data = {}, value = 1;
          export default () => <main />;
        `,
      },
      {
        message: "only supported on components",
        source: `
          export const data = { enabled: false };
          export default () => <input bindChecked={data.enabled} />;
        `,
      },
      {
        message: "must be a function",
        source: "export default class View {}",
      },
      {
        message: "not supported",
        source: "const View = () => null; export = View;",
      },
      {
        message: "requires an initializer",
        source: "export let data; export default () => <main />;",
      },
      {
        message: "requires an initializer",
        source: "export let computed; export default () => <main />;",
      },
      {
        message: "requires an initializer",
        source: "export let style; export default () => <main />;",
      },
      {
        message: "requires an initializer",
        source: "export let deepStyle; export default () => <main />;",
      },
      {
        message: "must be an object literal",
        source: `
          const rules = {};
          export const deepStyle = rules;
          export default () => <main />;
        `,
      },
      {
        message: "replaced by `event.load`",
        source:
          "export const onStart = () => {}; export default () => <main />;",
      },
      {
        message: "Only one default view",
        source: `
          export default () => <main />;
          export default () => <main />;
        `,
      },
    ];

    for (const item of cases) {
      expect(() => compileView(item.source)).toThrow(CompileError);
      expect(() => compileView(item.source)).toThrow(item.message);
    }
  });

  test("reports TypeScript parse errors", () => {
    const source = "export default () => <main>;";

    expect(() => compileView(source)).toThrow(CompileError);
  });
});
