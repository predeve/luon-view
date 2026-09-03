import { describe, expect, test } from "bun:test";

import {
  contentMarks,
  injectContent,
  patchContent,
} from "../src/content.ts";

const source = `export default () => (
  <main class="page"><h1 title="Welcome">Hello Luon</h1>
    <img src="/hero.jpg" alt="Hero" /></main>
);`;

describe("TSX content editing", () => {
  test("injects exact source marks into JSX elements", () => {
    const output = injectContent("/site/app/pages/index.tsx", source);
    expect(output.match(/data-luon-edit=/g)?.length).toBe(3);
    const marks = contentMarks("/site/app/pages/index.tsx", source);
    expect(marks[1]?.path).toBe("app/pages/index.tsx");
    expect(marks[1]?.fields.map((item) => item.name)).toEqual([
      "text",
      "title",
    ]);
    expect(marks[2]?.image?.source).toBe("/hero.jpg");
  });

  test("patches only a verified field location", () => {
    const title = contentMarks("app/pages/index.tsx", source)[1]!.fields
      .find((item) => item.name === "text")!;
    const output = patchContent(source, [{ ...title, value: "Hello Editor" }]);
    expect(output).toContain(">Hello Editor</h1>");
    expect(() => patchContent(output, [{ ...title, value: "stale" }]))
      .toThrow("location changed");
  });
});
