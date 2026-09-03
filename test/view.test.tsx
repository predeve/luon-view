import { describe, expect, test } from "bun:test";
import { act, mount, portal, type Child, type Read } from "@luon/act";
import { Window } from "happy-dom";
import { r } from "@luon/rule";

import {
  bindView,
  attrsView,
  cell,
  componentView,
  eventView,
  groupData,
  groupEvent,
  groupScope,
  groupView,
  namedView,
  namedViews,
  onClose,
  onLoad,
  passProps,
  state,
  styleState,
  styleView,
  type GroupScope,
  type ViewProps,
} from "../src/index.ts";
import { compileView } from "../src/compiler.ts";
import { jsx as viewJsx } from "../src/jsx-runtime.ts";

const dom = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  document: dom.document,
  Element: dom.Element,
  Event: dom.Event,
  HTMLElement: dom.HTMLElement,
  MouseEvent: dom.MouseEvent,
  MutationObserver: dom.MutationObserver,
  navigator: dom.navigator,
  Node: dom.Node,
  window: dom,
});

function host(view: Child) {
  const node = document.createElement("div");
  document.body.append(node);
  const close = mount(view, node);
  return { close, node };
}

describe("namedView", () => {
  test("keeps native output, Rule defaults, and reactive props", () => {
    const data = state({ className: "first", label: "First" });
    const spec = r.object({
      label: r.string().default("Save"),
    }).passthrough();
    const Action = namedView(
      "NamedAction",
      (props: Record<string, unknown>) => (
        <button class="base">{props.label as Child}</button>
      ),
      spec,
    );

    const fallback = Action({}) as HTMLButtonElement;
    expect(fallback).toBeInstanceOf(HTMLElement);
    expect(fallback.textContent).toBe("Save");

    const button = Action({
      class: act(() => data.className),
      label: act(() => data.label),
    }) as HTMLButtonElement;
    expect(button.textContent).toBe("First");
    expect(button.className).toBe("base first");
    data.label = "Second";
    data.className = "second";
    expect(button.textContent).toBe("Second");
    expect(button.className).toBe("base second");
  });

  test("batches package components and exposes native attrs", () => {
    const spec = r.object({ label: r.string() }).passthrough();
    const views = namedViews({
      Action: (props: Record<string, any>) => (
        <button {...props.$attrs}>{props.label}</button>
      ),
    }, () => spec);
    const button = views.Action({
      id: "save",
      label: "Save",
    }) as HTMLButtonElement;
    expect(button.getAttribute("id")).toBe("save");
    expect(button.hasAttribute("label")).toBeFalse();
  });
});

