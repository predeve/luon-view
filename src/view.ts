import {
  act,
  bindProps,
  state as actState,
  type Child,
  type Component,
  type Read,
} from "@luon/act";
import type { ObjectRule, RuleShape, ShapeOutput } from "@luon/rule";

import {
  closeLife, currentLife, lifeCall, loadLife, runLife, type ViewLife,
} from "./life.ts";
import type { ViewSource } from "./error.ts";
import { viewVersion } from "./store.ts";
import type { ViewProps, ViewScope } from "./types.ts";

type Setup<Props extends ViewProps> = (props: Props) => ViewScope<Props>;
type EventRun = (event: Event) => unknown;
type EventTargetMap = Record<string, EventRun>;
type ViewEvents = {
  close?: () => unknown;
  document?: EventTargetMap;
  load?: () => unknown;
  window?: EventTargetMap;
  [name: string]: unknown;
};
const propsKey = Symbol.for("@luon/view/props");
const groupKey = Symbol.for("@luon/act/context");
const childrenKey = Symbol.for("@luon/act/children");
const propSources = new WeakMap<object, ViewProps>();

export type GroupContext = {
  active: boolean;
  root: string;
  values: Record<string, unknown>;
};

export type GroupScope = {
  children?: unknown;
  closed?: boolean;
  context: { value?: GroupContext };
  data?: object;
  event?: {
    name: string;
    value: ViewEvents;
  };
  kind: "member" | "root";
  root: string;
};

type GroupChild = {
  [groupKey]?: GroupScope;
};

let activeGroup: GroupScope | undefined;

type ViewChild = Read<unknown> & {
  [propsKey]?: ViewProps;
};

function isRead(value: unknown): value is Read<unknown> {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Read<unknown>>;
  return item.__act === true && typeof item.read === "function";
}

function withGroup<Value>(scope: GroupScope, run: () => Value) {
  const previous = activeGroup;
  activeGroup = scope;
  try {
    return run();
  } finally {
    activeGroup = previous;
  }
}

function groupMark(value: unknown) {
  if (!value || typeof value !== "object") return;
  return (value as GroupChild)[groupKey];
}

function attachGroup(scope: GroupScope, context: GroupContext) {
  if (scope.closed || !context.active) return;
  if (scope.data) context.values.data = scope.data;
  if (!scope.event) return;
  const current = context.values.events as
    | Record<string, ViewEvents>
    | undefined;
  context.values.events = {
    ...current,
    [scope.event.name]: scope.event.value,
  };
}

function bindGroup(
  value: unknown,
  context: GroupContext,
  seen = new WeakSet<object>(),
) {
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const child of value) bindGroup(child, context, seen);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  const scope = groupMark(value);
  if (scope?.closed || !context.active) return;
  if (scope?.kind === "root" && scope.root === context.root) return;
  if (scope?.root === context.root) {
    scope.context.value = context;
    attachGroup(scope, context);
  }
  if (scope) bindGroup(scope.children, context, seen);
  bindGroup(Reflect.get(value, childrenKey), context, seen);
  if (typeof Node === "undefined" || !(value instanceof Node)) return;
  for (const child of value.childNodes) bindGroup(child, context, seen);
}

function markGroup(value: Child, scope: GroupScope): Child {
  if (isRead(value)) {
    return Object.freeze({
      __act: true as const,
      [groupKey]: scope,
      [propsKey]: (value as ViewChild)[propsKey],
      dispose: () => value.dispose?.(),
      read: () => markGroup(value.read() as Child, scope),
    });
  }
  if (Array.isArray(value)) {
    return value.map((child) => markGroup(child, scope));
  }
  if (typeof Node !== "undefined" && value instanceof Node) {
    if (!groupMark(value)) Reflect.set(value, groupKey, scope);
  }
  return value;
}

