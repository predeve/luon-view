import * as ts from "@typescript/typescript6";
import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import { checkBinds, CompileError, failSource, sourcePoint }
  from "./diagnostic.ts";
import { viewSource } from "./source.ts";
import type { ViewSource } from "./error.ts";
export { CompileError } from "./diagnostic.ts";
export { viewTypes } from "./editor.ts";

export type CompileOptions = {
  batch?: boolean;
  id?: string;
  reactive?: boolean;
};

export type CompileResult = {
  code: string;
};

type PluralName = "datas" | "events" | "specs" | "styles";

type NamedPart = {
  name: string;
  view: string;
};

type GroupPart = {
  root: string;
  rootView: boolean;
};

type Parts = {
  batchShared: string[];
  body: string[];
  deepKeys: Set<string>;
  deepStyles: boolean;
  event: boolean;
  eventKeys: Set<string>;
  group: boolean;
  groups: Map<string, string[]>;
  head: string[];
  imports: string[];
  named: Set<string>;
  namedParts: NamedPart[];
  plural: Partial<Record<PluralName, string>>;
  pluralValues: Record<PluralName, Map<string, string>>;
  shared: string[];
  singles: Set<string>;
  persist?: string;
  spec?: string;
  types: string[];
  view?: string;
  watch: boolean;
  ruleImport: boolean;
  ruleUse: boolean;
  classOnly: boolean;
  styleStatic: Set<string>;
  styleFns: Set<string>;
  styleReactive: boolean;
  styles: boolean;
  zImport: boolean;
};

type ParsedFile = ts.SourceFile & {
  parseDiagnostics: readonly ts.Diagnostic[];
};

function exported(text: string) {
  return text.replace(/^export\s+(?:default\s+)?/, "");
}

function modifier(node: ts.Node, kind: ts.SyntaxKind) {
  return ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((item) => item.kind === kind);
}

function fail(file: ts.SourceFile, node: ts.Node, message: string): never {
  return failSource(file, node, message);
}

function fieldName(name: ts.PropertyName) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return name.text;
}

function namedViews(file: ts.SourceFile) {
  const names = new Set<string>();
  for (const item of file.statements) {
    if (!modifier(item, ts.SyntaxKind.ExportKeyword)) continue;
    if (
      ts.isFunctionDeclaration(item)
      && !modifier(item, ts.SyntaxKind.DefaultKeyword)
      && item.name
      && /^[A-Z]/.test(item.name.text)
    ) {
      names.add(item.name.text);
      continue;
    }
    if (!ts.isVariableStatement(item)) continue;
    for (const declaration of item.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && /^[A-Z]/.test(declaration.name.text)
        && declaration.initializer
        && (
          ts.isArrowFunction(declaration.initializer)
          || ts.isFunctionExpression(declaration.initializer)
        )
      ) names.add(declaration.name.text);
    }
  }
  return names;
}

function pluralView(
  value: ts.Expression | undefined,
  named: Set<string>,
) {
  if (!value || !ts.isObjectLiteralExpression(value)) return false;
  return value.properties.some((item) => (
    "name" in item && item.name && named.has(fieldName(item.name) || "")
  ));
}

function specValue(value: ts.Expression, file: ts.SourceFile) {
  return ts.isObjectLiteralExpression(value)
    ? `r.object(${value.getText(file)})`
    : value.getText(file);
}

function styleFields(
  value: ts.Expression | undefined,
  functionsOnly = false,
) {
  const names = new Set<string>();
  if (!value || !ts.isObjectLiteralExpression(value)) return names;
  for (const property of value.properties) {
    if (
      !ts.isPropertyAssignment(property)
      && !ts.isMethodDeclaration(property)
      && !ts.isShorthandPropertyAssignment(property)
    ) continue;
    const name = fieldName(property.name);
    if (!name) continue;
    if (!functionsOnly) {
      names.add(name);
      continue;
    }
    if (ts.isMethodDeclaration(property)) {
      names.add(name);
      continue;
    }
    if (
      ts.isPropertyAssignment(property)
      && (
        ts.isArrowFunction(property.initializer)
        || ts.isFunctionExpression(property.initializer)
      )
    ) names.add(name);
  }
  return names;
}

function staticFields(value: ts.Expression | undefined) {
  const names = new Set<string>();
  if (!value || !ts.isObjectLiteralExpression(value)) return names;
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (ts.isArrowFunction(property.initializer)
      || ts.isFunctionExpression(property.initializer)) continue;
    const name = fieldName(property.name);
    if (name && !name.startsWith("@") && !name.startsWith("$")) {
      names.add(name);
    }
  }
  return names;
}

function onlyClasses(value: ts.Expression | undefined) {
  if (!value || !ts.isObjectLiteralExpression(value)) return false;
  return value.properties.length > 0 && value.properties.every((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    return !ts.isObjectLiteralExpression(property.initializer)
      && !ts.isArrowFunction(property.initializer)
      && !ts.isFunctionExpression(property.initializer);
  });
}

function reactiveStyle(value: ts.Expression): boolean {
  if (
    ts.isStringLiteralLike(value)
    || ts.isNumericLiteral(value)
    || [
      ts.SyntaxKind.FalseKeyword,
      ts.SyntaxKind.NullKeyword,
      ts.SyntaxKind.TrueKeyword,
    ].includes(value.kind)
  ) return false;
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    return false;
  }
  if (ts.isParenthesizedExpression(value)) {
    return reactiveStyle(value.expression);
  }
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.some((item) => (
      ts.isExpression(item) && reactiveStyle(item)
    ));
  }
  if (ts.isObjectLiteralExpression(value)) {
    return value.properties.some((property) => {
      if (ts.isPropertyAssignment(property)) {
        return reactiveStyle(property.initializer);
      }
      return !ts.isMethodDeclaration(property);
    });
  }
  if (
    ts.isAsExpression(value)
    || ts.isSatisfiesExpression(value)
    || ts.isTypeAssertionExpression(value)
  ) return reactiveStyle(value.expression);
  if (
    ts.isPrefixUnaryExpression(value)
    && ts.isNumericLiteral(value.operand)
  ) return false;
  return true;
}

function styleRoot(value: ts.Expression): boolean {
  let current = value;
  while (
    ts.isPropertyAccessExpression(current)
    || ts.isElementAccessExpression(current)
  ) current = current.expression;
  return ts.isIdentifier(current)
    && ["style", "styles"].includes(current.text);
}

