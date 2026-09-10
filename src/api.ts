import { currentLife } from "./life.ts";

export type ApiConfig = {
  base?: string;
  cookie?: boolean | "include";
  timeout?: number;
  headers?: HeadersInit;
  onError?: (error: unknown) => void;
};

export type ApiRule = ApiConfig & {
  url: string;
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
};

export type ApiOptions = {
  params?: Record<string, string | number>;
  signal?: AbortSignal;
};

export type ApiCall = <Value = unknown>(
  data?: unknown,
  options?: ApiOptions,
) => Promise<Value>;

export type Apis<Rules> = {
  readonly [Key in Exclude<keyof Rules, "config">]: ApiCall;
};

type ApiRules = { config?: ApiConfig } & Record<string, ApiConfig | ApiRule>;

function apiUrl(rule: ApiRule, base: string, options: ApiOptions) {
  const path = rule.url.replace(/:([a-zA-Z_]\w*)/g, (match, key, offset) => {
    // A URL scheme is not a path parameter.
    if (offset > 0 && rule.url[offset - 1] !== "/") return match;
    const value = options.params?.[key];
    if (value === undefined) throw new Error(`Missing API parameter: ${key}`);
    return encodeURIComponent(String(value));
  });
  return /^(?:https?:)?\/\//.test(path)
    ? path
    : `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

/** Creates request functions owned by the current View instance. */
export function apiView<Rules extends ApiRules>(rules: Rules): Apis<Rules> {
  const life = currentLife();
  if (!life) throw new Error("API calls must be created inside a View.");
  const active = new Set<AbortController>();
  life.close.push(() => {
    for (const request of active) request.abort();
    active.clear();
  });
  const output: Record<string, ApiCall> = Object.create(null);
  for (const [name, entry] of Object.entries(rules)) {
    if (name === "config") continue;
    if (!("url" in entry) || typeof entry.url !== "string") {
      throw new TypeError(`API '${name}' requires a URL.`);
    }
    const rule = entry as ApiRule;
    const config = {
      base: "/api",
      cookie: true,
      timeout: 5000,
      ...rules.config,
      ...rule,
    };
    if (!Number.isFinite(config.timeout) || config.timeout < 0) {
      throw new TypeError(`API '${name}' requires a nonnegative timeout.`);
    }
    const headers = new Headers({ Accept: "application/json" });
    for (const values of [rules.config?.headers, rule.headers]) {
      new Headers(values).forEach((value, key) => headers.set(key, value));
    }
    output[name] = async <Value>(data?: unknown, options: ApiOptions = {}) => {
      const request = new AbortController();
      if (life.closed) request.abort();
      const abort = () => request.abort(options.signal?.reason);
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
      const limit = setTimeout(
        () =>
          request.abort(
            new DOMException("API request timed out.", "TimeoutError"),
          ),
        config.timeout,
      );
      active.add(request);
      let stop: () => void = () => {};
      const stopped = new Promise<never>((_resolve, reject) => {
        stop = () => reject(request.signal.reason);
        request.signal.addEventListener("abort", stop, { once: true });
      });
      try {
        const run = async () => {
          request.signal.throwIfAborted();
          const path = apiUrl(rule, config.base, options);
          const origin =
            typeof location !== "undefined"
              ? location.href
              : "http://localhost/";
          const url = new URL(path, origin);
          const method = rule.method || "GET";
          const init: RequestInit = {
            method,
            headers: new Headers(headers),
            signal: request.signal,
            credentials:
              config.cookie === "include"
                ? "include"
                : config.cookie
                  ? "same-origin"
                  : "omit",
          };
          if (data !== undefined) {
            if (method === "GET" || method === "HEAD") {
              if (!data || typeof data !== "object" || Array.isArray(data)) {
                throw new TypeError("API query data must be an object.");
              }
              for (const [key, value] of Object.entries(data)) {
                if (value !== undefined && value !== null) {
                  url.searchParams.set(key, String(value));
                }
              }
            } else {
              init.body = JSON.stringify(data);
              if (!(init.headers as Headers).has("content-type")) {
                (init.headers as Headers).set(
                  "content-type",
                  "application/json",
                );
              }
            }
          }
          const response = await fetch(url, init);
          const text = await response.text();
          request.signal.throwIfAborted();
          const type = response.headers.get("content-type") || "";
          const value =
            text &&
            (type.includes("application/json") || type.includes("+json"))
              ? JSON.parse(text)
              : text || undefined;
          if (!response.ok) {
            const message =
              value && typeof value === "object"
                ? value.error || value.message
                : value;
            throw Object.assign(
              new Error(
                String(message || `Request failed: ${response.status}`),
              ),
              { status: response.status, data: value },
            );
          }
          return value as Value;
        };
        return await Promise.race([run(), stopped]);
      } catch (error) {
        // Cancellation is expected when a View closes or a resource reloads.
        if (
          !request.signal.aborted ||
          request.signal.reason?.name === "TimeoutError"
        ) {
          config.onError?.(error);
        }
        throw error;
      } finally {
        clearTimeout(limit);
        request.signal.removeEventListener("abort", stop);
        options.signal?.removeEventListener("abort", abort);
        active.delete(request);
      }
    };
  }
  return Object.freeze(output) as Apis<Rules>;
}