function closeGroup(scope: GroupScope) {
  if (scope.closed) return;
  scope.closed = true;
  const context = scope.context.value;
  if (scope.kind === "root" && context) {
    context.active = false;
    context.values = {};
  }
  scope.children = undefined;
  scope.data = undefined;
  scope.event = undefined;
  scope.context.value = undefined;
}

export function groupScope() {
  if (!activeGroup) {
    throw new Error("Luon group scope is only available inside a group View.");
  }
  return activeGroup;
}

export function groupData<Value extends object>(
  scope: GroupScope,
  value?: Value,
) {
  if (scope.kind === "root") {
    if (scope.closed) throw new Error("Luon group root is closed.");
    if (!value) throw new Error("Luon group root data is missing.");
    scope.data = value;
    const context = scope.context.value;
    if (context) attachGroup(scope, context);
    return value;
  }
  const target = {} as Value;
  const source = () => (
    scope.context.value?.active
      ? scope.context.value.values.data as Value | undefined
      : undefined
  );
  return new Proxy(target, {
    deleteProperty(_target, key) {
      const data = source();
      return data ? Reflect.deleteProperty(data, key) : false;
    },
    get(_target, key, receiver) {
      const data = source();
      return data ? Reflect.get(data, key, receiver) : undefined;
    },
    getOwnPropertyDescriptor(_target, key) {
      const data = source();
      return data
        ? Reflect.getOwnPropertyDescriptor(data, key)
        : undefined;
    },
    has(_target, key) {
      const data = source();
      return data ? Reflect.has(data, key) : false;
    },
    ownKeys() {
      return Reflect.ownKeys(source() || target);
    },
    set(_target, key, next, receiver) {
      const data = source();
      if (!data) {
        throw new Error("Luon group member requires its root View.");
      }
      return Reflect.set(data, key, next, receiver);
    },
  });
}

export function groupEvent(
  scope: GroupScope,
  name: string,
  event: ViewEvents,
) {
  if (scope.closed) throw new Error("Luon group View is closed.");
  scope.event = { name, value: event };
  const context = scope.context.value;
  if (context) attachGroup(scope, context);
  if (scope.kind === "root") return event;
  return new Proxy(event, {
    get(target, key, receiver) {
      if (Reflect.has(target, key)) return Reflect.get(target, key, receiver);
      const context = scope.context.value;
      const values = context?.active ? context.values.events as
        | Record<string, ViewEvents>
        | undefined : undefined;
      const root = values?.[scope.root];
      return root ? Reflect.get(root, key, root) : undefined;
    },
    has(target, key) {
      if (Reflect.has(target, key)) return true;
      const context = scope.context.value;
      const values = context?.active ? context.values.events as
        | Record<string, ViewEvents>
        | undefined : undefined;
      const root = values?.[scope.root];
      return root ? Reflect.has(root, key) : false;
    },
  });
}

export function groupView<Props extends ViewProps>(
  view: Component<Props>,
  root: string,
  isRoot = false,
): Component<Props> {
  const Group = (props: Props) => {
    const context = isRoot
      ? {
          active: true,
          root,
          values: actState<Record<string, unknown>>({}),
        }
      : undefined;
    const scope: GroupScope = {
      children: props.children,
      context: actState({ value: context }),
      kind: isRoot ? "root" : "member",
      root,
    };
    if (context) bindGroup(props.children, context);
    const child = withGroup(scope, () => view(props));
    if (!isRead(child)) return markGroup(child, scope);
    return Object.freeze({
      __act: true as const,
      [groupKey]: scope,
      [propsKey]: (child as ViewChild)[propsKey],
      dispose() {
        try { child.dispose?.(); }
        finally { closeGroup(scope); }
      },
      read: () => markGroup(child.read() as Child, scope),
    });
  };
  Object.defineProperty(Group, "name", { value: view.name });
  return Group;
}