function styleWrite(node: ts.Node): boolean {
  if (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
    && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) return styleRoot(node.left);
  if (ts.isDeleteExpression(node)) return styleRoot(node.expression);
  if (
    ts.isPostfixUnaryExpression(node)
    || ts.isPrefixUnaryExpression(node)
  ) return styleRoot(node.operand);
  return false;
}

function collect(source: string, id: string) {
  const parts: Parts = {
    batchShared: [],
    body: [],
    deepKeys: new Set(),
    deepStyles: false,
    event: false,
    eventKeys: new Set(),
    group: false,
    groups: new Map(),
    head: [],
    imports: [],
    named: new Set(),
    namedParts: [],
    plural: {},
    pluralValues: {
      datas: new Map(),
      events: new Map(),
      specs: new Map(),
      styles: new Map(),
    },
    shared: [],
    singles: new Set(),
    types: [],
    watch: false,
    ruleImport: false,
    ruleUse: false,
    classOnly: false,
    styleStatic: new Set(),
    styleFns: new Set(),
    styleReactive: false,
    styles: false,
    zImport: false,
  };
  const file = ts.createSourceFile(
    id,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const parse = (file as ParsedFile).parseDiagnostics.find(
    (item) => item.category === ts.DiagnosticCategory.Error,
  );
  if (parse) {
    const message = ts.flattenDiagnosticMessageText(parse.messageText, "\n");
    throw new CompileError(message, sourcePoint(
      file, parse.start ?? 0, parse.length,
    ));
  }
  checkBinds(file);
  parts.named = namedViews(file);

  const findStyleWrite = (node: ts.Node) => {
    if (styleWrite(node)) parts.styleReactive = true;
    ts.forEachChild(node, findStyleWrite);
  };
  findStyleWrite(file);

  const addShared = (text: string) => {
    const value = exported(text);
    parts.batchShared.push(text);
    parts.body.push(value);
    parts.shared.push(value);
  };

  for (const statement of file.statements) {
    const text = statement.getText(file);
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings;
      const imported = ["r", "rule"].includes(
        statement.importClause?.name?.text || "",
      )
        || Boolean(bindings && (
          ts.isNamespaceImport(bindings)
            && ["r", "rule"].includes(bindings.name.text)
          || ts.isNamedImports(bindings) && bindings.elements.some(
            (item) => ["r", "rule"].includes(item.name.text),
          )
        ));
      if (imported) parts.ruleImport = true;
      parts.zImport ||= statement.importClause?.name?.text === "z"
        || Boolean(bindings && (
          ts.isNamespaceImport(bindings) && bindings.name.text === "z"
          || ts.isNamedImports(bindings) && bindings.elements.some(
            (item) => item.name.text === "z",
          )
        ));
      parts.imports.push(text);
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      parts.imports.push(text);
      continue;
    }
    if (
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      parts.types.push(text);
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals) {
        fail(file, statement, "`export =` syntax is not supported.");
      }
      if (parts.view) {
        fail(file, statement, "Only one default view can be declared.");
      }
      parts.view = statement.expression.getText(file);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const declarations = statement.declarationList.declarations;
      const declaration = declarations[0];
      const isExport = modifier(statement, ts.SyntaxKind.ExportKeyword);
      const namedDeclarations = declarations.filter((item) => (
        ts.isIdentifier(item.name) && parts.named.has(item.name.text)
      ));
      if (isExport && namedDeclarations.length && declarations.length > 1) {
        fail(
          file,
          namedDeclarations[0]!,
          "A named View must be declared separately.",
        );
      }
      const oldLife = declarations.find((item) => (
        ts.isIdentifier(item.name)
        && ["onStart", "onLoad", "onClose"].includes(item.name.text)
      ));
      if (isExport && oldLife && ts.isIdentifier(oldLife.name)) {
        const name = oldLife.name.text;
        const key = name === "onClose" ? "close" : "load";
        fail(file, oldLife, `\`${name}\` was replaced by \`event.${key}\`.`);
      }
      const reserved = declarations.find((item) => {
        if (!ts.isIdentifier(item.name)) return false;
        return [
          "persist",
          "api",
          "computed",
          "config",
          "data",
          "datas",
          "deepStyle",
          "deepStyles",
          "event",
          "events",
          "format",
          "group",
          "sample",
          "spec",
          "specs",
          "style",
          "styles",
          "timer",
          "resource",
          "titleBar",
          "watch",
        ].includes(item.name.text);
      });
      if (isExport && reserved && declarations.length > 1) {
        fail(
          file,
          reserved,
          `Reserved export \`${reserved.name.getText(file)}\` must ` +
            "be declared separately.",
        );
      }
      if (
        declarations.length === 1 &&
        declaration &&
        ts.isIdentifier(declaration.name)
      ) {
        const name = declaration.name.text;
        const value = declaration.initializer?.getText(file) || "undefined";
        const plural = ["datas", "events", "specs", "styles"]
          .includes(name) && pluralView(declaration.initializer, parts.named);

        if (isExport && name === "group") {
          if (!declaration.initializer) {
            fail(file, declaration, "`group` requires an initializer.");
          }
          if (!ts.isObjectLiteralExpression(declaration.initializer)) {
            fail(file, declaration, "`group` must be an object literal.");
          }
          if (parts.group) {
            fail(file, declaration, "Only one `group` export is allowed.");
          }
          parts.group = true;
          if (!declaration.initializer.properties.length) {
            fail(file, declaration, "`group` requires at least one root.");
          }
          const used = new Set<string>();
          for (const item of declaration.initializer.properties) {
            if (!ts.isPropertyAssignment(item)) {
              fail(file, item, "`group` requires static root keys.");
            }
            const root = fieldName(item.name);
            if (!root || !parts.named.has(root)) {
              fail(file, item, `\`group.${root || "?"}\` has no named View.`);
            }
            if (parts.groups.has(root)) {
              fail(file, item, `\`group.${root}\` is declared twice.`);
            }
            if (!ts.isArrayLiteralExpression(item.initializer)) {
              fail(file, item, `\`group.${root}\` must be an array.`);
            }
            if (!item.initializer.elements.length) {
              fail(
                file,
                item,
                `\`group.${root}\` requires at least one member.`,
              );
            }
            if (used.has(root)) {
              fail(file, item, `\`${root}\` belongs to more than one group.`);
            }
            used.add(root);
            const members: string[] = [];
            for (const value of item.initializer.elements) {
              if (!ts.isIdentifier(value) || !parts.named.has(value.text)) {
                fail(
                  file,
                  value,
                  "Group members must be named View identifiers.",
                );
              }
              const member = value.text;
              if (member === root) {
                fail(file, value, `\`${root}\` cannot contain itself.`);
              }
              if (used.has(member)) {
                fail(
                  file,
                  value,
                  `\`${member}\` belongs to more than one group.`,
                );
              }
              used.add(member);
              members.push(member);
            }
            parts.groups.set(root, members);
          }
          continue;
        }

        if (
          isExport
          && parts.named.has(name)
          && declaration.initializer
          && (
            ts.isArrowFunction(declaration.initializer)
            || ts.isFunctionExpression(declaration.initializer)
          )
        ) {
          parts.namedParts.push({ name, view: value });
          continue;
        }

        if (isExport && plural) {
          const pluralName = name as PluralName;
          const source = declaration.initializer;
          if (!source || !ts.isObjectLiteralExpression(source)) {
            fail(file, declaration, `\`${name}\` must be an object literal.`);
          }
          for (const item of source.properties) {
            if (!("name" in item) || !item.name) {
              fail(file, item, `\`${name}\` requires static component keys.`);
            }
            const key = fieldName(item.name);
            if (!key || !parts.named.has(key)) {
              fail(file, item, `\`${name}.${key || "?"}\` has no named View.`);
            }
            if (ts.isPropertyAssignment(item)) {
              const value = pluralName === "specs"
                ? specValue(item.initializer, file)
                : item.initializer.getText(file);
              if (
                pluralName === "specs"
                && ts.isObjectLiteralExpression(item.initializer)
              ) parts.ruleUse = true;
              parts.pluralValues[pluralName].set(
                key,
                value,
              );
              continue;
            }
            if (ts.isShorthandPropertyAssignment(item)) {
              parts.pluralValues[pluralName].set(key, key);
              continue;
            }
            fail(file, item, `\`${name}.${key}\` requires a value.`);
          }
          if (parts.plural[pluralName]) {
            fail(file, declaration, `Only one \`${name}\` export is allowed.`);
          }
          parts.plural[pluralName] = value;
          continue;
        }

        if (isExport && name === "persist") {
          if (!declaration.initializer
            || !ts.isObjectLiteralExpression(declaration.initializer)) {
            fail(file, declaration, "`persist` must be an object literal.");
          }
          if (parts.persist) {
            fail(file, declaration, "Only one persist export is allowed.");
          }
          for (const field of declaration.initializer.properties) {
            if (!ts.isPropertyAssignment(field)
              || !field.name || ts.isComputedPropertyName(field.name)
              || !ts.isArrayLiteralExpression(field.initializer)
              || !field.initializer.elements.length
              || field.initializer.elements.some(item =>
                !ts.isStringLiteral(item))) {
              fail(file, field,
                "`persist` requires static keys and nonempty string arrays.");
            }
          }
          parts.persist = value;
          continue;
        }
        if (isExport && name === "api") {
          if (!declaration.initializer
            || !ts.isObjectLiteralExpression(declaration.initializer)) {
            fail(file, declaration, "`api` must be an object literal.");
          }
          if (parts.singles.has(name)) {
            fail(file, declaration, "Only one api export is allowed.");
          }
          parts.singles.add(name);
          parts.body.push(`const api = __api(${value});`);
          continue;
        }
        if (isExport && name === "resource") {
          if (!declaration.initializer
            || !ts.isObjectLiteralExpression(declaration.initializer)) {
            fail(file, declaration, "`resource` must be an object literal.");
          }
          if (parts.singles.has(name)) {
            fail(file, declaration, "Only one resource export is allowed.");
          }
          parts.singles.add(name);
          parts.body.push(`const resource = __resource(${value});`);
          continue;
        }
        if (isExport && name === "timer") {
          if (!declaration.initializer
            || !ts.isObjectLiteralExpression(declaration.initializer)) {
            fail(file, declaration, "`timer` must be an object literal.");
          }
          if (parts.singles.has(name)) {
            fail(file, declaration, "Only one timer export can be declared.");
          }
          const keys = new Set<string>();
          for (const field of declaration.initializer.properties) {
            const key = field.name && fieldName(field.name);
            if (!key || (!ts.isPropertyAssignment(field)
              && !ts.isShorthandPropertyAssignment(field))) {
              fail(file, field, "`timer` requires static named timer values.");
            }
            if (keys.has(key)) {
              fail(file, field, `\`timer.${key}\` is declared twice.`);
            }
            keys.add(key);
          }
          parts.singles.add(name);
          parts.body.push(`const timer = __timer(${value});`);
          continue;
        }
        if (isExport && name === "titleBar") {
          if (!declaration.initializer) {
            fail(file, declaration, "`titleBar` requires an initializer.");
          }
          parts.singles.add("titleBar");
        }
        if (isExport && name === "menu") parts.singles.add("menu");
        if (isExport && name === "data") {
          if (!declaration.initializer) {
            fail(file, declaration, "`data` requires an initializer.");
          }
          parts.body.push(`const data = __state(${value});`);
          parts.singles.add(name);
          continue;
        }
        if (isExport && name === "event") {
          if (!declaration.initializer) {
            fail(file, declaration, "`event` requires an initializer.");
          }
          if (!ts.isObjectLiteralExpression(declaration.initializer)) {
            fail(file, declaration, "`event` must be an object literal.");
          }
          if (parts.event) {
            fail(file, declaration, "Only one event export can be declared.");
          }
          parts.event = true;
          parts.eventKeys = styleFields(declaration.initializer);
          parts.singles.add(name);
          for (const target of ["document", "window"] as const) {
            const field = declaration.initializer.properties.find((item) => (
              "name" in item && item.name && fieldName(item.name) === target
            ));
            if (field && (
              !ts.isPropertyAssignment(field)
              || !ts.isObjectLiteralExpression(field.initializer)
            )) {
              fail(
                file,
                field,
                `event.${target} must be an object literal.`,
              );
            }
          }
          parts.body.push(`const event = ${value};`);
          continue;
        }
        if (isExport && name === "format") {
          fail(file, declaration, "`format` was replaced by `spec`.");
        }
        if (isExport && name === "spec") {
          if (!declaration.initializer) {
            fail(file, declaration, "`spec` requires an initializer.");
          }
          parts.spec = specValue(declaration.initializer, file);
          if (ts.isObjectLiteralExpression(declaration.initializer)) {
            parts.ruleUse = true;
          }
          parts.singles.add(name);
          continue;
        }
        if (isExport && name === "computed") {
          if (!declaration.initializer) {
            fail(file, declaration, "`computed` requires an initializer.");
          }
          parts.body.push(`const computed = __computed(${value});`);
          parts.singles.add(name);
          continue;
        }
        if (isExport && ["style", "styles"].includes(name)) {
          if (!declaration.initializer) {
            fail(file, declaration, `\`${name}\` requires an initializer.`);
          }
          if (parts.styles) {
            fail(file, declaration, "Only one style export can be declared.");
          }
          parts.styles = true;
          parts.singles.add(name);
          parts.classOnly = onlyClasses(declaration.initializer);
          parts.styleStatic = staticFields(declaration.initializer);
          parts.styleFns = styleFields(declaration.initializer, true);
          parts.styleReactive ||= reactiveStyle(declaration.initializer);
          parts.body.push(parts.classOnly && !parts.styleReactive ? `
const style = __style(__styleId, ${value}, false);
const styles = style;
const __styles = style;` : `
const __styleSource = __styleState(
  () => (${value}),
  __styleId,
  ${parts.styleReactive}
);
const __styleScope = __styleSource.id;
const style = __styleSource.rules;
const styles = style;
let __styles = __style(__styleScope, __styleSource.value());
const __refreshStyles = () => {
  __styles = __style(__styleScope, __styleSource.refresh());
};`);
          continue;
        }
        if (isExport && ["deepStyle", "deepStyles"].includes(name)) {
          if (!declaration.initializer) {
            fail(file, declaration, `\`${name}\` requires an initializer.`);
          }
          if (!ts.isObjectLiteralExpression(declaration.initializer)) {
            fail(file, declaration, `\`${name}\` must be an object literal.`);
          }
          if (parts.deepStyles) {
            fail(file, declaration, "Only one deep style export can be declared.");
          }
          parts.deepStyles = true;
          parts.singles.add(name);
          parts.deepKeys = styleFields(declaration.initializer);
          parts.body.push(
            `const deepStyle = __style(__deepId, ${value}, false);\n`
              + "const deepStyles = deepStyle;",
          );
          continue;
        }
        if (isExport && name === "watch") {
          parts.singles.add(name);
          parts.watch = true;
        }
        if (isExport && (name === "config" || name === "sample")) {
          parts.head.push(text);
          continue;
        }
      }
      addShared(text);
      continue;
    }
    if (
      ts.isFunctionDeclaration(statement)
      && statement.name
      && modifier(statement, ts.SyntaxKind.ExportKeyword)
      && parts.named.has(statement.name.text)
    ) {
      parts.namedParts.push({
        name: statement.name.text,
        view: exported(text).replace(/^function\s+/, "function "),
      });
      continue;
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      modifier(statement, ts.SyntaxKind.DefaultKeyword)
    ) {
      if (parts.view) {
        fail(file, statement, "Only one default view can be declared.");
      }
      parts.view = exported(text);
      continue;
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      modifier(statement, ts.SyntaxKind.ExportKeyword) &&
      statement.name.text === "onStart"
    ) {
      fail(file, statement.name, "`onStart` was replaced by `event.load`.");
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      modifier(statement, ts.SyntaxKind.ExportKeyword) &&
      ["onLoad", "onClose"].includes(statement.name.text)
    ) {
      const name = statement.name.text;
      const key = name === "onLoad" ? "load" : "close";
      fail(file, statement.name, `\`${name}\` was replaced by \`event.${key}\`.`);
    }
    if (
      ts.isClassDeclaration(statement) &&
      modifier(statement, ts.SyntaxKind.DefaultKeyword)
    ) {
      fail(file, statement, "The default view must be a function.");
    }
    addShared(text);
  }

  const findRule = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
    ) {
      if (["r", "rule"].includes(node.expression.text)) parts.ruleUse = true;
      if (node.expression.text === "z" && !parts.zImport) {
        fail(
          file,
          node.expression,
          "Global z was removed. Use rule or r, or import Zod explicitly.",
        );
      }
    }
    ts.forEachChild(node, findRule);
  };
  findRule(file);
  return parts;
}

