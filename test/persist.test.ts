import { afterEach, expect, test, setSystemTime } from "bun:test";
import { state } from "@luon/act";
import { persistView, type Persist } from "../src/persist.ts";
import { closeLife, withLife, type ViewLife } from "../src/life.ts";
import { compileView } from "../src/compiler.ts";

const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const lives: ViewLife[] = [];
afterEach(() => {
  for (const life of lives.splice(0)) closeLife(life);
  setSystemTime();
  if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
function memory() {
  const values = new Map<string, string>();
  let writes = 0;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
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
  rules: Persist<Data>,
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

test("expiry uses seconds and reopening does not renew the saved timestamp", () => {
  const store = memory();
  const start = 1_800_000_000_000;
  setSystemTime(start);
  const rules = { profile: { fields: ["name"], expire: 60 } } as const;
  const first = setup({ name: "Kim" }, rules);
  first.data.name = "Jane";
  first.close();
  const key = [...store.values.keys()][0]!;
  const saved = store.values.get(key);
  setSystemTime(start + 59000);
  const second = setup({ name: "Kim" }, rules);
  expect(second.data.name).toBe("Jane");
  expect(store.values.get(key)).toBe(saved);
  second.close();
  setSystemTime(start + 60000);
  const expired = setup({ name: "Kim" }, rules);
  expect(expired.data.name).toBe("Kim");
  expect(store.values.has(key)).toBe(false);
  expired.data.name = "New";
  expect(JSON.parse(store.values.get(key)!)[1]).toBe(start + 60000);
});

test("changes renew expiry; unrelated fields and same values do not", () => {
  const store = memory();
  const start = 1_800_000_000_000;
  setSystemTime(start);
  const rules = { profile: { fields: ["name"], expire: 60 } } as const;
  const app = setup({ name: "Kim", busy: false }, rules);
  const key = [...store.values.keys()][0]!;
  setSystemTime(start + 30000);
  app.data.busy = true;
  app.data.name = "Kim";
  expect(JSON.parse(store.values.get(key)!)[1]).toBe(start);
  app.data.name = "Jane";
  expect(JSON.parse(store.values.get(key)!)[1]).toBe(start + 30000);
  app.close();
  setSystemTime(start + 60000);
  expect(setup({ name: "Kim" }, rules).data.name).toBe("Jane");
});

test("expiry resets an open View and cannot delete a newer writer", async () => {
  const store = memory();
  const rules = { profile: { fields: ["name"], expire: 1 } } as const;
  const first = setup({ name: "Kim" }, rules);
  first.data.name = "Jane";
  const other = setup({ name: "Other" }, rules, "other");
  other.data.name = "Old";
  const key = [...store.values.keys()].find((key) => key.includes("other"))!;
  const newer = JSON.stringify([1, Date.now() + 500, { name: "New" }]);
  store.values.set(key, newer);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  expect(first.data.name).toBe("Kim");
  expect(store.values.size).toBe(1);
  expect(store.values.get(key)).toBe(newer);
  expect(other.data.name).toBe("Other");
  first.data.name = "Again";
  expect(store.values.size).toBe(2);
});

test("legacy unexpired storage is retained; adding expiry discards undated data", () => {
  const store = memory();
  const first = setup({ name: "Kim" }, { profile: ["name"] });
  first.close();
  const key = [...store.values.keys()][0]!;
  store.values.set(key, '{"name":"Legacy"}');
  const old = setup({ name: "Kim" }, { profile: ["name"] });
  expect(old.data.name).toBe("Legacy");
  old.close();
  expect(
    setup(
      { name: "Kim" },
      {
        profile: { fields: ["name"], expire: 60 },
      },
    ).data.name,
  ).toBe("Kim");
  expect(store.values.has(key)).toBe(false);
});

test("expiry requires numeric positive whole seconds in source and manual API", () => {
  memory();
  for (const value of [0, -1, 0.1, Infinity, "7d", "60"]) {
    expect(() =>
      setup(
        { name: "Kim" },
        {
          profile: { fields: ["name"], expire: value as number },
        },
      ),
    ).toThrow("seconds");
  }
  const source = (value: string) => `export const data = { name: "Kim" };
    export const persist = { profile: { fields: ["name"], expire: ${value} } };
    export default () => null;`;
  expect(compileView(source("604800")).code).toContain("604800");
  const output = compileView(source("(3600 * 12)")).code;
  expect(output).toContain("3600 * 12");
  const rules = { profile: { fields: ["name"], expire: 3600 * 12 } } as const;
  const app = setup({ name: "Kim" }, rules);
  app.data.name = "Jane";
  app.close();
  setSystemTime(Date.now() + 3600 * 12 * 1000);
  expect(setup({ name: "Kim" }, rules).data.name).toBe("Kim");
});
