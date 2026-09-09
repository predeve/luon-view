import { expect, test } from "bun:test";
import * as ts from "@typescript/typescript6";
import { resolve } from "node:path";
import { viewTypes } from "../src/editor.ts";

test("timer controls preserve offsets and avoid recursive callback types", () => {
  const file = resolve(import.meta.dir, "../../../luon-temp/timer-type.tsx");
  const input = [
    'export const timer = {',
    '  refresh: { interval: 1000, run: () => timer.refresh.stop() },',
    '};',
    'export default () => null;',
    'timer.refresh.start();',
    'timer.refresh.missing();',
    'timer.refresh.active = true;',
  ].join("\n");
  const source = viewTypes(input, file);
  expect(source.indexOf("timer.refresh.missing()"))
    .toBe(input.indexOf("timer.refresh.missing()"));
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true,
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile;
  host.readFile = path => path === file ? source : read(path);
  const program = ts.createProgram([file], options, host);
  const issues = ts.getPreEmitDiagnostics(program)
    .filter(item => item.file?.fileName === file);
  expect(issues.map(item => item.code)).toEqual([2339, 2540]);
});
