import { afterEach, expect, test } from "bun:test";
import { apiView } from "../src/api.ts";
import { closeLife, withLife, type ViewLife } from "../src/life.ts";
import { compileView, viewTypes } from "../src/compiler.ts";
import * as ts from "@typescript/typescript6";
import { resolve } from "node:path";

const original = globalThis.fetch;
const lives: ViewLife[] = [];
afterEach(() => {
  globalThis.fetch = original;
  for (const life of lives.splice(0)) closeLife(life);
});
function setup<Rules extends Parameters<typeof apiView>[0]>(rules: Rules) {
  const life: ViewLife = { load: [], close: [] };
  lives.push(life);
  return { life, api: withLife(life, () => apiView(rules)) };
}
function fake(run: (url: URL, init: RequestInit) => Promise<Response>) {
  globalThis.fetch = ((url: string | URL, init: RequestInit) =>
    run(new URL(url), init)) as typeof fetch;
}

test("defaults, JSON calls, query, encoded paths and empty responses", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  fake(async (url, init) => {
    calls.push({ url, init });
    return init.method === "DELETE"
      ? new Response(null, { status: 204 })
      : Response.json({ name: "Luon" });
  });
  const { api } = setup({
    users: { url: "/users" },
    save: { url: "/users/:id", method: "POST" },
    remove: { url: "/users/:id", method: "DELETE" },
  });
  expect(await api.users<{ name: string }>({ page: 2, empty: null })).toEqual({
    name: "Luon",
  });
  expect(calls[0]!.url.pathname).toBe("/api/users");
  expect(calls[0]!.url.search).toBe("?page=2");
  expect(calls[0]!.init.credentials).toBe("same-origin");
  expect(new Headers(calls[0]!.init.headers).get("accept")).toBe(
    "application/json",
  );
  await api.save({ name: "Luon" }, { params: { id: "a/b ?" } });
  expect(calls[1]!.url.pathname).toBe("/api/users/a%2Fb%20%3F");
  expect(calls[1]!.init.body).toBe('{"name":"Luon"}');
  expect(new Headers(calls[1]!.init.headers).get("content-type")).toBe(
    "application/json",
  );
  expect(await api.remove(undefined, { params: { id: 1 } })).toBeUndefined();
  await expect(api.save({})).rejects.toThrow("Missing API parameter: id");
});

test("endpoint options override common settings and merge header keys", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  fake(async (url, init) => {
    calls.push({ url, init });
    return new Response("ok");
  });
  const { api } = setup({
    config: {
      base: "https://example.com/v1",
      cookie: false,
      timeout: 100,
      headers: { Accept: "text/plain", "X-App": "luon" },
    },
    list: { url: "/list" },
    other: {
      url: "/other",
      base: "/v2",
      cookie: "include",
      headers: { accept: "application/json", "X-Local": "yes" },
    },
  });
  await api.list();
  await api.other();
  expect(calls[0]!.url.href).toBe("https://example.com/v1/list");
  expect(calls[0]!.init.credentials).toBe("omit");
  expect(calls[1]!.url.pathname).toBe("/v2/other");
  expect(calls[1]!.init.credentials).toBe("include");
  const headers = new Headers(calls[1]!.init.headers);
  expect(headers.get("accept")).toBe("application/json");
  expect(headers.get("x-app")).toBe("luon");
  expect(headers.get("x-local")).toBe("yes");
});

test("HTTP errors retain status and data, notify once, and reject", async () => {
  const errors: unknown[] = [];
  fake(async () => Response.json({ error: "Denied" }, { status: 403 }));
  const { api } = setup({
    config: {
      onError: () => {
        throw new Error("Common handler must be overridden");
      },
    },
    list: { url: "/list", onError: (error) => errors.push(error) },
  });
  const error = (await api.list().catch((error) => error)) as Error & {
    status: number;
    data: unknown;
  };
  expect(error.message).toBe("Denied");
  expect(error.status).toBe(403);
  expect(error.data).toEqual({ error: "Denied" });
  expect(errors).toEqual([error]);
});

test("timeout covers body reading; caller and owner cancellation are isolated", async () => {
  const errors: unknown[] = [];
  const signals: AbortSignal[] = [];
  fake(async (_url, init) => {
    const signal = init.signal!;
    signals.push(signal);
    return new Response(
      new ReadableStream({
        start(controller) {
          signal.addEventListener(
            "abort",
            () => controller.error(signal.reason),
            { once: true },
          );
        },
      }),
    );
  });
  const rules = {
    list: {
      url: "/list",
      timeout: 20,
      onError: (error: unknown) => errors.push(error),
    },
  };
  const first = setup(rules);
  await expect(first.api.list()).rejects.toHaveProperty("name", "TimeoutError");
  expect(errors).toHaveLength(1);
  const second = setup({ list: { url: "/list", timeout: 1000 } });
  const controller = new AbortController();
  const a = first.api.list().catch((error) => error);
  const b = second.api
    .list(undefined, { signal: controller.signal })
    .catch((error) => error);
  closeLife(first.life);
  expect(signals[1]!.aborted).toBe(true);
  expect(signals[2]!.aborted).toBe(false);
  controller.abort();
  expect(((await a) as Error).name).toBe("AbortError");
  expect(((await b) as Error).name).toBe("AbortError");
  expect(errors).toHaveLength(1);
  await expect(first.api.list()).rejects.toHaveProperty("name", "AbortError");
  expect(signals).toHaveLength(3);
});

test("compiler and editor expose callable endpoints with stable offsets", () => {
  const input = `export const api = {
    config: { timeout: 3000 },
    users: { url: "/users" },
  };
  async function load() { return api.users<{name: string}>(); }
  api.missing();
  export default () => null;`;
  const code = compileView(input, { id: "api.view.tsx" }).code;
  expect(code).toContain("apiView");
  expect(code).toContain("__api(");
  expect(() =>
    compileView("export const api = []; export default () => null;"),
  ).toThrow("object literal");
  const file = resolve("luon-temp/api-editor.tsx");
  const source = viewTypes(input, file);
  expect(source.indexOf("api.missing()")).toBe(input.indexOf("api.missing()"));
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile;
  host.readFile = (path) => (path === file ? source : read(path));
  const program = ts.createProgram([file], options, host);
  const issues = ts
    .getPreEmitDiagnostics(program)
    .filter((item) => item.file?.fileName === file);
  expect(issues.map((item) => item.code)).toEqual([2339]);
});

test("timeout settles even if a native adapter ignores its abort signal", async () => {
  let finish!: (response: Response) => void;
  fake(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { api } = setup({ slow: { url: "/slow", timeout: 5 } });
  await expect(api.slow()).rejects.toHaveProperty("name", "TimeoutError");
  finish(Response.json({ late: true }));
});