function attributeValue(attribute: ts.JsxAttribute, factory: ts.NodeFactory) {
  if (!attribute.initializer) return factory.createTrue();
  if (ts.isStringLiteral(attribute.initializer)) {
    return factory.createStringLiteral(attribute.initializer.text);
  }
  if (ts.isJsxExpression(attribute.initializer)) {
    return attribute.initializer.expression || factory.createTrue();
  }
  return attribute.initializer;
}

function bindTransformer(
  context: ts.TransformationContext,
  options: {
    deepKeys: Set<string>;
    reactive: boolean;
    styleStatic: Set<string>;
    styleFns: Set<string>;
    styleId?: string;
    styleScope: boolean;
  },
) {
  const factory = context.factory;
  const {
    deepKeys,
    reactive: autoLive,
    styleFns,
    styleId,
    styleScope,
    styleStatic,
  } = options;

  const inputAttrs: Record<string, string> = {
    autocomplete: "autoComplete",
    maxlength: "maxLength",
    minlength: "minLength",
  };

  function reactive(node: ts.Node) {
    let found = false;
    const scan = (child: ts.Node) => {
      if (
        ts.isIdentifier(child)
        && ["computed", "data", "props", "resource"].includes(child.text)
      ) found = true;
      if (!found) ts.forEachChild(child, scan);
    };
    scan(node);
    return found;
  }

  function live(node: ts.JsxExpression) {
    if (!autoLive) return node;
    if (node.pos < 0 || !node.parent) return node;
    const value = node.expression;
    if (!value || ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
      return node;
    }
    if (ts.isJsxAttribute(node.parent)) {
      const name = node.parent.name.getText();
      if (["key", "ref"].includes(name)) return node;
      const attributes = node.parent.parent;
      const opening = attributes.parent;
      if (
        !ts.isJsxOpeningElement(opening)
        && !ts.isJsxSelfClosingElement(opening)
      ) return node;
      if (!/^[a-z]/.test(opening.tagName.getText())
        && !(opening.tagName.getText() === "KeepAlive"
          && ["cacheKey", "max"].includes(name))) return node;
    }
    if (!reactive(value)) return node;
    return factory.updateJsxExpression(
      node,
      factory.createCallExpression(
        factory.createIdentifier("__live"),
        undefined,
        [factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          value,
        )],
      ),
    );
  }

  function normalize(node: ts.JsxAttributes) {
    const output = node.properties.map((property) => {
      if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name)) {
        return property;
      }
      const name = inputAttrs[property.name.text];
      return name
        ? factory.updateJsxAttribute(
            property,
            factory.createIdentifier(name),
            property.initializer,
          )
        : property;
    });
    return factory.updateJsxAttributes(node, output);
  }

  function dynamicStyle(node: ts.JsxAttributes, name: string) {
    const current = node.properties.find((property) => (
      ts.isJsxAttribute(property)
      && ts.isIdentifier(property.name)
      && property.name.text === "style"
    ));
    const args: ts.Expression[] = [
      factory.createPropertyAccessExpression(
        factory.createIdentifier("__styles"),
        name,
      ),
    ];
    if (current && ts.isJsxAttribute(current)) {
      args.push(attributeValue(current, factory));
    }
    const style = factory.createJsxAttribute(
      factory.createIdentifier("style"),
      factory.createJsxExpression(
        undefined,
        factory.createCallExpression(
          factory.createIdentifier("__dynamic"),
          undefined,
          args,
        ),
      ),
    );
    return factory.updateJsxAttributes(node, [
      ...node.properties.filter((property) => property !== current),
      style,
    ]);
  }

  function staticClass(node: ts.JsxAttributes, name: string) {
    const current = node.properties.find((property) => (
      ts.isJsxAttribute(property)
      && ts.isIdentifier(property.name)
      && ["class", "className"].includes(property.name.text)
    ));
    const value = factory.createPropertyAccessExpression(
      factory.createIdentifier("__styles"),
      name,
    );
    const merged = current && ts.isJsxAttribute(current)
      ? factory.createArrayLiteralExpression([
          value,
          attributeValue(current, factory),
        ])
      : value;
    const attribute = factory.createJsxAttribute(
      current && ts.isJsxAttribute(current)
        ? current.name
        : factory.createIdentifier("class"),
      factory.createJsxExpression(undefined, merged),
    );
    return factory.updateJsxAttributes(node, [
      ...node.properties.filter((property) => property !== current),
      attribute,
    ]);
  }

  function deepRule(name: string) {
    return /^[A-Za-z_$][\w$]*$/.test(name)
      ? factory.createPropertyAccessExpression(
          factory.createIdentifier("deepStyle"),
          name,
        )
      : factory.createElementAccessExpression(
          factory.createIdentifier("deepStyle"),
          factory.createStringLiteral(name),
        );
  }

  function deepProps(node: ts.JsxAttributes, name: string) {
    const keys: ts.JsxAttributeLike[] = [];
    const props: ts.ObjectLiteralElementLike[] = [];
    for (const property of node.properties) {
      if (ts.isJsxSpreadAttribute(property)) {
        props.push(factory.createSpreadAssignment(property.expression));
        continue;
      }
      const key = property.name.getText();
      if (key === "key") {
        keys.push(property);
        continue;
      }
      props.push(factory.createPropertyAssignment(
        /^[A-Za-z_$][\w$]*$/.test(key)
          ? factory.createIdentifier(key)
          : factory.createStringLiteral(key),
        attributeValue(property, factory),
      ));
    }
    const call = factory.createCallExpression(
      factory.createIdentifier("__deep"),
      undefined,
      [
        deepRule(name),
        factory.createObjectLiteralExpression(props, false),
      ],
    );
    return factory.updateJsxAttributes(node, [
      ...keys,
      factory.createJsxSpreadAttribute(call),
    ]);
  }

  function literalAttribute(node: ts.JsxAttributes, name: string) {
    const attribute = node.properties.find((property) => (
      ts.isJsxAttribute(property)
      && ts.isIdentifier(property.name)
      && property.name.text === name
    ));
    if (!attribute || !ts.isJsxAttribute(attribute)
      || !attribute.initializer) return "";
    if (ts.isStringLiteral(attribute.initializer)) {
      return attribute.initializer.text;
    }
    if (ts.isJsxExpression(attribute.initializer)
      && attribute.initializer.expression
      && ts.isStringLiteralLike(attribute.initializer.expression)) {
      return attribute.initializer.expression.text;
    }
    return "";
  }

  function autoStyles(node: ts.JsxAttributes, tagName: string) {
    const names = [
      tagName,
      literalAttribute(node, "name"),
      ...literalAttribute(node, "class").split(/\s+/),
      ...literalAttribute(node, "className").split(/\s+/),
      literalAttribute(node, "id"),
    ].filter(Boolean);
    return [...new Set(names)];
  }

  function attributes(node: ts.JsxAttributes, tag: ts.JsxTagNameExpression) {
    node = normalize(node);
    const tagName = tag.getText();
    const native = /^[a-z]/.test(tagName);
    if (styleScope && styleId && native && !node.properties.some((property) => (
      ts.isJsxAttribute(property)
      && ts.isIdentifier(property.name)
      && property.name.text === "data-luon-s"
    ))) {
      node = factory.updateJsxAttributes(node, [
        ...node.properties,
        factory.createJsxAttribute(
          factory.createIdentifier("data-luon-s"),
          styleScope
            ? factory.createJsxExpression(
                undefined,
                factory.createIdentifier("__styleScope"),
              )
            : factory.createStringLiteral(styleId),
        ),
      ]);
    }
    if (native) {
      const names = autoStyles(node, tagName).reverse();
      for (const name of names) {
        if (styleStatic.has(name)) node = staticClass(node, name);
        if (styleFns.has(name)) node = dynamicStyle(node, name);
      }
    }
    const binds = node.properties.filter((property) => {
      if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name)) return false;
      return /^bind(?:[A-Z].*)?$/.test(property.name.text);
    });
    const bind = binds[0];
    if (!bind || !ts.isJsxAttribute(bind)) {
      return !native && deepKeys.has(tagName)
        ? deepProps(node, tagName)
        : node;
    }
    const initializer = bind.initializer;
    if (
      !initializer
      || !ts.isJsxExpression(initializer)
      || !initializer.expression
    ) {
      throw new CompileError(
        "Bind requires a mutable state expression.",
      );
    }

    const bindName = (bind.name as ts.Identifier).text;
    if (native && bindName !== "bind") {
      throw new CompileError(
        "Named bind is only supported on components.",
      );
    }
    const model = bindName === "bind"
      ? "value"
      : bindName.charAt(4).toLowerCase() + bindName.slice(5);
    const options: ts.ObjectLiteralElementLike[] = [
      factory.createPropertyAssignment(
        "tag",
        factory.createStringLiteral(native ? tagName : "component"),
      ),
      factory.createPropertyAssignment("name", factory.createStringLiteral(model)),
    ];

    for (const property of node.properties) {
      if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name)) continue;
      const name = property.name.text;
      if (!["type", "value", "multiple", "clean", "update"].includes(name)) continue;
      options.push(
        factory.createPropertyAssignment(
          name,
          attributeValue(property, factory),
        ),
      );
    }

    const value = initializer.expression;
    const property = ts.isPropertyAccessExpression(value) &&
      !value.questionDotToken;
    const element = ts.isElementAccessExpression(value) &&
      !value.questionDotToken;
    if (
      !ts.isIdentifier(value) &&
      !property &&
      !element
    ) {
      throw new CompileError(
        "Bind target must be a variable or property.",
      );
    }
    const computedTarget = (
      ts.isPropertyAccessExpression(value)
      || ts.isElementAccessExpression(value)
    ) && ts.isIdentifier(value.expression)
      && value.expression.text === "computed";
    const readValue = computedTarget
      ? factory.createCallExpression(value, undefined, [])
      : value;
    const read = factory.createArrowFunction(
      undefined,
      undefined,
      [],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      readValue,
    );
    const parameter = factory.createParameterDeclaration(
      undefined,
      undefined,
      "__value",
    );
    const writeValue = computedTarget
      ? factory.createCallExpression(
        value,
        undefined,
        [factory.createIdentifier("__value")],
      )
      : factory.createAssignment(value, factory.createIdentifier("__value"));
    const write = factory.createArrowFunction(
      undefined,
      undefined,
      [parameter],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      writeValue,
    );
    const call = factory.createCallExpression(
      factory.createIdentifier("__bind"),
      undefined,
      [read, write, factory.createObjectLiteralExpression(options, false)],
    );
    const output = node.properties.flatMap((property) => {
      if (property === bind) return [factory.createJsxSpreadAttribute(call)];
      if (
        ts.isJsxAttribute(property) &&
        ts.isIdentifier(property.name) &&
        ["clean", "update"].includes(property.name.text)
      ) {
        return [];
      }
      return [property];
    });
    return attributes(factory.updateJsxAttributes(node, output), tag);
  }

  function visit(node: ts.Node): ts.VisitResult<ts.Node> {
    if (ts.isJsxElement(node)
      && node.openingElement.tagName.getText() === "KeepAlive") {
      const children = node.children.filter((child) =>
        !ts.isJsxText(child) || child.text.trim());
      if (children.length !== 1) {
        throw new CompileError("KeepAlive requires one child expression.");
      }
      const child = children[0]!;
      const source = ts.isJsxExpression(child) ? child.expression : child;
      if (!source || ts.isJsxText(source)) {
        throw new CompileError("KeepAlive requires a View child.");
      }
      const body = ts.visitNode(source, visit) as ts.Expression;
      const lazy = factory.createArrowFunction(undefined, undefined, [],
        undefined, factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        body);
      const opening = ts.visitNode(
        node.openingElement, visit,
      ) as ts.JsxOpeningElement;
      return factory.updateJsxElement(node, opening,
        [factory.createJsxExpression(undefined, lazy)], node.closingElement);
    }
    if (ts.isJsxExpression(node)) node = live(node);
    if (
      ts.isVariableDeclaration(node)
      && ts.isObjectBindingPattern(node.name)
      && node.initializer
      && ts.isIdentifier(node.initializer)
      && ["style", "styles"].includes(node.initializer.text)
    ) {
      return factory.updateVariableDeclaration(
        node,
        node.name,
        node.exclamationToken,
        node.type,
        factory.createIdentifier("__styles"),
      );
    }
    if (
      ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && ["style", "styles"].includes(node.expression.text)
    ) {
      const parent = node.parent;
      const nested = ts.isPropertyAccessExpression(parent)
        && parent.expression === node
        || ts.isElementAccessExpression(parent) && parent.expression === node;
      const assigned = ts.isBinaryExpression(parent)
        && parent.left === node
        && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        || ts.isDeleteExpression(parent)
        || ts.isPrefixUnaryExpression(parent)
        || ts.isPostfixUnaryExpression(parent);
      if (!nested && !assigned) {
        return factory.updatePropertyAccessExpression(
          node,
          factory.createIdentifier("__styles"),
          node.name,
        );
      }
    }
    if (
      ts.isElementAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && ["style", "styles"].includes(node.expression.text)
    ) {
      const parent = node.parent;
      const nested = ts.isPropertyAccessExpression(parent)
        && parent.expression === node
        || ts.isElementAccessExpression(parent) && parent.expression === node;
      const assigned = ts.isBinaryExpression(parent)
        && parent.left === node
        && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        || ts.isDeleteExpression(parent)
        || ts.isPrefixUnaryExpression(parent)
        || ts.isPostfixUnaryExpression(parent);
      if (!nested && !assigned) {
        return factory.updateElementAccessExpression(
          node,
          factory.createIdentifier("__styles"),
          node.argumentExpression,
        );
      }
    }
    if (ts.isJsxOpeningElement(node)) {
      return ts.visitEachChild(factory.updateJsxOpeningElement(
        node,
        node.tagName,
        node.typeArguments,
        attributes(node.attributes, node.tagName),
      ), visit, context);
    }
    if (ts.isJsxSelfClosingElement(node)) {
      return ts.visitEachChild(factory.updateJsxSelfClosingElement(
        node,
        node.tagName,
        node.typeArguments,
        attributes(node.attributes, node.tagName),
      ), visit, context);
    }
    return ts.visitEachChild(node, visit, context);
  }

  return (file: ts.SourceFile) => ts.visitNode(file, visit) as ts.SourceFile;
}