describe("named View compiler", () => {
  test("isolates each named spec and style", () => {
    const code = compileView(`
      export const specs = {
        Action: {
          label: r.string().default("Save"),
        },
        Panel: {
          title: r.string().default("Panel"),
        },
      };
      export const styles = {
        Action: { button: "action-only" },
        Panel: { article: "panel-only" },
      };
      export function Action(props) {
        return <button {...attrs}>{props.label}</button>;
      }
      export function Panel(props) {
        return <article {...attrs}>{props.title}</article>;
      }
    `, { id: "/ui/parts.view.tsx" }).code;
    const script = code
      .split("\n")
      .filter((line) => !line.startsWith("import "))
      .join("\n")
      .replace("export const Action =", "const Action =")
      .replace("export const Panel =", "const Panel =");
    const create = Function(
      "r",
      "__attrs",
      "__component",
      "__live",
      "__style",
      "_jsx",
      `${script}\nreturn { Action, Panel };`,
    ) as (...values: unknown[]) => Record<
      string,
      (props: ViewProps) => Child
    >;
    const views = create(
      r,
      attrsView,
      componentView,
      act,
      styleView,
      viewJsx,
    );
    const action = host(views.Action!({ id: "save" }));
    const panel = host(views.Panel!({ id: "panel" }));

    const button = action.node.querySelector("button");
    const article = panel.node.querySelector("article");
    expect(button?.textContent).toBe("Save");
    expect(button?.id).toBe("save");
    expect(button?.className).toBe("action-only");
    expect(button?.hasAttribute("label")).toBeFalse();
    expect(article?.textContent).toBe("Panel");
    expect(article?.id).toBe("panel");
    expect(article?.className).toBe("panel-only");
    expect(article?.className).not.toContain("action-only");

    const invalid = views.Action!({ label: 10 }) as Read<Child>;
    expect(() => invalid.read()).toThrow();
    invalid.dispose?.();
    action.close();
    panel.close();
    action.node.remove();
    panel.node.remove();
  });

  test("isolates state and removes each instance event", async () => {
    const code = compileView(`
      export const datas = {
        Counter: { count: 0 },
      };
      export const events = {
        Counter: {
          add() { data.count++; },
          document: {
            beforeinput() { data.count++; },
          },
        },
      };
      export function Counter() {
        return <button onClick={event.add}>{data.count}</button>;
      }
    `).code;
    const script = code
      .split("\n")
      .filter((line) => !line.startsWith("import "))
      .join("\n")
      .replace("export const Counter", "const Counter");
    const create = Function(
      "__component",
      "__event",
      "__live",
      "__state",
      "_jsx",
      `${script}\nreturn Counter;`,
    ) as (...values: unknown[]) => (props: ViewProps) => Child;
    const Counter = create(
      componentView,
      eventView,
      act,
      state,
      viewJsx,
    );
    const first = host(Counter({}));
    const second = host(Counter({}));
    await Promise.resolve();

    first.node.querySelector("button")?.click();
    expect(first.node.textContent).toBe("1");
    expect(second.node.textContent).toBe("0");

    document.dispatchEvent(new Event("beforeinput"));
    expect(first.node.textContent).toBe("2");
    expect(second.node.textContent).toBe("1");

    first.close();
    document.dispatchEvent(new Event("beforeinput"));
    expect(second.node.textContent).toBe("2");
    second.close();
    first.node.remove();
    second.node.remove();
  });

  test("shares data and cleans compiled group events", async () => {
    const calls: string[] = [];
    (globalThis as any).__groupCalls = calls;
    const code = compileView(`
      export const datas = {
        Dialog: { open: false },
      };
      export const events = {
        Dialog: {
          show() { data.open = true; },
          close() { globalThis.__groupCalls.push("root-close"); },
          document: {
            "group-life"() {
              globalThis.__groupCalls.push("root-event");
            },
          },
        },
        DialogTrigger: {
          click() { event.show(); },
          close() { globalThis.__groupCalls.push("member-close"); },
          document: {
            "group-life"() {
              globalThis.__groupCalls.push("member-event");
            },
          },
        },
      };
      export const group = {
        Dialog: [DialogTrigger, DialogState],
      };
      export function Dialog(props) {
        return <section>{props.children}</section>;
      }
      export function DialogTrigger() {
        return <button onClick={event.click}>Open</button>;
      }
      export function DialogState() {
        return <span>{data.open ? "true" : "false"}</span>;
      }
    `).code;
    const script = code
      .split("\n")
      .filter((line) => !line.startsWith("import "))
      .join("\n")
      .replace("export const Dialog =", "const Dialog =")
      .replace("export const DialogTrigger =", "const DialogTrigger =")
      .replace("export const DialogState =", "const DialogState =");
    const create = Function(
      "__component",
      "__event",
      "__group",
      "__groupData",
      "__groupEvent",
      "__groupScope",
      "__live",
      "__state",
      "_jsx",
      `${script}\nreturn { Dialog, DialogState, DialogTrigger };`,
    ) as (...values: unknown[]) => Record<
      string,
      (props: ViewProps) => Child
    >;
    const views = create(
      componentView,
      eventView,
      groupView,
      groupData,
      groupEvent,
      groupScope,
      act,
      state,
      viewJsx,
    );
    const make = () => {
      const Dialog = views.Dialog!;
      const State = views.DialogState!;
      const Trigger = views.DialogTrigger!;
      return Dialog({
        children: <div><Trigger /><State /></div>,
      });
    };
    const first = host(make());
    const second = host(make());
    await Promise.resolve();

    expect(first.node.querySelector("span")?.textContent).toBe("false");
    expect(second.node.querySelector("span")?.textContent).toBe("false");
    first.node.querySelector("button")?.click();
    expect(first.node.querySelector("span")?.textContent).toBe("true");
    expect(second.node.querySelector("span")?.textContent).toBe("false");

    document.dispatchEvent(new Event("group-life"));
    expect(calls.filter((item) => item === "root-event")).toHaveLength(2);
    expect(calls.filter((item) => item === "member-event")).toHaveLength(2);
    first.close();
    expect(calls.filter((item) => item === "root-close")).toHaveLength(1);
    expect(calls.filter((item) => item === "member-close")).toHaveLength(1);
    document.dispatchEvent(new Event("group-life"));
    expect(calls.filter((item) => item === "root-event")).toHaveLength(3);
    expect(calls.filter((item) => item === "member-event")).toHaveLength(3);
    second.close();
    const count = calls.length;
    document.dispatchEvent(new Event("group-life"));
    expect(calls).toHaveLength(count);
    expect(calls.filter((item) => item === "root-close")).toHaveLength(2);
    expect(calls.filter((item) => item === "member-close")).toHaveLength(2);
    delete (globalThis as any).__groupCalls;
    first.node.remove();
    second.node.remove();
  });

  test("keeps group context through Portal children", async () => {
    const calls: string[] = [];
    (globalThis as any).__portalCalls = calls;
    const code = compileView(`
      export const datas = {
        Dialog: { open: false },
      };
      export const events = {
        Dialog: {
          show() { data.open = true; },
        },
        DialogContent: {
          click() { event.show(); },
          close() { globalThis.__portalCalls.push("close"); },
          document: {
            "portal-life"() {
              globalThis.__portalCalls.push("event");
            },
          },
        },
      };
      export const group = {
        Dialog: [DialogContent],
      };
      export function Dialog(props) {
        return <section>{props.children}</section>;
      }
      export function DialogContent() {
        return <button onClick={event.click}>
          {data.open ? "Open" : "Closed"}
        </button>;
      }
    `).code;
    const script = code
      .split("\n")
      .filter((line) => !line.startsWith("import "))
      .join("\n")
      .replace("export const Dialog =", "const Dialog =")
      .replace("export const DialogContent =", "const DialogContent =");
    const create = Function(
      "__component",
      "__event",
      "__group",
      "__groupData",
      "__groupEvent",
      "__groupScope",
      "__live",
      "__state",
      "_jsx",
      `${script}\nreturn { Dialog, DialogContent };`,
    ) as (...values: unknown[]) => Record<
      string,
      (props: ViewProps) => Child
    >;
    const views = create(
      componentView,
      eventView,
      groupView,
      groupData,
      groupEvent,
      groupScope,
      act,
      state,
      viewJsx,
    );
    const target = document.createElement("aside");
    document.body.append(target);
    const content = views.DialogContent!({});
    const moved = portal(content, target);
    const output = host(views.Dialog!({ children: moved }));
    await Promise.resolve();

    expect(output.node.querySelector("button")).toBeNull();
    const button = target.querySelector("button")!;
    expect(button.textContent?.trim()).toBe("Closed");
    button.click();
    expect(button.textContent?.trim()).toBe("Open");
    document.dispatchEvent(new Event("portal-life"));
    expect(calls).toEqual(["event"]);

    output.close();
    expect(target.childNodes).toHaveLength(0);
    expect(calls).toEqual(["event", "close"]);
    document.dispatchEvent(new Event("portal-life"));
    expect(calls).toEqual(["event", "close"]);
    delete (globalThis as any).__portalCalls;
    output.node.remove();
    target.remove();
  });
});

