import { createHash } from "node:crypto";
import * as ts from "@typescript/typescript6";

export type ContentField = {
  end: number;
  kind: "attribute" | "text";
  name: string;
  source: string;
  start: number;
  value: string;
};

export type ContentMark = {
  dynamic: string[];
  fields: ContentField[];
  hash: string;
  image?: { dynamic: boolean; field?: ContentField; source: string };
  node: { end: number; start: number };
  path: string;
  tag: { class?: ContentField; dynamic: boolean };
};

export type ContentChange = Omit<ContentField, "value"> & { value: string };

const attrs = new Set(["alt", "aria-label", "label", "placeholder", "title"]);

function filePath(path: string) {
  const value = path.replaceAll("\\", "/");
  return value.match(/\/(app\/(?:components|layouts|pages)\/.+\.tsx)$/)?.[1]
    || value;
}

function digest(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

function field(node: ts.StringLiteral, name: string): ContentField {
  return {
    end: node.end - 1,
    kind: "attribute",
    name,
    source: node.text,
    start: node.getStart() + 1,
    value: node.text,
  };
}

function textField(node: ts.JsxText): ContentField | undefined {
  const source = node.getText();
  const left = source.length - source.trimStart().length;
  const right = source.trimEnd().length;
  if (right <= left) return;
  return {
    end: node.getStart() + right,
    kind: "text",
    name: "text",
    source: source.slice(left, right),
    start: node.getStart() + left,
    value: source.slice(left, right),
  };
}

function parts(node: ts.JsxElement | ts.JsxSelfClosingElement) {
  const open = ts.isJsxElement(node) ? node.openingElement : node;
  const tag = open.tagName.getText();
  const properties = open.attributes.properties;
  const direct = ts.isJsxElement(node) ? node.children : [];
  const fields = direct.flatMap((child) => {
    if (!ts.isJsxText(child)) return [];
    const value = textField(child);
    return value ? [value] : [];
  });
  const dynamic: string[] = [];
  let image: ContentMark["image"];
  let classField: ContentField | undefined;
  let classDynamic = false;
  for (const prop of properties) {
    if (!ts.isJsxAttribute(prop)) continue;
    const name = prop.name.getText();
    const value = prop.initializer;
    if (value && ts.isStringLiteral(value)) {
      const item = field(value, name);
      if (attrs.has(name)) fields.push(item);
      if (name === "class" || name === "className") classField = item;
      if (tag.toLowerCase() === "img" && name === "src") {
        image = { dynamic: false, field: item, source: item.value };
      }
    } else if (attrs.has(name) || ["src", "class", "className"].includes(name)) {
      dynamic.push(value?.getText() || name);
      if (name === "class" || name === "className") classDynamic = true;
      if (tag.toLowerCase() === "img" && name === "src") {
        image = { dynamic: true, source: "" };
      }
    }
  }
  for (const child of direct) {
    if (ts.isJsxExpression(child) && child.expression) {
      dynamic.push(child.expression.getText());
    }
  }
  if (tag.toLowerCase() === "img" && !image) {
    image = { dynamic: false, source: "" };
  }
  return { classDynamic, classField, dynamic, fields, image, open, tag };
}

export function contentMarks(path: string, source: string) {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const hash = digest(source);
  const output: ContentMark[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const item = parts(node);
      output.push({
        dynamic: [...new Set(item.dynamic)],
        fields: item.fields,
        hash,
        image: item.image,
        node: { end: node.end, start: node.getStart() },
        path: filePath(path),
        tag: { class: item.classField, dynamic: item.classDynamic },
      });
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return output;
}

function insertPoint(node: ts.JsxElement | ts.JsxSelfClosingElement) {
  const open = ts.isJsxElement(node) ? node.openingElement : node;
  return open.end - (ts.isJsxSelfClosingElement(node) ? 2 : 1);
}

export function injectContent(path: string, source: string) {
  const marks = contentMarks(path, source);
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const inserts: Array<{ at: number; text: string }> = [];
  let index = 0;
  const walk = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const open = ts.isJsxElement(node) ? node.openingElement : node;
      const exists = open.attributes.properties.some((prop) => (
        ts.isJsxAttribute(prop) && prop.name.getText() === "data-luon-edit"
      ));
      const mark = marks[index++];
      if (!exists && mark) {
        const value = encodeURIComponent(JSON.stringify(mark));
        inserts.push({ at: insertPoint(node), text: ` data-luon-edit="${value}"` });
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  let result = source;
  for (const item of inserts.toSorted((a, b) => b.at - a.at)) {
    result = result.slice(0, item.at) + item.text + result.slice(item.at);
  }
  return result;
}

function escapeText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

function escapeAttr(value: string, quote: string) {
  let output = escapeText(value);
  if (quote === "\"") output = output.replaceAll("\"", "&quot;");
  if (quote === "'") output = output.replaceAll("'", "&#39;");
  return output;
}

export function patchContent(source: string, changes: ContentChange[]) {
  const fields = contentMarks("app/content.tsx", source).flatMap((mark) => [
    ...mark.fields,
    ...(mark.image?.field ? [mark.image.field] : []),
    ...(mark.tag.class ? [mark.tag.class] : []),
  ]);
  const edits = changes.map((input) => {
    const found = fields.find((item) => item.start === input.start
      && item.end === input.end && item.kind === input.kind
      && item.name === input.name && item.source === input.source);
    if (!found || source.slice(found.start, found.end) !== found.source) {
      throw new Error("The content location changed. Select it again in Preview.");
    }
    const quote = input.kind === "attribute" ? source[found.start - 1] || "\"" : "";
    return {
      ...found,
      value: input.kind === "attribute"
        ? escapeAttr(input.value, quote) : escapeText(input.value),
    };
  });
  if (new Set(edits.map((item) => `${item.start}:${item.end}`)).size !== edits.length) {
    throw new Error("Duplicate content edit locations were found.");
  }
  let output = source;
  for (const item of edits.toSorted((a, b) => b.start - a.start)) {
    output = output.slice(0, item.start) + item.value + output.slice(item.end);
  }
  return output;
}

export function removeContent(source: string, start: number, end: number) {
  const found = contentMarks("app/content.tsx", source)
    .some((mark) => mark.node.start === start && mark.node.end === end);
  if (!found) throw new Error("The content location changed. Select it again in Preview.");
  return source.slice(0, start) + source.slice(end);
}