function componentName(id: string) {
  const name = basename(id, extname(id)).replace(/\.view$/, "");
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function namedId(id: string, name: string) {
  const extension = extname(id) || ".tsx";
  return `${id.slice(0, -extension.length)}.${name}${extension}`;
}

function connectGroup(
  parts: Parts,
  group: GroupPart,
  name: string,
) {
  const dataIndex = parts.body.findIndex((item) => (
    item.startsWith("const data = __state(")
  ));
  const dataSource = dataIndex >= 0
    ? parts.body.splice(dataIndex, 1)[0]!
    : "const data = __state({});";
  const data = group.rootView
    ? `${dataSource}\n__groupData(__groupScopeValue, data);`
    : "const data = __groupData(__groupScopeValue);";
  parts.body.unshift(
    "const __groupScopeValue = __groupScope();",
    data,
  );
  const eventIndex = parts.body.findIndex((item) => (
    item.startsWith("const event = ")
  ));
  const eventSource = eventIndex >= 0
    ? parts.body.splice(eventIndex, 1)[0]!
      .replace("const event = ", "const __eventSource = ")
    : "const __eventSource = {};";
  parts.body.push(
    `${eventSource}\nconst event = __groupEvent(`
      + `__groupScopeValue, ${JSON.stringify(name)}, __eventSource);`,
  );
  parts.event = true;
}

function compileSingle(
  source: string,
  options: CompileOptions = {},
  name?: string,
  group?: GroupPart,
  sourceId?: string,
  origin?: ViewSource,
): CompileResult {
  const id = options.id || "View.tsx";
  const parts = collect(source, id);
  if (!parts.view) return { code: source };
  if (group) connectGroup(parts, group, name || componentName(id));
  if (parts.persist) {
    const index = parts.body.findIndex(item => item.startsWith("const data ="));
    if (index < 0) {
      throw new CompileError("`persist` requires an exported `data` object.");
    }
    const path = (sourceId || id).replaceAll("\\", "/");
    const scope = path.match(/(?:^|\/)app\/(.*)$/)?.[1] || path;
    parts.body.splice(index + 1, 0,
      `__persist(data, ${parts.persist}, ${JSON.stringify(scope)});`);
  }
  const scopedStyles = parts.styles && !parts.classOnly;
  const stateStyles = parts.styles
    && (!parts.classOnly || parts.styleReactive);
  const hash = parts.styles || parts.deepStyles
    ? createHash("sha256").update(id.replaceAll("\\", "/"))
      .digest("hex").slice(0, 12)
    : "";
  const styleId = parts.styles ? hash : "";
  const deepId = parts.deepStyles ? `${hash}-deep` : "";

  const load = parts.event
    ? `load: () => {
      __events.load();
    },`
    : "";
  const close = parts.event
    ? `close: () => {
      __events.close();
    },`
    : "";
  const wrapped = `
${[...new Set(parts.imports)].join("\n")}
${parts.ruleUse && !parts.ruleImport
    ? 'import { r, rule } from "@luon/rule";'
    : ""}
import {
  ${parts.spec ? "attrsView as __attrs,\n  " : ""}
  bindView as __bind,
  componentView as __component,
  computedView as __computed,
  ${parts.event ? "eventView as __event,\n  " : ""}
  ${group ? `groupData as __groupData,
  groupEvent as __groupEvent,
  groupScope as __groupScope,
  ` : ""}
  ${parts.deepStyles ? "deepView as __deep,\n  " : ""}
  ${parts.styleFns.size ? "dynamicView as __dynamic,\n  " : ""}
  ${parts.singles.has("menu") ? "menuView as __menu,\n  " : ""}
  ${parts.singles.has("titleBar") ? "titleBarView as __titleBar,\n  " : ""}
  ${parts.persist ? "persistView as __persist,\n  " : ""}
  ${parts.singles.has("api") ? "apiView as __api,\n  " : ""}
  ${parts.singles.has("resource") ? "resourceView as __resource,\n  " : ""}
  ${parts.singles.has("timer") ? "timerView as __timer,\n  " : ""}
  liveView as __live,
  state as __state,
  ${stateStyles ? "styleState as __styleState,\n  " : ""}
  ${parts.styles || parts.deepStyles ? "styleView as __style,\n  " : ""}
  watchView as __watch
} from "@luon/view";
${[...new Set(parts.types)].join("\n")}
${parts.head.join("\n")}
${parts.spec ? `const __spec = ${parts.spec};` : ""}
${parts.styles ? `const __styleId = ${JSON.stringify(styleId)};` : ""}
${parts.deepStyles ? `const __deepId = ${JSON.stringify(deepId)};` : ""}
export default __component(${JSON.stringify(name || componentName(id))}, (props) => {
${parts.spec ? "const attrs = __attrs(props, __spec);" : ""}
${parts.body.join("\n")}
${parts.singles.has("titleBar") ? "__titleBar(titleBar);" : ""}
${parts.singles.has("menu")
    ? `__menu(${JSON.stringify(sourceId || id)}, menu);` : ""}
${parts.event
    ? `const __events = __event(${group ? "__eventSource" : "event"});`
    : ""}
${parts.watch ? "__watch(data, watch);" : ""}
const __view = ${parts.view};
  return {
    ${load}
    ${close}
    render: (__props) => {
      ${stateStyles ? "__refreshStyles();" : ""}
      return __view(__props);
    }
  };
}, ${parts.spec ? "__spec" : "undefined"}, ${JSON.stringify(origin || viewSource(source, sourceId || id))});
`;

  const output = ts.transpileModule(wrapped, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "@luon/view",
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: id,
    reportDiagnostics: true,
    transformers: {
      before: [(context) => bindTransformer(context, {
        deepKeys: parts.deepKeys,
        reactive: options.reactive !== false,
        styleFns: parts.styleFns,
        styleId: styleId || undefined,
        styleScope: scopedStyles,
        styleStatic: parts.styleStatic,
      })],
    },
  });

  const diagnostic = output.diagnostics?.find(
    (item) => item.category === ts.DiagnosticCategory.Error,
  );
  if (diagnostic) {
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      "\n",
    );
    throw new CompileError(`${id} ${message}`);
  }

  return { code: output.outputText };
}

