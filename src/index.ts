export { bindView } from "./model.ts";
export { classText, type ClassValue } from "./class.ts";
export { state } from "./store.ts";
export { refreshViews } from "./store.ts";
export {
  deepView,
  dynamicView,
  styleView,
  type StyleClass,
  type StyleFn,
  type StyleMap,
  type StyleRule,
  type StyleValue,
} from "./style.ts";
export { styleState, type StyleState } from "./style-state.ts";
export { recipeStyle as recipeView } from "@luon/style";
export {
  componentView,
  eventView,
  groupData,
  groupEvent,
  groupScope,
  groupView,
  namedView,
  namedViews,
  type GroupContext,
  type GroupScope,
} from "./view.ts";
export { attrsView, passProps, sourceView } from "./view.ts";
export {
  act as liveView,
  effect as effectView,
  untrack as untrackView,
} from "@luon/act";
export type { Child, Read } from "@luon/act";
export {
  watchView,
  type WatchDefs,
  type WatchRule,
  type WatchRun,
} from "./watch.ts";
export {
  behavior,
  capture,
  cell,
  lazy,
  nextView,
  node,
  onClose,
  onLoad,
  onScopeClose,
  once,
  passive,
  plain,
  provideContext,
  readonly,
  scope,
  shallow,
  shared,
  useContext,
  viewId,
  type Attrs,
  type Cell,
  type ViewBehavior,
  type ViewDebugEvent,
} from "./compat.ts";
export type { BindOptions } from "./model.ts";
export type { View, ViewProps, ViewScope } from "./types.ts";

function refProxy<Value>(many = false) {
  let current: Value | undefined;
  const values = new Set<Value>();
  const assign = (value?: Value | null) => {
    if (!many) {
      current = value || undefined;
      return;
    }
    if (value) values.add(value);
    else {
      for (const item of values) {
        if (
          item
          && typeof item === "object"
          && "isConnected" in item
          && item.isConnected === false
        ) values.delete(item);
      }
    }
  };
  return new Proxy(assign, {
    get(_target, key) {
      if (key === "forEach") {
        return (callback: (value: Value) => void) => values.forEach(callback);
      }
      const value = (current as any)?.[key];
      return typeof value === "function" ? value.bind(current) : value;
    },
  });
}

export function element<Value>() {
  return refProxy<Value>() as ((value: Value | null) => void) & Value;
}

export function component<Value>() {
  return element<Value>();
}

export function elements<Value>() {
  return refProxy<Value>(true) as ((value: Value | null) => void) & {
    forEach(callback: (value: Value) => void): void;
  };
}

export type ComputedRule<Value = unknown> =
  | (() => Value)
  | {
      get: () => Value;
      set?: (value: Value) => void;
    };

type ComputedValue<Rule> = Rule extends () => infer Value
  ? Value
  : Rule extends { get: () => infer Value }
    ? Value
    : never;

type ComputedCall<Rule> = Rule extends { set: (value: infer Value) => void }
  ? {
      (): ComputedValue<Rule>;
      (value: Value): ComputedValue<Rule>;
    }
  : () => ComputedValue<Rule>;

export type Computed<Rules> = {
  [Name in keyof Rules]: ComputedCall<Rules[Name]>;
};

type ComputedInput =
  | (() => unknown)
  | {
      get: () => unknown;
      set?: (...values: never[]) => void;
    };

export function computedView<Rules extends Record<string, ComputedInput>>(
  definitions: Rules,
) {
  const output: Record<string, (value?: unknown) => unknown> = {};

  for (const [name, definition] of Object.entries(definitions)) {
    const rule = definition as ComputedRule;
    if (typeof rule === "function") {
      output[name] = rule;
      continue;
    }

    output[name] = function (value?: unknown) {
      if (arguments.length) rule.set?.(value);
      return rule.get();
    };
  }

  return output as Computed<Rules>;
}
