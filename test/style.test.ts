import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import {
  deepView,
  dynamicView,
  styleView,
} from "../src/style.ts";
import { styleState } from "../src/style-state.ts";

const window = new Window();
Object.assign(globalThis, { document: window.document });

afterEach(() => {
  document.head.replaceChildren();
});

describe("styleView", () => {
  test("keeps direct rule assignments over refreshed values", () => {
    let width = 480;
    const source = styleState(() => ({ main: { width } }));

    source.rules.main.width = 480;
    width = 720;

    expect(source.refresh().main.width).toBe(480);
  });

  test("creates scoped CSS and reusable class names", () => {
    const styles = styleView("abc123", {
      main: {
        fontSize: 16,
        lineHeight: 1.5,
        opacity: 0.8,
        padding: 24,
        width: "80%",
      },
    });
    const css = document.head.textContent;

    expect(styles.main).toBe("luon-abc123-0");
    expect(css).toContain(':where([data-luon-s="abc123"]):where(main)');
    expect(css).toContain(":where(.luon-abc123-0)");
    expect(css).toContain("font-size:16px");
    expect(css).toContain("line-height:1.5");
    expect(css).toContain("opacity:0.8");
    expect(css).toContain("padding:24px");
    expect(css).toContain("width:80%");
  });

  test("updates one style element with nested and responsive rules", () => {
    const first = styleView("same", {
      ".button": {
        "&:hover": { color: "red" },
        color: "black",
      },
      "@media (max-width: 640px)": {
        main: { padding: 16 },
      },
    });
    styleView("same", { main: { padding: 8 } });

    expect(first[".button"]).toBe("luon-same-0");
    expect(document.head.querySelectorAll("style")).toHaveLength(1);
    expect(document.head.textContent).toContain("padding:8px");
    expect(document.head.textContent).not.toContain("color:black");
  });

  test("keeps one named class through responsive rules", () => {
    const styles = styleView("screen", {
      page: { padding: 8 },
      "@media (min-width: 640px)": {
        page: { padding: 16 },
      },
    });
    const css = document.head.textContent;

    expect(styles.page).toBe("luon-screen-0");
    expect(css.match(/\.luon-screen-0/g)).toHaveLength(2);
    expect(css).not.toContain("luon-screen-1");
  });

  test("keeps dynamic rules callable and merges explicit styles last", () => {
    const styles = styleView("dynamic", {
      main: () => ({ opacity: 0.5, width: 480 }),
    });

    expect(styles.main()).toEqual({ opacity: 0.5, width: 480 });
    expect(dynamicView(styles.main, { width: 720 })).toEqual({
      opacity: 0.5,
      width: 720,
    });
    expect(document.head.textContent).toBe("");
  });

  test("keeps Tailwind class rules without generating CSS", () => {
    const styles = styleView("tailwind", {
      main: [
        "mx-auto max-w-xl",
        ["space-y-3", "rounded-md"],
      ],
    });

    expect(styles.main).toBe(
      "mx-auto max-w-xl space-y-3 rounded-md",
    );
    expect(document.head.querySelector("style")).toBeNull();
  });

  test("adds static and dynamic deep styles without losing explicit props", () => {
    const styles = styleView("deep", {
      Button: { padding: 12 },
    }, false);

    expect(styles.Button).toBe("luon-deep-0");
    expect(document.head.textContent).toContain(".luon-deep-0");
    expect(document.head.textContent).toContain("@layer components");
    expect(document.head.textContent).not.toContain("data-luon-s");
    expect(document.head.textContent).not.toContain(
      ":where(.luon-deep-0)",
    );
    expect(deepView("luon-button", {
      class: "primary",
      type: "button",
    })).toEqual({
      class: ["luon-button", "primary"],
      type: "button",
    });
    expect(deepView(
      ({ active }: { active?: boolean }) => ({
        opacity: active ? 1 : 0.5,
        width: 480,
      }),
      { active: true, style: { width: 720 } },
    )).toEqual({
      active: true,
      style: { opacity: 1, width: 720 },
    });
  });
});
