import * as ts from "@typescript/typescript6";

export type SourcePoint = {
  file: string;
  line: number;
  column: number;
  start: number;
  length: number;
};

export class CompileError extends Error {
  readonly location?: SourcePoint;

  constructor(message: string, location?: SourcePoint) {
    super(location
      ? `${location.file}:${location.line}:${location.column} ${message}`
      : message);
    this.name = "CompileError";
    this.location = location;
  }
}

export function sourcePoint(file: ts.SourceFile, start: number, length = 1) {
  const point = file.getLineAndCharacterOfPosition(start);
  return {
    file: file.fileName, start, length: Math.max(1, length),
    line: point.line + 1, column: point.character + 1,
  };
}

export function failSource(
  file: ts.SourceFile, node: ts.Node, message: string,
): never {
  throw new CompileError(message, sourcePoint(
    file, node.getStart(file), node.getWidth(file),
  ));
}

// Validate before generated wrappers change source offsets.
export function checkBinds(file: ts.SourceFile) {
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)
      && /^bind(?:[A-Z].*)?$/.test(node.name.text)) {
      const init = node.initializer;
      if (!init || !ts.isJsxExpression(init) || !init.expression) {
        failSource(file, node, "Bind requires a mutable state expression.");
      }
      const tag = (node.parent.parent as
        ts.JsxOpeningElement | ts.JsxSelfClosingElement).tagName.getText(file);
      if (/^[a-z]/.test(tag) && node.name.text !== "bind") {
        failSource(file, node, "Named bind is only supported on components.");
      }
      const value = init.expression;
      if (!ts.isIdentifier(value)
        && !(ts.isPropertyAccessExpression(value) && !value.questionDotToken)
        && !(ts.isElementAccessExpression(value) && !value.questionDotToken)) {
        failSource(file, value, "Bind target must be a variable or property.");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}
