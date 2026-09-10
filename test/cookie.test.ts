import { afterEach, expect, test } from "bun:test";
import { effect } from "@luon/act";
import { Window } from "happy-dom";
import { cookie, cookieView } from "../src/cookie.ts";
import { withLife } from "../src/life.ts";
import { compileView, viewTypes } from "../src/compiler.ts";
import * as ts from "@typescript/typescript6";
import { resolve } from "node:path";

const original = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "document", original);
  else Reflect.deleteProperty(globalThis, "document");
});
function documentFor(url = "https://example.com/settings") {
  const dom = new Window({ url });
  Object.defineProperty(globalThis, "document", {
    value: dom.document,
    configurable: true,
  });
  return dom.document;
}
function setup<Rules extends Parameters<typeof cookieView>[0]>(rules: Rules) {
  return withLife({ load: [], close: [] }, () => cookieView(rules));
}

test("undeclared reads neither create cookies nor require a View", () => {
  const doc = documentFor();
  expect(cookie.missing).toBeNull();
  expect(doc.cookie).toBe("");
  doc.cookie = "language=ko; Path=/";
  expect(cookie.language).toBe("ko");
  expect(() => {
    cookie.unknown = "value";
  }).toThrow("Declare cookie.unknown");
  const config = setup({ language: { value: "en", expire: 86400 * 30 } });
  expect(config.language).toBe("ko");
  expect(doc.cookie).toBe("language=ko");
});

test("declared writes encode strings, update other readers and allow deletion", () => {
  const doc = documentFor();
  const values: Array<string | null | undefined> = [];
  const stop = effect(() => {
    values.push(cookie.language);
  });
  try {
    const config = setup({ language: { value: "en", expire: 3600 * 12 } });
    expect(values.at(-1)).toBe("en");
    config.language = "한국어; name=value";
    expect(cookie.language).toBe("한국어; name=value");
    expect(doc.cookie).toContain(encodeURIComponent("한국어; name=value"));
    expect(doc.cookie).not.toContain("; name=");
    config.language = null;
    expect(cookie.language).toBeNull();
    expect(values.at(-1)).toBeNull();
    expect(doc.cookie).toBe("");
  } finally {
    stop();
  }
});

test("read and equal assignment do not renew expiry; attributes use seconds", () => {
  const writes: string[] = [];
  let text = "";
  const doc = {
    location: { protocol: "https:" },
    get cookie() {
      return text;
    },
    set cookie(value: string) {
      writes.push(value);
      text = value.split(";")[0]!;
    },
  };
  Object.defineProperty(globalThis, "document", {
    value: doc,
    configurable: true,
  });
  const config = setup({ language: { value: "en", expire: 3600 * 12 } });
  expect(writes).toEqual([
    "language=en; Path=/; SameSite=Lax; Secure; Max-Age=43200",
  ]);
  expect(cookie.language).toBe("en");
  setup({ language: { value: "de", expire: 60 } });
  config.language = "en";
  expect(writes).toHaveLength(1);
  config.language = "ko";
  expect(writes.at(-1)).toContain("Max-Age=60");
  config.language = null;
  expect(writes.at(-1)).toContain("Max-Age=0");
});

test("documents do not share rules; invalid declarations fail before writing", () => {
  const doc = documentFor("http://localhost/");
  expect(() => setup({ good: { value: "en" }, bad: { expire: -1 } })).toThrow(
    "seconds",
  );
  expect(doc.cookie).toBe("");
  const config = setup({ language: { value: "en" } });
  expect(() => {
    (config as any).language = 2;
  }).toThrow("strings");
  documentFor("https://other.example/");
  expect(cookie.language).toBeNull();
  expect(() => {
    cookie.language = "ko";
  }).toThrow("Declare");
});

test("compiler and editor expose writable cookie values instead of rules", () => {
  const input = `export const cookie = {
    language: { value: "en", expire: (3600 * 12) },
  };
  cookie.language = "ko";
  cookie.language = null;
  cookie.language = 123;
  export default () => <p>{cookie.language}</p>;`;
  const code = compileView(input, { id: "cookie.view.tsx" }).code;
  expect(code).toContain("__cookie(");
  expect(code).toContain("__live(");
  expect(() =>
    compileView("export const cookie = []; export default () => null;"),
  ).toThrow("object literal");
  const file = resolve("luon-temp/cookie-editor.tsx");
  const source = viewTypes(input, file);
  expect(source.indexOf("cookie.language = 123")).toBe(
    input.indexOf("cookie.language = 123"),
  );
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: "@luon/view",
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile;
  host.readFile = (path) => (path === file ? source : read(path));
  const program = ts.createProgram([file], options, host);
  const issues = ts
    .getPreEmitDiagnostics(program)
    .filter((item) => item.file?.fileName === file);
  expect(issues.map((item) => item.code)).toEqual([2322]);
});
