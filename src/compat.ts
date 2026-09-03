import { act, jsx, state as actState, type Child, type Component } from "@luon/act";

import { addLife, withLife, type ViewLife } from "./life.ts";
import { state } from "./store.ts";

export type Cell<Value> = {
  (): Value;
  (value: Value): Value;
};

export type Attrs = Record<string, unknown>;

export type ViewDebugEvent = {
  key: unknown;
};

export type ViewBehavior<Element = HTMLElement, Value = unknown> = {
  close?: (element: Element) => void;
  load?: (element: Element, value: Value) => void;
  update?: (element: Element, value: Value, previous: Value) => void;
};

type LazyOptions = {
  load: () => Promise<unknown>;
};

const contexts = new Map<string, unknown>();
let ids = 0;

export const node = jsx;
export const nextView = <Value>(value?: Value) => Promise.resolve(value);

export function lazy(load: (() => Promise<unknown>) | LazyOptions) {
  const loader = typeof load === "function" ? load : load.load;
  let task: Promise<void> | undefined;
  let view: Component<Record<string, unknown>> | undefined;
  const ready = actState({ value: 0 });
  return (props: Record<string, unknown>) => act((): Child => {
    ready.value;
    if (view) return view(props);
    task ||= loader().then((value) => {
      const module = value as {
        default?: Component<Record<string, unknown>>;
      };
      view = module.default || value as Component<Record<string, unknown>>;
      ready.value++;
    });
    return null;
  });
}

export const shallow = state;

export function readonly<Value extends object>(value: Value) {
  return new Proxy(value, {
    deleteProperty: () => false,
    set: () => false,
  }) as Readonly<Value>;
}

export const plain = <Value>(value: Value) => value;

export function cell<Value>(initial: Value): Cell<Value> {
  const data = state({ value: initial });
  return function (value?: Value) {
    if (arguments.length) data.value = value as Value;
    return data.value;
  } as Cell<Value>;
}

function option<Handler extends (...args: any[]) => any>(
  handler: Handler,
  once = false,
) {
  let called = false;
  return ((...args: Parameters<Handler>) => {
    if (once && called) return;
    called = true;
    return handler(...args);
  }) as Handler;
}

export const once = <Handler extends (...args: any[]) => any>(
  handler: Handler,
) => option(handler, true);
export const capture = <Handler extends (...args: any[]) => any>(
  handler: Handler,
) => option(handler);
export const passive = capture;

export function provideContext(values: Record<string, unknown>) {
  for (const [name, value] of Object.entries(values)) {
    contexts.set(name, value);
  }
}

export function useContext<Value>(name: string) {
  return () => {
    const value = contexts.get(name);
    return typeof value === "function"
      ? (value as () => Value)()
      : value as Value;
  };
}

export const shared = useContext;
export const behavior = <Element, Value>(
  hooks: ViewBehavior<Element, Value>,
) => hooks;

export function scope<Value extends object>(create: () => Value) {
  const life: ViewLife = { close: [], load: [] };
  const value = withLife(life, create);
  for (const run of life.load) run();
  return Object.assign(value, {
    close: () => life.close.toReversed().forEach((run) => run()),
  });
}

export const onLoad = (run: () => void) => addLife("load", run);
export const onClose = (run: () => void) => addLife("close", run);
export const onScopeClose = onClose;
export const viewId = () => `luon-view-${++ids}`;
