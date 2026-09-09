import * as ts from "@typescript/typescript6";
import type { ViewSource } from "./error.ts";

export function viewSource(source: string, id: string): ViewSource {
  const file = ts.createSourceFile(id, source, ts.ScriptTarget.Latest,
    true, ts.ScriptKind.TSX);
  const result: ViewSource = { file: id, points: {}, views: {} };
  const point = (node: ts.Node) => {
    const value = file.getLineAndCharacterOfPosition(node.getStart(file));
    return { line: value.line + 1, column: value.character + 1 };
  };
  const fields = (node: ts.Node, name: string, target: ViewSource) => {
    if (!ts.isObjectLiteralExpression(node)) return;
    for (const field of node.properties) {
      if (!field.name || ts.isComputedPropertyName(field.name)) continue;
      const key = (field.name as ts.Identifier | ts.StringLiteral).text;
      target.points![`${name}.${key}`] = point(field);
      if (name === "event" && ["load", "close"].includes(key)) {
        target.points![key] = point(field);
      }
    }
  };
  const named = (name: string) => result.views![name] ||= {
    file: id, points: {},
  };
  for (const node of file.statements) {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : [];
    if (!ts.isExportAssignment(node)
      && !modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      continue;
    }
    const isDefault = modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (ts.isExportAssignment(node)) {
      Object.assign(result, point(node.expression));
      result.points!.render = point(node.expression);
    } else if (ts.isFunctionDeclaration(node)) {
      const target = isDefault ? result : node.name && named(node.name.text);
      if (target) {
        Object.assign(target, point(node));
        target.points!.render = point(node);
      }
    } else if (ts.isVariableStatement(node)) {
      for (const item of node.declarationList.declarations) {
        if (!ts.isIdentifier(item.name) || !item.initializer) continue;
        const name = item.name.text;
        if (["event", "computed", "watch", "timer"].includes(name)) {
          fields(item.initializer, name, result);
        } else if (name === "events"
          && ts.isObjectLiteralExpression(item.initializer)) {
          for (const field of item.initializer.properties) {
            if (ts.isPropertyAssignment(field)
              && !ts.isComputedPropertyName(field.name)) {
              const key = (field.name as ts.Identifier | ts.StringLiteral).text;
              fields(field.initializer, "event", named(key));
            }
          }
        } else if (/^[A-Z]/.test(name)
          && (ts.isArrowFunction(item.initializer)
            || ts.isFunctionExpression(item.initializer))) {
          const target = named(name);
          Object.assign(target, point(item));
          target.points!.render = point(item);
        }
      }
    }
  }
  return result;
}
