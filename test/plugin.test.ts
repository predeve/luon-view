import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import viewPlugin from "../src/plugin.ts";

test("Bun plugin builds an app view", async () => {
  const root = await mkdtemp(join(tmpdir(), "luon-view-"));
  const app = join(root, "app");
  const out = join(root, "dist");

  try {
    await mkdir(app);
    await Bun.write(join(app, "plugin-view.tsx"), `
      export const data = { name: "Luon" };
      export default () => <input bind={data.name} />;
    `);
    await Bun.write(join(app, "helper.tsx"), "export const value = 1;");

    const result = await Bun.build({
      entrypoints: [
        join(app, "helper.tsx"),
        join(app, "plugin-view.tsx"),
      ],
      external: ["@luon/rule", "@luon/view", "@luon/view/jsx-runtime"],
      outdir: out,
      plugins: [viewPlugin],
      target: "browser",
    });

    expect(result.success).toBeTrue();
    expect(result.outputs).toHaveLength(2);

    const output = result.outputs.find((item) => {
      return item.path.endsWith("plugin-view.js");
    });
    const code = await output?.text();
    expect(code).toContain("componentView");
    expect(code).toContain("bindView");
    expect(code).toContain("PluginView");

    const helper = result.outputs.find((item) => {
      return item.path.endsWith("helper.js");
    });
    expect(await helper?.text()).toContain("value = 1");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Bun plugin builds a package view", async () => {
  const root = await mkdtemp(join(tmpdir(), "luon-package-view-"));
  const entry = join(root, "button.view.tsx");

  try {
    await Bun.write(entry, `
      export default () => <button>Save</button>;
    `);
    const result = await Bun.build({
      entrypoints: [entry],
      external: ["@luon/view", "@luon/view/jsx-runtime"],
      plugins: [viewPlugin],
      target: "browser",
    });
    const code = await result.outputs[0]?.text();

    expect(result.success).toBeTrue();
    expect(code).toContain("componentView");
    expect(code).toContain("Button");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Bun plugin builds named Views with connected events", async () => {
  const root = await mkdtemp(join(tmpdir(), "luon-named-view-"));
  const entry = join(root, "controls.view.tsx");

  try {
    await Bun.write(entry, `
      export const datas = {
        Counter: { count: 0 },
      };
      export const events = {
        Counter: {
          add() { data.count++; },
          document: { beforeinput() { data.count++; } },
        },
      };
      export const group = {
        Counter: [Label],
      };
      export function Counter() {
        return <button onClick={event.add}>{data.count}</button>;
      }
      export const Label = () => <span>Ready</span>;
    `);
    const result = await Bun.build({
      entrypoints: [entry],
      external: ["@luon/view", "@luon/view/jsx-runtime"],
      plugins: [viewPlugin],
      target: "browser",
    });
    const code = await result.outputs[0]?.text();

    expect(result.success).toBeTrue();
    expect(code).toContain("Counter = (() =>");
    expect(code).toContain("Label = (() =>");
    expect(code).toContain("eventView");
    expect(code).toContain("groupView");
    expect(code).toContain("beforeinput");
    expect(code).toContain("event.add");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Bun plugin exposes the automatic Rule entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "luon-view-rule-"));
  const app = join(root, "app");
  const out = join(root, "dist");

  try {
    await mkdir(app);
    await Bun.write(join(app, "rule-view.tsx"), `
      const Input = rule.object({ name: r.string(1, 40) });
      export default () => <main>{Input.parse({ name: "Luon" }).name}</main>;
    `);
    const result = await Bun.build({
      entrypoints: [join(app, "rule-view.tsx")],
      external: ["@luon/rule", "@luon/view", "@luon/view/jsx-runtime"],
      outdir: out,
      plugins: [viewPlugin],
      target: "browser",
    });
    const code = await result.outputs[0]?.text();

    expect(result.success).toBeTrue();
    expect(code).toContain("@luon/rule");
    expect(code).toContain("Input.parse");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Bun removes the automatic Rule entry when it is unused", async () => {
  const root = await mkdtemp(join(tmpdir(), "luon-view-rule-unused-"));
  const entry = join(root, "entry.ts");
  const rule = join(import.meta.dir, "../../rule/src/index.ts");

  try {
    await Bun.write(entry, `
      import { rule } from ${JSON.stringify(rule)};
      export const value = 1;
    `);
    const result = await Bun.build({
      entrypoints: [entry],
      minify: true,
      target: "browser",
    });
    const code = await result.outputs[0]?.text();

    expect(result.success).toBeTrue();
    expect(code).not.toContain("RuleError");
    expect(code?.length).toBeLessThan(80);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
