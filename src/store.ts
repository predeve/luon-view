import { state as actState } from "@luon/act";

type Listener = () => void;

export type ViewStore = {
  dispose: () => void;
  notify: () => void;
  proxy: <Value extends object>(value: Value) => Value;
  snapshot: () => number;
  subscribe: (listener: Listener) => () => void;
};

let active: ViewStore | undefined;
let shared: ViewStore | undefined;
const views = new Set<ViewStore>();
const version = actState({ value: 0 });

function observable(value: object) {
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function createStore(): ViewStore {
  const listeners = new Set<Listener>();
  const proxies = new WeakMap<object, object>();
  const values = new WeakMap<object, object>();
  let version = 0;

  const notify = () => {
    version++;
    for (const listener of listeners) listener();
  };

  const proxy = <Value extends object>(value: Value): Value => {
    if (!observable(value)) return value;
    if (values.has(value)) return value;
    const found = proxies.get(value);
    if (found) return found as Value;

    const wrapped = new Proxy(value, {
      defineProperty(target, name, descriptor) {
        const previous = Reflect.getOwnPropertyDescriptor(target, name);
        const saved = Reflect.defineProperty(target, name, descriptor);
        if (saved && previous !== descriptor) notify();
        return saved;
      },
      deleteProperty(target, name) {
        if (!Reflect.has(target, name)) return true;
        const removed = Reflect.deleteProperty(target, name);
        if (removed) notify();
        return removed;
      },
      get(target, name, receiver) {
        const result = Reflect.get(target, name, receiver);
        if (!result || typeof result !== "object") return result;
        return proxy(result);
      },
      set(target, name, next, receiver) {
        const value = typeof next === "object" && next
          ? values.get(next) || next
          : next;
        const previous = Reflect.get(target, name, receiver);
        const changed = !Object.is(previous, value);
        const saved = Reflect.set(target, name, value);
        if (saved && changed) notify();
        return saved;
      },
    });

    proxies.set(value, wrapped);
    values.set(wrapped, value);
    return wrapped;
  };

  const store: ViewStore = {
    dispose: () => views.delete(store),
    notify,
    proxy,
    snapshot: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  views.add(store);
  return store;
}

export function refreshViews() {
  version.value++;
  for (const store of views) store.notify();
}

export function viewVersion() {
  return version.value;
}

function sharedStore() {
  if (shared) return shared;
  shared = createStore();
  shared.dispose();
  shared.subscribe(refreshViews);
  return shared;
}

export function viewStore() {
  return active || sharedStore();
}

export function withStore<Value>(store: ViewStore, run: () => Value) {
  const previous = active;
  active = store;
  try {
    return run();
  } finally {
    active = previous;
  }
}

export function state<Value extends object>(value: Value) {
  if (!value || typeof value !== "object") {
    throw new Error("Luon data must be an object or array");
  }
  return actState(value);
}
