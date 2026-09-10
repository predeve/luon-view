import * as ts from "@typescript/typescript6";

// Preserve every source offset; editor-only declarations follow the user's code.
export function viewTypes(source: string, id: string) {
  const file = ts.createSourceFile(id, source, ts.ScriptTarget.Latest,
    true, ts.ScriptKind.TSX);
  const extra: string[] = [];
  let cookie: ts.Identifier | undefined;
  let computed: ts.Identifier | undefined;
  let api: ts.Identifier | undefined;
  const apiKeys: string[] = [];
  let timer: ts.Identifier | undefined;
  const timerKeys: string[] = [];
  let props: ts.TypeNode | undefined;
  let hasProps = false;
  for (const node of file.statements) {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : [];
    const exported = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isVariableStatement(node)) {
      for (const item of node.declarationList.declarations) {
        if (!ts.isIdentifier(item.name)) continue;
        if (item.name.text === "props") hasProps = true;
        if (exported && item.name.text === "cookie") cookie = item.name;
        if (exported && item.name.text === "computed") computed = item.name;
        if (exported && item.name.text === "api") {
          api = item.name;
          if (item.initializer
            && ts.isObjectLiteralExpression(item.initializer)) {
            for (const field of item.initializer.properties) {
              if (!field.name || ts.isComputedPropertyName(field.name)) continue;
              const key = field.name.getText(file);
              if (!["config", "\"config\"", "'config'"].includes(key)) {
                apiKeys.push(key);
              }
            }
          }
        }
        if (exported && item.name.text === "timer") {
          timer = item.name;
          if (item.initializer
            && ts.isObjectLiteralExpression(item.initializer)) {
            for (const field of item.initializer.properties) {
              if (!field.name || ts.isComputedPropertyName(field.name)) continue;
              timerKeys.push(field.name.getText(file));
            }
          }
        }
      }
    }
    const view = ts.isExportAssignment(node) ? node.expression
      : ts.isFunctionDeclaration(node)
        && modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)
        ? node : undefined;
    if (view && (ts.isArrowFunction(view) || ts.isFunctionExpression(view)
      || ts.isFunctionDeclaration(view))) {
      props = view.parameters[0]?.type;
    }
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      hasProps ||= clause?.name?.text === "props";
      const bindings = clause?.namedBindings;
      hasProps ||= Boolean(bindings && (ts.isNamespaceImport(bindings)
        ? bindings.name.text === "props"
        : bindings.elements.some(value => value.name.text === "props")));
    }
  }
  for (const [node, type] of [
    [computed, "Computed"], [timer, "Timers"], [api, "Apis"],
    [cookie, "Cookies"],
  ] as const) {
    if (!node) continue;
    let index = 0;
    const prefix = node === cookie ? "_ck" : node === api ? "_a"
      : node === timer ? "_tm" : "_luon";
    const width = node.text.length - prefix.length;
    let alias = prefix + "0".repeat(width);
    while (source.includes(alias)) {
      alias = prefix + (++index).toString(36).padStart(width, "0");
    }
    if (alias.length === node.text.length) {
      const start = node.getStart(file);
      source = source.slice(0, start) + alias + source.slice(node.end);
      if (node === api) {
        const fields = apiKeys.map(key => `readonly ${key}: `
          + 'import("@luon/view").ApiCall;');
        extra.push(`declare const api: { ${fields.join(" ")} };`);
      } else if (node === timer) {
        // Keys have fixed control types, independent of self-referencing run.
        const fields = timerKeys.map(key => `readonly ${key}: `
          + 'import("@luon/view").TimerControl;');
        extra.push(`declare const timer: { ${fields.join(" ")} };`);
        extra.push(`type ${alias}Check = import("@luon/view").`
          + `Timers<typeof ${alias}>;`);
      } else {
        extra.push(`declare const ${node.text}: import("@luon/view").`
          + `${type}<typeof ${alias}>;`);
      }
    }
  }
  if (props && !hasProps) {
    extra.push(`declare const props: ${props.getText(file)};`);
  }
  return extra.length ? `${source}\n${extra.join("\n")}\n` : source;
}
