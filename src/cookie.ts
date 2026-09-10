import { state, untrack } from "@luon/act";
import { currentLife } from "./life.ts";

export type CookieRule = { value?: string; expire?: number };
export type Cookies<Rules> = { [Key in keyof Rules]: string | null };
type Jar = { rules: Map<string, CookieRule>; version: { value: number } };
const jars = new WeakMap<Document, Jar>();

function jar(doc: Document) {
  let value = jars.get(doc);
  if (!value) {
    value = { rules: new Map(), version: state({ value: 0 }) };
    jars.set(doc, value);
  }
  return value;
}

function read(doc: Document, name: string) {
  try {
    for (const part of doc.cookie.split(";")) {
      const item = part.trim();
      const at = item.indexOf("=");
      if (at < 0 || item.slice(0, at) !== name) continue;
      const value = item.slice(at + 1);
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  } catch {
    /* Restricted browser storage behaves like a missing cookie. */
  }
  return null;
}

function write(doc: Document, name: string, value: string | null) {
  const entry = jar(doc);
  const rule = entry.rules.get(name);
  if (!rule) throw new Error(`Declare cookie.${name} before writing it.`);
  if (value !== null && typeof value !== "string") {
    throw new TypeError("Cookie values must be strings or null for deletion.");
  }
  if (read(doc, name) === value) return;
  const text = `${name}=${value === null ? "" : encodeURIComponent(value)}`;
  let attrs = "; Path=/; SameSite=Lax";
  if (doc.location?.protocol === "https:") attrs += "; Secure";
  if (value === null) {
    attrs += "; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
  } else if (rule.expire !== undefined) attrs += `; Max-Age=${rule.expire}`;
  try {
    doc.cookie = text + attrs;
  } catch {
    /* The browser owns storage policy; reads report its actual value. */
  }
  untrack(() => entry.version.value++);
}

/** Reads visible cookies without declaring defaults or extending expiry. */
export const cookie: Record<string, string | null> = new Proxy(
  Object.create(null),
  {
    get(_target, name) {
      if (typeof name !== "string") return;
      if (!globalThis.document) return null;
      const doc = globalThis.document;
      // Track local writes while reading the browser's current cookie value.
      void jar(doc).version.value;
      return read(doc, name);
    },
    set(_target, name, value) {
      if (typeof name !== "string" || !globalThis.document) {
        throw new Error("Cookie writes require a browser document.");
      }
      write(globalThis.document, name, value);
      return true;
    },
  },
);

/** Register cookie defaults and write settings for the current document. */
export function cookieView<Rules extends Record<string, CookieRule>>(
  rules: Rules,
): Cookies<Rules> {
  const life = currentLife();
  if (!life || life.closed) {
    throw new Error("Cookie declarations require an active View.");
  }
  for (const [name, rule] of Object.entries(rules)) {
    if (
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) ||
      ["__proto__", "constructor", "prototype"].includes(name)
    ) {
      throw new TypeError(`Invalid cookie name: ${name}`);
    }
    if (
      !rule ||
      typeof rule !== "object" ||
      Array.isArray(rule) ||
      Object.keys(rule).some((key) => !["value", "expire"].includes(key))
    ) {
      throw new TypeError(`Cookie ${name} supports value and expire.`);
    }
    if (rule.value !== undefined && typeof rule.value !== "string") {
      throw new TypeError("Cookie initial values must be strings.");
    }
    if (
      rule.expire !== undefined &&
      (!Number.isSafeInteger(rule.expire) || rule.expire <= 0)
    ) {
      throw new TypeError("Cookie expire must be positive integer seconds.");
    }
  }
  const doc = globalThis.document;
  if (!doc) return cookie as Cookies<Rules>;
  const entry = jar(doc);
  for (const [name, rule] of Object.entries(rules)) {
    entry.rules.set(name, { ...rule });
    if (rule.value !== undefined && read(doc, name) === null) {
      write(doc, name, rule.value);
    }
  }
  return cookie as Cookies<Rules>;
}