function namedSource(
  parts: Parts,
  named: NamedPart,
) {
  const singular: Record<PluralName, string> = {
    datas: "data",
    events: "event",
    specs: "spec",
    styles: "style",
  };
  const reserved = (Object.keys(singular) as PluralName[])
    .flatMap((plural) => {
      const value = parts.pluralValues[plural].get(named.name);
      return value
        ? [`export const ${singular[plural]} = ${value};`]
        : [];
    });
  return [
    ...parts.imports,
    ...parts.types,
    ...reserved,
    `export default ${named.view}`,
  ].join("\n");
}

function groupPart(parts: Parts, name: string): GroupPart | undefined {
  if (parts.groups.has(name)) return { root: name, rootView: true };
  for (const [root, members] of parts.groups) {
    if (members.includes(name)) return { root, rootView: false };
  }
}

function namedModule(
  code: string,
  name: string,
  id: string,
  group?: GroupPart,
) {
  const file = ts.createSourceFile(
    id,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const heads: string[] = [];
  const body: string[] = [];
  let view = "";
  for (const statement of file.statements) {
    const text = statement.getFullText(file).trim();
    if (!text) continue;
    if (
      ts.isImportDeclaration(statement)
      || ts.isExportDeclaration(statement)
    ) {
      heads.push(text);
      continue;
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      view = statement.expression.getText(file);
      continue;
    }
    body.push(text);
  }
  if (!view) throw new CompileError(`${id} Named View output is missing.`);
  if (group) {
    heads.push(
      'import { groupView as __group } from "@luon/view";',
    );
    view = `__group(${view}, ${JSON.stringify(group.root)}, `
      + `${group.rootView})`;
  }
  return [
    ...heads,
    `export const ${name} = (() => {`,
    ...body,
    `return ${view};`,
    "})();",
  ].join("\n");
}

function moduleHead(parts: Parts, id: string) {
  if (!parts.head.length && !parts.shared.length) return "";
  const output = ts.transpileModule([
    ...parts.imports,
    ...parts.types,
    ...parts.head,
    ...parts.shared,
  ].join("\n"), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "@luon/view",
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: id,
  });
  return output.outputText;
}

