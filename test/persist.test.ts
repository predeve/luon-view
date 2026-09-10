import { afterEach, expect, test } from "bun:test";
import { state } from "@luon/act";
import { persistView } from "../src/persist.ts";
import { closeLife, withLife, type ViewLife } from "../src/life.ts";
import { compileView } from "../src/compiler.ts";

const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const lives: ViewLife[] = [];
afterEach(() => {
  for (const life of lives.splice(0)) closeLife(life);
  if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
function memory() {
  const values = new Map<string, string>();
  let writes = 0;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) {
      writes++;
      values.set(key, value);
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
  return { values, storage, writes: () => writes };
}
function setup<Data extends Record<string, unknown>>(
  value: Data,
  rules: Record<string, readonly (keyof Data & string)[]>,
  scope = "pages/settings.tsx",
) {
  const life: ViewLife = { load: [], close: [] };
  lives.push(life);
  const data = state(value);
  withLife(life, () => persistView(data, rules, scope));
  return { data, close: () => closeLife(life) };
}

test("selected fields restore; nested changes save; close stops writes", () => {
  const store = memory();
  const rules = { preferences: ["theme", "layout"] } as const;
  const initial = () => ({
    theme: "dark",
    loading: false,
    layout: { open: true, order: [1, 2] },
  });
  const first = setup(initial(), rules);
  first.data.theme = "light";
  first.data.layout.order.push(3);
  delete (first.data.layout as { open?: boolean }).open;
  const writes = store.writes();
  first.data.loading = true;
  expect(store.writes()).toBe(writes);
  first.close();
  first.data.theme = "closed";
  expect(store.writes()).toBe(writes);
  const second = setup(initial(), rules);
  expect(second.data.theme).toBe("light");
  expect(second.data.layout.order).toEqual([1, 2, 3]);
  expect(Object.hasOwn(second.data.layout, "open")).toBe(false);
  expect(second.data.loading).toBe(false);
});

test("keys and View scopes stay independent; missing fields keep defaults", () => {
  const store = memory();
  const first = setup(
    { theme: "dark", name: "Kim" },
    { preferences: ["theme"], profile: ["name"] },
  );
  first.data.theme = "light";
  first.data.name = "Jane";
  first.close();
  const second = setup(
    { theme: "dark", name: "Kim", size: 10 },
    { preferences: ["theme", "size"], profile: ["name"] },
  );
  expect(second.data).toEqual({ theme: "light", name: "Jane", size: 10 });
  const other = setup({ theme: "dark" }, { preferences: ["theme"] }, "other");
  expect(other.data.theme).toBe("dark");
  expect(store.values.size).toBe(3);
});

test("invalid JSON, stale field types and prototype keys cannot corrupt state", () => {
  const store = memory();
  const first = setup(
    { count: 1, info: { name: "Kim" } },
    { preferences: ["count", "info"] },
  );
  first.close();
  const key = [...store.values.keys()][0]!;
  store.values.set(
    key,
    '{"count":"wrong","extra":123,"info":{"name":"Jane",' +
      '"__proto__":{"polluted":true}}}',
  );
  const next = setup(
    { count: 1, info: { name: "Kim" } },
    { preferences: ["count", "info"] },
  );
  expect(next.data.count).toBe(1);
  expect(next.data.info).toEqual({ name: "Jane" });
  expect(Object.hasOwn(next.data, "extra")).toBe(false);
  expect(({} as any).polluted).toBeUndefined();
  next.close();
  store.values.set(key, "{broken");
  expect(setup({ count: 1 }, { preferences: ["count"] }).data.count).toBe(1);
});

test("unavailable storage, quota and unsupported values keep memory usable", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("Blocked");
    },
  });
  const blocked = setup({ count: 0 }, { preferences: ["count"] });
  blocked.data.count++;
  expect(blocked.data.count).toBe(1);
  const store = memory();
  const app = setup(
    { value: { name: "Kim" } as any },
    { preferences: ["value"] },
  );
  const saved = [...store.values.values()][0];
  app.data.value = 1n;
  expect([...store.values.values()][0]).toBe(saved);
  store.storage.setItem = () => {
    throw new Error("Quota");
  };
  expect(() => {
    app.data.value = { name: "Jane" };
  }).not.toThrow();
});

test("declarations reject missing and repeated fields", () => {
  memory();
  expect(() => setup({ theme: "dark" }, { a: ["missing" as "theme"] })).toThrow(
    "Invalid or repeated",
  );
  expect(() =>
    setup({ theme: "dark" }, { a: ["theme"], b: ["theme"] }),
  ).toThrow("Invalid or repeated");
  for (const source of [
    'export const persist = { a: ["theme"] };',
    "export const data = {}; export const persist = [];",
    "export const data = {}; export const persist = { a: getFields() };",
  ])
    expect(() => compileView(source + "export default () => null;")).toThrow();
});

test("compiler restores after data and before computed, independent of order", () => {
  const source = `export const persist = { preferences: ["theme"] };
    export const data = { theme: "dark" };
    export const computed = { theme: () => data.theme.toUpperCase() };
    export default () => <p>{computed.theme()}</p>;`;
  const first = compileView(source, {
    id: "/build/a/app/pages/settings.tsx",
  }).code;
  const next = compileView(source, {
    id: "/build/b/app/pages/settings.tsx",
  }).code;
  expect(first.indexOf("__persist(data")).toBeGreaterThan(
    first.indexOf("__state("),
  );
  expect(first.indexOf("__persist(data")).toBeLessThan(
    first.indexOf("__computed("),
  );
  expect(first).toContain('"pages/settings.tsx"');
  expect(next).toContain('"pages/settings.tsx"');
});
