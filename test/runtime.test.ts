import { describe, expect, test } from "bun:test";
import { effect } from "@luon/act";
import { Window } from "happy-dom";

import { computedView, watchView } from "../src/index.ts";
import { jsx, jsxDEV, jsxs } from "../src/jsx-runtime.ts";
import { withLife, type ViewLife } from "../src/life.ts";
import { bindView } from "../src/model.ts";
import { createStore, state, withStore } from "../src/store.ts";

function event(currentTarget: object) {
  return { currentTarget } as unknown as Event;
}

const dom = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  document: dom.document,
  Element: dom.Element,
  Event: dom.Event,
  HTMLElement: dom.HTMLElement,
  MouseEvent: dom.MouseEvent,
  Node: dom.Node,
  window: dom,
});

describe("jsx", () => {
  test("connects Cake event names to native DOM", () => {
    let doubles = 0;
    let pointers = 0;
    const output = jsx("button", {
      onDblclick: () => doubles++,
      onPointerdown: () => pointers++,
    }) as HTMLButtonElement;

    output.dispatchEvent(new Event("dblclick"));
    output.dispatchEvent(new Event("pointerdown"));
    expect([doubles, pointers]).toEqual([1, 1]);
  });

  test("writes Cake SVG attribute names to native DOM", () => {
    const output = jsx("path", {
      "stroke-linecap": "round",
      "stroke-width": 2,
      "text-anchor": "middle",
    }) as SVGPathElement;

    expect(output.getAttribute("stroke-linecap")).toBe("round");
    expect(output.getAttribute("stroke-width")).toBe("2");
    expect(output.getAttribute("text-anchor")).toBe("middle");
  });
});

describe("state", () => {
  test("tracks nested changes and keeps proxy identity", () => {
    const store = createStore();
    const data = store.proxy({ list: [1], user: { name: "Luon" } });
    let changes = 0;
    const stop = store.subscribe(() => changes++);

    expect(data.user).toBe(data.user);
    data.user.name = "View";
    data.list.push(2);
    data.user = data.user;
    data.user.name = "View";
    delete data.list[0];

    expect(changes).toBe(3);
    expect(store.snapshot()).toBe(3);

    stop();
    data.user.name = "Luon";
    expect(changes).toBe(3);
    expect(store.snapshot()).toBe(4);
  });

  test("observes assigned plain objects but leaves class values intact", () => {
    const store = createStore();
    const date = new Date("2026-01-01T00:00:00Z");
    const data = store.proxy({ date, item: { count: 0 } });

    data.item = { count: 1 };
    data.item.count++;
    Object.defineProperty(data.item, "label", {
      configurable: true,
      value: "item",
    });

    expect(store.snapshot()).toBe(3);
    expect(data.date).toBe(date);
  });

  test("shares module state and requires an object value", () => {
    const shared = state({ count: 0 });
    let count = 0;
    const stop = effect(() => count = shared.count);
    shared.count++;
    expect(count).toBe(1);
    stop();
    const store = createStore();
    expect(() => withStore(store, () => state(null as never))).toThrow(
      "object or array",
    );
    store.dispose();
  });
});

describe("computed", () => {
  test("provides typed getter and setter calls", () => {
    let name = "Luon";
    const computed = computedView({
      title: () => `Hello ${name}`,
      user: {
        get: () => name,
        set: (value: string) => {
          name = value;
        },
      },
    });

    expect(computed.title()).toBe("Hello Luon");
    expect(computed.user("View")).toBe("View");
    expect(computed.title()).toBe("Hello View");
  });
});

describe("watch", () => {
  test("runs immediate rules and observes View state", async () => {
    const store = createStore();
    const life: ViewLife = { close: [], load: [] };
    const calls: Array<[number, number | undefined]> = [];
    let cleaned = 0;
    const data = withStore(store, () => withLife(life, () => {
      const value = state({ count: 0 });
      watchView(value, {
        count: {
          immediate: true,
          run(next, previous, clean) {
            calls.push([next, previous]);
            clean(() => cleaned++);
          },
        },
      });
      return value;
    }));

    life.load.forEach((run) => run());
    expect(calls).toEqual([[0, undefined]]);
    data.count = 1;
    await Promise.resolve();
    expect(calls).toEqual([[0, undefined], [1, 0]]);
    expect(cleaned).toBe(1);

    life.close.toReversed().forEach((run) => run());
    expect(cleaned).toBe(2);
    data.count = 2;
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    store.dispose();
  });
});