type PropsRule<Shape extends RuleShape> = ObjectRule<Shape, boolean>;
type ComponentProps<Props, Shape extends RuleShape> =
  Omit<Props, keyof Shape> & Partial<ShapeOutput<Shape>>;

export function eventView(event: ViewEvents) {
  const life = currentLife();
  const call = (phase: string, run: () => unknown) => life
    ? lifeCall(life, phase, run) : run();
  const clean: Array<() => void> = [];
  let loaded = false;
  let closed = false;
  const bind = (
    target: EventTarget | undefined,
    handlers: EventTargetMap | undefined,
  ) => {
    if (!target || !handlers) return;
    for (const [name, run] of Object.entries(handlers)) {
      if (typeof run !== "function") continue;
      const handler = (event: Event) => call(`event.${name}`, () => run(event));
      target.addEventListener(name, handler, true);
      clean.push(() => target.removeEventListener(
        name,
        handler,
        true,
      ));
    }
  };
  return {
    load() {
      if (loaded || closed) return;
      loaded = true;
      bind(
        typeof document === "undefined" ? undefined : document,
        event.document,
      );
      bind(
        typeof window === "undefined" ? undefined : window,
        event.window,
      );
      call("load", () => event.load?.());
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        call("close", () => event.close?.());
      } finally {
        for (const run of clean.splice(0).toReversed()) run();
      }
    },
  };
}

export function attrsView<
  Props extends ViewProps,
  Shape extends RuleShape,
>(source: Props, spec: PropsRule<Shape>) {
  return new Proxy(source, {
    ownKeys(target) {
      return Reflect.ownKeys(target).filter((key) => (
        typeof key !== "string" || key === "style" || !spec.fields[key]
      ));
    },
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === "string" && key !== "style" && spec.fields[key]) {
        return undefined;
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  }) as Omit<Props, keyof Shape>;
}

export function passProps(child: unknown, values: ViewProps) {
  if (!child || typeof child !== "object") return false;
  const target = (child as ViewChild)[propsKey];
  if (!target) return false;
  Object.assign(target, values);
  return true;
}

export function sourceView<Props extends ViewProps>(props: Props): Props {
  return (propSources.get(props) || props) as Props;
}

export function namedView<
  Create extends (props: any) => Child,
>(
  name: string,
  create: Create,
  spec?: PropsRule<RuleShape>,
  source?: ViewSource,
): Create {
  const View = componentView(name, (props) => {
    const source = propSources.get(props) || props;
    const input = propView(source, spec, false);
    const child = create(input);
    return { render: () => child };
  }, undefined, source);
  return ((props: ViewProps) => {
    const child = View(props) as Read<Child>;
    try {
      const result = rootView(child.read(), props);
      const attach = (value: Child) => {
        if (Array.isArray(value)) value.forEach(attach);
        else if (typeof Node !== "undefined" && value instanceof Element) {
          // A native ref owns the synchronous named View boundary.
          bindProps(value, { ref: (node: Element | null) => {
            if (!node) child.dispose?.();
          } });
        }
      };
      attach(result);
      return result;
    } catch (error) {
      child.dispose?.();
      throw error;
    }
  }) as Create;
}

export function namedViews<
  Creates extends Record<string, (props: any) => Child>,
>(
  creates: Creates,
  spec?: (name: keyof Creates & string) => PropsRule<RuleShape>,
  source?: ViewSource,
): Creates {
  return Object.fromEntries(Object.entries(creates).map(([name, create]) => [
    name,
    namedView(name, create, spec?.(name), source),
  ])) as Creates;
}

function rootView(child: Child, props: ViewProps): Child {
  const custom = props.className ?? props.class;
  if (custom == null) return child;
  const roots = new WeakSet<Element>();
  const apply = (value: Child): Child => {
    if (isRead(value)) return act(() => apply(value.read() as Child));
    if (typeof Element === "undefined" || !(value instanceof Element)) {
      return value;
    }
    if (roots.has(value)) return value;
    roots.add(value);
    const base = value.getAttribute("class");
    const classes = isRead(custom)
      ? act(() => [base, custom.read()])
      : [base, custom];
    return bindProps(value, { class: classes });
  };
  return apply(child);
}