describe("groupView", () => {
  test("links members to only their nearest root context", () => {
    const roots: GroupScope[] = [];
    const members: GroupScope[] = [];
    const Root = groupView(componentView("GroupRoot", (props) => {
      roots.push(groupScope());
      return {
        render: () => <div>{props.children as Child}</div>,
      };
    }), "Dialog", true);
    const Member = groupView(componentView("GroupMember", () => {
      members.push(groupScope());
      return { render: () => <button>Member</button> };
    }), "Dialog");

    const loose = <Member />;
    const firstChild = <section><Member /></section>;
    const first = host(<Root>{firstChild}</Root>);
    const second = host(<Root><Member /></Root>);
    const inner = <Root><Member /></Root>;
    const nested = host(<Root>{inner}<Member /></Root>);

    expect(members[0]?.context.value).toBeUndefined();
    expect(members[1]?.context.value).toBe(roots[0]?.context.value);
    expect(members[2]?.context.value).toBe(roots[1]?.context.value);
    expect(roots[0]?.context.value).not.toBe(roots[1]?.context.value);
    expect(members[3]?.context.value).toBe(roots[2]?.context.value);
    expect(members[4]?.context.value).toBe(roots[3]?.context.value);
    expect(roots[2]?.context.value).not.toBe(roots[3]?.context.value);

    const firstContext = roots[0]!.context.value!;
    first.close();
    expect(firstContext.active).toBeFalse();
    expect(firstContext.values).toEqual({});
    expect(roots[0]?.closed).toBeTrue();
    expect(roots[0]?.context.value).toBeUndefined();
    expect(members[1]?.closed).toBeTrue();
    expect(members[1]?.context.value).toBeUndefined();
    second.close();
    nested.close();
    (loose as Read<Child>).dispose?.();
    first.node.remove();
    second.node.remove();
    nested.node.remove();
  });
});