describe("bind", () => {
  test("handles text update and clean rules", () => {
    let name = "";
    const input = bindView(
      () => name,
      (value) => {
        name = value;
      },
      { clean: "trim", tag: "input" },
    );
    input.onChange?.(event({ value: "  Luon  " }));
    expect(name).toBe("Luon");

    let amount: number | string = "";
    const number = bindView(
      () => amount,
      (value) => {
        amount = value;
      },
      { clean: "number", tag: "input", update: "input" },
    );
    expect(number.onChange).toBeUndefined();
    number.onInput?.(event({ value: "12.5" }));
    expect(Number(amount)).toBe(12.5);

    const numberInput = bindView(
      () => amount,
      (value) => {
        amount = value;
      },
      { tag: "input", type: "number" },
    );
    numberInput.onChange?.(event({ value: "", valueAsNumber: Number.NaN }));
    expect(amount).toBe("");
  });

  test("handles boolean, array, and radio inputs", () => {
    let enabled = false;
    const boolean = bindView(
      () => enabled,
      (value) => {
        enabled = value;
      },
      { tag: "input", type: "checkbox" },
    );
    boolean.onChange?.(event({ checked: true }));
    expect(enabled).toBeTrue();

    let roles = ["view"];
    const checkbox = bindView(
      () => roles,
      (value) => {
        roles = value;
      },
      { tag: "input", type: "checkbox", value: "admin" },
    );
    checkbox.onChange?.(event({ checked: true }));
    expect(roles).toEqual(["view", "admin"]);
    checkbox.onChange?.(event({ checked: false }));
    expect(roles).toEqual(["view"]);

    let role = "user";
    const radio = bindView(
      () => role,
      (value) => {
        role = value as string;
      },
      { tag: "input", type: "radio", value: "admin" },
    );
    radio.onChange?.(event({ checked: false }));
    expect(role).toBe("user");
    radio.onChange?.(event({ checked: true }));
    expect(role).toBe("admin");
  });

  test("handles single and multiple selects", () => {
    let role = "user";
    const single = bindView(
      () => role,
      (value) => {
        role = value;
      },
      { tag: "select" },
    );
    single.onChange?.(event({ value: "admin" }));
    expect(role).toBe("admin");

    let tools = ["bun"];
    const multiple = bindView(
      () => tools,
      (value) => {
        tools = value;
      },
      { multiple: true, tag: "select" },
    );
    multiple.onChange?.(event({
      selectedOptions: [{ value: "react" }, { value: "bun" }],
    }));
    expect(tools).toEqual(["react", "bun"]);
  });

  test("handles default and named component models", () => {
    let value = "Luon";
    const normal = bindView(
      () => value,
      (next) => {
        value = next;
      },
      { tag: "component" },
    );
    expect(normal.value.read()).toBe("Luon");
    normal.onValueChange("View");
    expect(value).toBe("View");
    expect(normal.value.read()).toBe("View");

    const named = bindView(
      () => value,
      (next) => {
        value = next;
      },
      { clean: "trim", name: "name", tag: "component" },
    );
    expect(named.name.read()).toBe("View");
    named.onNameChange("  Luon  ");
    expect(value).toBe("Luon");
  });
});

describe("jsx", () => {
  test("normalizes DOM aliases and removes children for html", () => {
    const element = jsx("label", {
      autocomplete: "current-password",
      children: "ignored",
      class: "field",
      for: "name",
      html: "<strong>Name</strong>",
      minlength: "8",
      tabindex: "-1",
    });

    const label = element as HTMLLabelElement;
    expect(label.className).toBe("field");
    expect(label.htmlFor).toBe("name");
    expect(label.innerHTML).toBe("<strong>Name</strong>");
    expect(label.getAttribute("autocomplete")).toBe("current-password");
    expect(label.getAttribute("minlength")).toBe("8");
    expect(label.tabIndex).toBe(-1);
  });

  test("passes custom component props without normalization", () => {
    let received: Record<string, unknown> = {};
    const Component = (props: Record<string, unknown>) => {
      received = props;
      return null;
    };
    jsx(Component, {
      class: "field",
      for: "name",
      html: "content",
    });

    expect(received).toEqual({
      class: "field",
      for: "name",
      html: "content",
    });
  });

  test("normalizes static and development JSX calls", () => {
    const list = jsxs("ul", {
      children: [jsx("li", { children: "one" })],
      class: "list",
    });
    const label = jsxDEV(
      "label",
      { children: "Name", for: "name" },
      undefined,
      false,
      undefined,
      undefined,
    );

    expect((list as HTMLUListElement).className).toBe("list");
    expect((label as HTMLLabelElement).htmlFor).toBe("name");
  });

  test("normalizes array and object class values", () => {
    const element = jsx("div", {
      class: ["base", { active: true, hidden: false }, ["nested"]],
    });
    expect((element as HTMLDivElement).className).toBe("base active nested");
  });

  test("normalizes Preview assets and native input values", () => {
    const previous = globalThis.document;
    const window = new Window({
      url: "http://localhost/api/templates/tmp-demo/preview/",
    });
    window.document.head.innerHTML = (
      '<base href="/api/templates/tmp-demo/preview/" />'
    );
    globalThis.document = window.document as unknown as Document;
    try {
      const image = jsx("img", { src: "/images/hero.jpg" });
      const date = new Date("2026-01-01T00:00:00Z");
      const input = jsx("input", { value: date });
      expect((image as HTMLImageElement).getAttribute("src")).toBe(
        "/api/templates/tmp-demo/preview/images/hero.jpg",
      );
      expect((input as HTMLInputElement).value).toBe(String(date));
    } finally {
      globalThis.document = previous;
      window.close();
    }
  });
});