function namedBatch(
  parts: Parts,
  id: string,
  options: CompileOptions,
  origin: ViewSource,
): CompileResult {
  const names = parts.namedParts.map((item) => item.name);
  const creates = parts.namedParts.map((item) => (
    `  ${item.name}: ${item.view},`
  ));
  const specs = names.flatMap((name) => {
    const value = parts.pluralValues.specs.get(name);
    return value ? [`  ${name}: ${value},`] : [];
  });
  const source = [
    ...parts.imports,
    parts.ruleUse && !parts.ruleImport
      ? 'import { r, rule } from "@luon/rule";'
      : "",
    "import { bindView as __bind, liveView as __live, "
      + 'namedViews as __namedViews } from "@luon/view";',
    ...parts.types,
    ...parts.head,
    ...parts.batchShared,
    specs.length ? `const __specs = {\n${specs.join("\n")}\n};` : "",
    `export const {\n  ${names.join(",\n  ")},\n} = __namedViews({`,
    ...creates,
    `}, ${specs.length ? "(name) => __specs[name]" : "undefined"}, `
      + `${JSON.stringify(origin)});`,
  ].filter(Boolean).join("\n");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "@luon/view",
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: id,
    reportDiagnostics: true,
    transformers: {
      before: [(context) => bindTransformer(context, {
        deepKeys: new Set(),
        reactive: options.reactive !== false,
        styleFns: new Set(),
        styleScope: false,
        styleStatic: new Set(),
      })],
    },
  });
  const diagnostic = output.diagnostics?.find(
    (item) => item.category === ts.DiagnosticCategory.Error,
  );
  if (diagnostic) {
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      "\n",
    );
    throw new CompileError(`${id} ${message}`);
  }
  return { code: output.outputText };
}

