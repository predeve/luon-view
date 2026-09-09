import { expect, test } from "bun:test";
import { CompileError, compileView } from "../src/compiler.ts";
import { ViewError } from "../src/error.ts";
import { viewSource } from "../src/source.ts";
import { computedView } from "../src/index.ts";
import { closeLife, withLife, type ViewLife } from "../src/life.ts";

const id = "app/profile.tsx";

test("bind errors point to original Unicode source before wrapping", () => {
  const source = [
    'export const data = { name: "이름" };',
    'export default () => <input bind={data.name + "!"} />;',
  ].join("\n");
  try {
    compileView(source, { id });
    throw Error("Expected a compile error");
  } catch (error) {
    expect(error).toBeInstanceOf(CompileError);
    const point = (error as CompileError).location!;
    expect(point.file).toBe(id);
    expect(point.line).toBe(2);
    expect(source.slice(point.start, point.start + point.length))
      .toBe('data.name + "!"');
    expect((error as Error).message).toContain(`${id}:2:${point.column}`);
  }
});

test("parse and named View bind errors retain original positions", () => {
  for (const source of [
    'export const data = {\n name: ;\n};',
    'export function Field() {\n return <input bindValue={data.name} />;\n}',
  ]) {
    try {
      compileView(source, { id });
      throw Error("Expected a compile error");
    } catch (error) {
      expect(error).toBeInstanceOf(CompileError);
      expect((error as CompileError).location?.line).toBe(2);
    }
  }
});

test("runtime frames show handler definitions without replacing the cause", () => {
  const source = [
    'export const event = {',
    '  async save() { await Promise.resolve(); throw Error("failed"); },',
    '};',
    'export default () => <button onClick={event.save} />;',
  ].join("\n");
  const origin = viewSource(source, id);
  expect(origin.line).toBe(4);
  const cause = Error("failed");
  const error = new ViewError(cause, {
    ...origin, view: "Profile", phase: "event.save",
  });
  expect(error.frames[0]?.line).toBe(2);
  expect(error.frames[0]?.column).toBe(3);
  expect(error.message).toContain(`${id}:2:3`);
  expect(error.cause).toBe(cause);
  expect(error.frames[0]).not.toHaveProperty("points");
  expect(compileView(source, { id }).code).toContain('"event.save"');
});

test("named and batched Views carry their own definition locations", () => {
  const source = [
    'export function First() { return <p>First</p>; }',
    'export const Second = () => <p>Second</p>;',
  ].join("\n");
  const origin = viewSource(source, id);
  expect(origin.views?.First?.line).toBe(1);
  expect(origin.views?.Second?.line).toBe(2);
  for (const batch of [false, true]) {
    const output = compileView(source, { id, batch }).code;
    expect(output).toContain('"line": 2');
    expect(output).toContain('"file": "app/profile.tsx"');
  }
});

test("computed writes require setters and setter exceptions keep context", () => {
  const value = computedView({
    read: () => 4,
    getter: { get: () => 5 },
    write: { get: () => 6, set: (_value: number) => {} },
  });
  expect(() => (value.read as Function)(10)).toThrow("read-only");
  expect(() => (value.getter as Function)(10)).toThrow("Add a setter");
  expect(value.write(10)).toBe(6);
});


test("setter failures report their computed definition", () => {
  const cause = Error("invalid name");
  const life: ViewLife = {
    close: [], load: [], frame: {
      view: "Profile", file: id, phase: "setup",
      points: { "computed.name": { line: 8, column: 3 } },
    },
  };
  const value = withLife(life, () => computedView({
    name: { get: () => "Luon", set: (_name: string) => { throw cause; } },
  }));
  try {
    value.name("bad");
    throw Error("Expected a setter failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ViewError);
    expect((error as ViewError).frames[0]?.line).toBe(8);
    expect((error as ViewError).cause).toBe(cause);
  } finally {
    closeLife(life);
  }
});
