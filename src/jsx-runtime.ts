import {
  act,
  Fragment,
  jsx as actJsx,
  type Child,
  type Component,
  type Read,
} from "@luon/act";
import type {
  DomEvents,
  JSX as ActJSX,
} from "@luon/act/jsx-runtime";

import { currentLife, lifeCall } from "./life.ts";
import { classText, type ClassValue } from "./class.ts";
import type { Attrs } from "./compat.ts";

declare global {
  var attrs: Attrs;
  var props: Record<string, any>;
  interface Window {
    luon?: {
      setIcon(name: string): void;
      showMcp?(): void;
      setTitlebar?(enabled: boolean): Promise<{
        enabled: boolean; left: number; right: number; height: number;
      }>;
      browser?: {
        version?: number;
        background?: boolean;
        window?(action: "minimize" | "maximize" | "close" | "drag"): void;
        control?(options: {
          enabled: boolean; portStart: number; portEnd: number;
        }): void;
        emit?(event: string, params: Record<string, unknown>): void;
        create?(options: { id: string; independent?: boolean }): void;
        overlay?(visible: boolean): void;
        snapshot?(id: string): Promise<{ data: string }>;
        mount(rect: {
          x: number;
          y: number;
          width: number;
          height: number;
          background?: boolean;
        }, id?: string): void;
        open(url: string, id?: string): void;
        back(id?: string): void;
        forward(id?: string): void;
        reload(id?: string, options?: { ignoreCache?: boolean }): void;
        close(id?: string): void;
        setTheme?(theme: "light" | "dark" | "system"): void;
      };
    };
  }
}

export { Fragment };

type ViewAttrs = DomEvents & {
  autocomplete?: string;
  autofocus?: boolean;
  class?: ClassValue | Read<ClassValue>;
  clean?: "number" | "trim";
  colspan?: number | string;
  for?: string;
  html?: string;
  maxlength?: number | string;
  minlength?: number | string;
  readonly?: boolean;
  rowspan?: number | string;
  update?: "change" | "input";
  [name: string]: unknown;
};

export namespace JSX {
  export type Element = Child;
  export type ElementType = string | Component<any>;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  export interface IntrinsicAttributes extends ActJSX.IntrinsicAttributes {
    [name: `bind${string}`]: unknown;
  }
  export interface IntrinsicElements {
    [name: string]: ViewAttrs;
  }
}

function previewUrl(value: unknown) {
  if (
    typeof value !== "string"
    || !value.startsWith("/")
    || value.startsWith("//")
    || typeof document === "undefined"
  ) return value;
  const tag = document.querySelector("base[href]") as HTMLBaseElement | null;
  if (!tag) return value;
  const base = new URL(tag.href);
  if (!/^\/api\/templates\/tmp-[a-z0-9-]+\/preview\/$/.test(
    base.pathname,
  )) return value;
  const url = new URL(value.slice(1), base);
  return `${url.pathname}${url.search}${url.hash}`;
}

function inputValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  return value == null ? "" : String(value);
}

function readValue(
  value: unknown,
  format: (value: unknown) => unknown,
) {
  const source = value as Partial<Read> | null;
  if (source?.__act === true && typeof source.read === "function") {
    const read = source.read;
    return act(() => format(read()));
  }
  return format(value);
}

function normalize(type: unknown, source: Record<string, any> = {}) {
  const props = { ...source };
  if (typeof type !== "string") return props;
  if ("class" in props) {
    props.class = readValue(props.class, classText);
  }
  if ("className" in props) {
    props.className = readValue(props.className, classText);
  }
  for (const name of ["action", "href", "poster", "src"]) {
    if (name in props) {
      props[name] = readValue(props[name], previewUrl);
    }
  }
  if (type === "input" && "value" in props) {
    props.value = readValue(props.value, inputValue);
  }
  return props;
}

export function jsx(type: any, props: Record<string, any>, key?: unknown) {
  const life = currentLife();
  const values = normalize(type, props);
  if (life && typeof type === "string") {
    for (const [name, run] of Object.entries(values)) {
      if (/^on[A-Z]/.test(name) && typeof run === "function") {
        values[name] = function (this: unknown, ...args: unknown[]) {
          return lifeCall(life, `event.${name}`, () => run.apply(this, args));
        };
      }
    }
  }
  return actJsx(type, values, key);
}

export const jsxs = jsx;

export function jsxDEV(
  type: any,
  props: Record<string, any>,
  key?: unknown,
  ..._debug: unknown[]
) {
  return jsx(type, props, key);
}