describe("componentView", () => {
  test("connects and removes document and window events", () => {
    const calls: string[] = [];
    const life = eventView({
      load: () => calls.push("load"),
      close: () => calls.push("close"),
      document: {
        beforeinput: () => calls.push("beforeinput"),
      },
      window: {
        resize: () => calls.push("resize"),
      },
    });

    life.load();
    document.dispatchEvent(new Event("beforeinput"));
    window.dispatchEvent(new Event("resize"));
    life.close();
    document.dispatchEvent(new Event("beforeinput"));
    window.dispatchEvent(new Event("resize"));
    expect(calls).toEqual([
      "load",
      "beforeinput",
      "resize",
      "close",
    ]);
  });

  test("keeps state and runs native lifecycle", async () => {
    let loads = 0;
    let closes = 0;
    let reported = 0;
    type Props = Record<string, unknown> & {
      label: string;
      onCount?: (count: number) => void;
      step: number;
    };
    const Counter = componentView<Props>("Counter", () => {
      const data = state({ count: 0, status: "waiting" });
      return {
        load() {
          loads++;
          data.status = "loaded";
        },
        close() {
          closes++;
        },
        render({ label, onCount, step }) {
          return <button onClick={() => {
            data.count += step;
            onCount?.(data.count);
          }}>{label}:{data.count}:{data.status}</button>;
        },
      };
    });
    const view = host(<Counter label="Count" step={2}
      onCount={(count) => reported = count} />);
    await Promise.resolve();
    expect(loads).toBe(1);
    expect(view.node.textContent).toBe("Count:0:loaded");
    view.node.querySelector("button")?.click();
    expect(view.node.textContent).toBe("Count:2:loaded");
    expect(reported).toBe(2);
    view.close();
    expect(closes).toBe(1);
    view.node.remove();
  });

  test("provides props to setup closures", () => {
    let selected = "";
    type Props = Record<string, unknown> & {
      label: string;
      onSelect: (value: string) => void;
    };
    const Select = componentView<Props>("Select", (props) => ({
      render() {
        return <button onClick={() => props.onSelect(props.label)}>
          {props.label}
        </button>;
      },
    }));
    const view = host(<Select label="First"
      onSelect={(value) => selected = value} />);
    view.node.querySelector("button")?.click();
    expect(selected).toBe("First");
    view.close();
    view.node.remove();
  });

  test("applies Rule defaults and validation while reading props", () => {
    const spec = r.object({
      disabled: r.boolean(),
      size: r.enum(["sm", "md", "lg"]).default("md"),
    });
    const Button = componentView("RuleButton", (props) => ({
      render: () => <button disabled={props.disabled}>{props.size}</button>,
    }), spec);
    const view = host(<Button />);

    expect(view.node.textContent).toBe("md");
    expect(view.node.querySelector("button")?.disabled).toBeFalse();
    expect(attrsView({ id: "save", size: "lg" }, spec))
      .toEqual({ id: "save" });
    const invalid = Button({ size: "xl" } as any) as unknown as {
      dispose: () => void;
      read: () => unknown;
    };
    expect(() => invalid.read()).toThrow("allowed value");
    invalid.dispose();
    view.close();
    view.node.remove();
  });

  test("updates component binds without rebuilding the parent", () => {
    const data = state({ value: "First" });
    let renders = 0;
    type Props = Record<string, unknown> & { value: string };
    const Field = componentView<Props>("BoundField", (props) => ({
      render: () => <span>{props.value}</span>,
    }));
    const Parent = componentView("BoundParent", () => ({
      render() {
        renders++;
        const bind = bindView(
          () => data.value,
          (value) => data.value = value,
          { tag: "component" },
        );
        return <section><Field {...bind as unknown as Props} /></section>;
      },
    }));
    const view = host(<Parent />);
    const section = view.node.querySelector("section");

    expect(view.node.textContent).toBe("First");
    data.value = "Second";
    expect(view.node.textContent).toBe("Second");
    expect(view.node.querySelector("section")).toBe(section);
    expect(renders).toBe(1);

    view.close();
    view.node.remove();
  });

  test("passes host props through an unmounted View child", () => {
    const Action = componentView("PassedAction", props => ({
      render: () => <button popovertarget={props.popovertarget}>Open</button>,
    }));
    const action = <Action />;

    expect(passProps(action, { popovertarget: "actions" })).toBeTrue();
    const view = host(action);
    expect(view.node.querySelector("button")?.getAttribute("popovertarget"))
      .toBe("actions");
    view.close();
    view.node.remove();
  });

  test("runs compatibility lifecycle and cell state", async () => {
    const calls: string[] = [];
    const Counter = componentView("CompatCounter", () => {
      const count = cell(1);
      onLoad(() => calls.push("load"));
      onClose(() => calls.push("close"));
      return {
        render() {
          return <button onClick={() => count(count() + 1)}>{count()}</button>;
        },
      };
    });
    const view = host(<Counter />);
    await Promise.resolve();
    expect(calls).toEqual(["load"]);
    view.node.querySelector("button")?.click();
    expect(view.node.textContent).toBe("2");
    view.close();
    expect(calls).toEqual(["load", "close"]);
    view.node.remove();
  });

  test("refreshes direct style values with View state", () => {
    let scope = "";
    const Panel = componentView("ReactivePanel", () => {
      const data = state({ open: true });
      const source = styleState(() => ({
        main: {
          opacity: data.open ? 1 : 0,
          width: data.open ? 720 : 480,
        },
      }), "act-direct", true);
      scope = source.id;
      const styles = source.rules;
      let classes = styleView(scope, source.value());
      return {
        render() {
          classes = styleView(scope, source.refresh());
          return <button class={classes.main} onClick={() => {
            data.open = false;
            styles.main.width = 300;
          }}>Toggle</button>;
        },
      };
    });
    const view = host(<Panel />);
    const style = document.querySelector(
      `style[data-luon-style="${scope}"]`,
    );
    expect(style?.textContent).toContain("opacity:1");
    view.node.querySelector("button")?.click();
    expect(style?.textContent).toContain("opacity:0");
    expect(style?.textContent).toContain("width:300px");
    view.close();
    expect(document.querySelector(
      `style[data-luon-style="${scope}"]`,
    )).toBeNull();
    view.node.remove();
  });
});