function mergeModules(codes: string[], id: string) {
  type Imports = {
    default?: string;
    named: Map<string, string>;
    space?: string;
  };
  const imports = new Map<string, Imports>();
  const heads = new Map<string, string>();
  const bodies: string[] = [];
  for (const code of codes) {
    const file = ts.createSourceFile(
      id,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    for (const statement of file.statements) {
      const text = statement.getFullText(file).trim();
      if (!text) continue;
      if (ts.isImportDeclaration(statement)) {
        const module = ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : statement.moduleSpecifier.getText(file);
        const clause = statement.importClause;
        if (!clause) {
          heads.set(text, text);
          continue;
        }
        const entry: Imports = imports.get(module) || {
          named: new Map<string, string>(),
        };
        if (clause.name) entry.default = clause.name.text;
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          entry.space = bindings.name.text;
        }
        if (bindings && ts.isNamedImports(bindings)) {
          for (const item of bindings.elements) {
            entry.named.set(
              item.name.text,
              item.propertyName?.text || item.name.text,
            );
          }
        }
        imports.set(module, entry);
        continue;
      }
      if (ts.isExportDeclaration(statement)) {
        heads.set(text, text);
      } else {
        bodies.push(text);
      }
    }
  }
  const importText = [...imports].map(([module, entry]) => {
    const names: string[] = [];
    if (entry.default) names.push(entry.default);
    if (entry.space) names.push(`* as ${entry.space}`);
    if (entry.named.size) {
      const fields = [...entry.named].map(([local, imported]) => (
        local === imported ? imported : `${imported} as ${local}`
      ));
      names.push(`{ ${fields.join(", ")} }`);
    }
    return `import ${names.join(", ")} from ${JSON.stringify(module)};`;
  });
  return [...importText, ...heads.values(), ...bodies].join("\n");
}