function propView<
  Props extends ViewProps,
  Shape extends RuleShape,
>(
  source: Props,
  spec?: PropsRule<Shape>,
  unwrap = true,
) {
  const props = new Proxy(source, {
    get(target, key, receiver) {
      if (key === "$attrs") {
        return spec ? attrsView(source, spec) : source;
      }
      const value = Reflect.get(target, key, receiver);
      if (isRead(value) && !unwrap) {
        if (typeof key !== "string") return value;
        const field = spec?.fields[key];
        if (field?.kind === "unknown") return value;
        return field
          ? act(() => field.readValue(value.read(), [key]))
          : value;
      }
      const input = isRead(value) ? value.read() : value;
      if (typeof key !== "string") return input;
      const field = spec?.fields[key];
      return field ? field.readValue(input, [key]) : input;
    },
  });
  propSources.set(props, source);
  return props;
}

export function componentView<Props extends ViewProps = ViewProps>(
  name: string,
  setup: Setup<Props>,
  spec?: undefined,
  source?: ViewSource,
): Component<Props>;
export function componentView<
  Props extends ViewProps = ViewProps,
  Shape extends RuleShape = RuleShape,
>(
  name: string,
  setup: Setup<Props>,
  spec: PropsRule<Shape>,
  source?: ViewSource,
): Component<ComponentProps<Props, Shape>>;
export function componentView<
  Props extends ViewProps = ViewProps,
  Shape extends RuleShape = RuleShape,
>(
  name: string,
  setup: Setup<Props>,
  spec?: PropsRule<Shape>,
  source?: ViewSource,
) {
  const View = (props: Props) => {
    const input = propView(props, spec) as Props & ShapeOutput<Shape>;
    const frame = { view: name, ...source, phase: "setup" };
    const life: ViewLife = { close: [], load: [], frame };
    let rendered: ViewLife | undefined;
    let scope: ViewScope<Props>;
    const clean = (...runs: Array<() => void>) => {
      const errors: unknown[] = [];
      for (const run of runs) {
        try { run(); } catch (error) { errors.push(error); }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, "View cleanup failed.");
    };
    try {
      scope = runLife(life, "setup", () => setup(input));
    } catch (error) {
      clean(() => closeLife(life), () => { throw error; });
      throw error;
    }
    let loaded = false;
    let closed = false;
    const load = (render: ViewLife) => {
      if (closed || render.closed) return;
      try {
        if (!loaded) {
          loaded = true;
          lifeCall(life, "load", () => scope.load?.());
          loadLife(life);
        }
        loadLife(render);
      } catch (error) {
        clean(close, () => { throw error; });
      }
    };
    const close = () => {
      if (closed) return;
      closed = true;
      clean(
        () => { if (rendered) closeLife(rendered); },
        () => closeLife(life),
        () => { lifeCall(life, "close", () => scope.close?.()); },
      );
    };
    const read = act((): Child => {
      if (closed) throw new Error(`Luon ${name} View is closed.`);
      viewVersion();
      const next: ViewLife = { close: [], load: [], frame };
      let child: Child;
      try {
        child = runLife(next, "render", () => scope.render(input));
      } catch (error) {
        clean(() => closeLife(next),
          () => { if (!rendered) close(); },
          () => { throw error; });
        throw error;
      }
      const previous = rendered;
      rendered = next;
      if (previous) closeLife(previous);
      queueMicrotask(() => load(next));
      return child;
    });
    return Object.freeze({
      __act: true as const,
      [propsKey]: props,
      dispose: close,
      read: read.read,
    });
  };

  Object.defineProperty(View, "name", { value: name });
  return View as unknown as Component<ComponentProps<Props, Shape>>;
}
