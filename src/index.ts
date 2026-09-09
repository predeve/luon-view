export { titleBarView } from "./titlebar.ts";
export type { TitleBar } from "./titlebar.ts";
export { timer, timerView } from "./timer.ts";
export type { TimerControl, TimerRule, Timers } from "./timer.ts";
export { menuView, viewMenus } from "./menu.ts";
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
export { effectView, liveView, memoView } from "./reactive.ts";
export { untrack as untrackView } from "@luon/act";
export { ViewError, type ViewFrame, type ViewSource } from "./error.ts";
import { memoView } from "./reactive.ts";
import { currentLife, runLife } from "./life.ts";
export type { Child, Memo, Read } from "@luon/act";
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
      cache?: boolean;
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
      cache?: boolean;
      set?: (...values: never[]) => void;
    };

export function computedView<Rules extends Record<string, ComputedInput>>(
  definitions: Rules,
) {
  const output: Record<string, (value?: unknown) => unknown> = {};

  for (const [name, definition] of Object.entries(definitions)) {
    const rule = definition as ComputedRule;
    const life = currentLife();
    const get = typeof rule === "function" ? rule : rule.get;
    const run = () => life ? runLife(life, `computed.${name}`, get) : get();
    const value = typeof rule !== "function" && rule.cache === false
      ? run : memoView(run);
    output[name] = function (next?: unknown) {
      if (arguments.length) {
        const write = () => {
          if (typeof rule === "function" || !rule.set) {
            throw new Error(`Computed \`${name}\` is read-only. Add a setter.`);
          }
          rule.set(next);
        };
        if (life) runLife(life, `computed.${name}`, write);
        else write();
      }
      return value();
    };
  }

  return output as Computed<Rules>;
}