function validateNamed(parts: Parts, id: string) {
  const used = new Set<string>();
  for (const item of parts.namedParts) {
    if (used.has(item.name)) {
      throw new CompileError(
        `${id} Named View \`${item.name}\` is declared more than once.`,
      );
    }
    used.add(item.name);
  }
  if (parts.view || !parts.singles.size) return;
  const name = parts.singles.values().next().value as string;
  const plurals: Record<string, string> = {
    data: "datas",
    event: "events",
    spec: "specs",
    style: "styles",
    styles: "styles",
  };
  const plural = plurals[name];
  const hint = plural
    ? ` Use \`${plural}\` for named Views.`
    : " Add a default View or keep this value inside a named View function.";
  throw new CompileError(
    `${id} \`${name}\` requires a default View.${hint}`,
  );
}

export function compileView(
  source: string,
  options: CompileOptions = {},
): CompileResult {
  const id = options.id || "View.tsx";
  const parts = collect(source, id);
  if (!parts.namedParts.length) return compileSingle(source, options);
  validateNamed(parts, id);
  if (
    options.batch
    && !parts.view
    && !parts.group
    && !parts.pluralValues.datas.size
    && !parts.pluralValues.events.size
    && !parts.pluralValues.styles.size
  ) {
    return namedBatch(parts, id, options, viewSource(source, id));
  }

  const codes: string[] = [];
  if (parts.view) codes.push(compileSingle(source, options).code);
  else {
    const head = moduleHead(parts, id);
    if (head) codes.push(head);
  }
  for (const named of parts.namedParts) {
    const group = groupPart(parts, named.name);
    if (
      group
      && !group.rootView
      && parts.pluralValues.datas.has(named.name)
    ) {
      throw new CompileError(
        `${id} Group data must be declared on \`${group.root}\`, not `
          + `\`${named.name}\`.`,
      );
    }
    const input = namedSource(parts, named);
    const partId = namedId(id, named.name);
    const code = compileSingle(
      input,
      { ...options, id: partId },
      named.name,
      group,
      id,
      viewSource(source, id).views?.[named.name],
    ).code;
    codes.push(namedModule(
      code,
      named.name,
      partId,
      group,
    ));
  }
  return { code: mergeModules(codes, id) };
}
