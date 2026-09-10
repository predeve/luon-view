# @luon/view

Part of [Luon](https://www.luon.dev) — Luon View compiler and Act runtime.

[Package guide](https://pkg.luon.dev/packages/view/) ·
[Source](https://github.com/predeve/luon-view) ·
[Developer tools](https://www.luon.dev/tools)

Plain state and a small View. The compiler connects reactive updates.

```tsx
// counter.view.tsx
export const data = { count: 0 };

export default () => (
  <button onClick={() => data.count++}>
    Count: {data.count}
  </button>
);
```

Luon compiles this syntax automatically. In a standalone Bun build, register
`viewPlugin` from `@luon/view/plugin`, then mount the compiled View with Act.
Read the implementation: [compiler](src/compiler.ts) ·
[reactivity](src/reactive.ts).

Named requests use the same small declaration style:

```tsx
export const api = {
  users: { url: "/users" },
  save: { url: "/users", method: "POST" },
};

async function save() {
  await api.save({ name: "Luon" });
}
```

The default base is `/api`, with same-origin cookies, JSON headers, and a
5-second timeout. Common and per-endpoint settings are optional.

Selected state can also survive reopening the View:

```tsx
export const data = { theme: "dark", name: "mr.kim" };
export const persist = { preferences: ["theme", "name"] };
```

View restores these fields and saves their changes automatically in local
browser/WebView storage.

## The engine at the center of Luon

**View brings Luon's building blocks together into one screen authoring
model.** It defines how components, state, events, resources, styles, and
lifecycles work together across Luon products.

- [Act](https://github.com/predeve/luon-act) powers reactive state and DOM
  updates beneath View.
- [Style](https://github.com/predeve/luon-style) provides scoped CSS and
  reactive styling for Views.
- [Rule](https://github.com/predeve/luon-rule) supplies validation rules
  that Views and forms can use.
- [UI](https://github.com/predeve/luon-ui) turns View's strengths into
  finished components: Luon's most complete screen development experience
  and a showcase of what the engine can do.

View coordinates the screen; the other packages supply focused capabilities.
UI is built on View rather than being a required dependency of View.
These packages remain separately usable, while View gives Luon developers
a consistent way to combine them.

## Install

```bash
bun add @luon/view --registry https://pkg.luon.dev
```

## Who it is for

Luon Site authors and tools compiling the public TSX View language.

## Core concepts

### Reserved module exports

data, computed, watch, event, timer, api, persist, style, deepStyle, and default form one View definition that the compiler connects to Act.

### Plain reactive state

Objects and arrays are mutated directly. Each mounted View receives its own data instance when its initializer creates a fresh object. Intentionally shared state belongs
in a separate ordinary TypeScript module. Imported objects are not cloned.

### Compiler syntax

bind, class, for, html, component refs, and automatic globals are compiled before Act executes the result.

### Minimal lifecycle

event.load runs after connection and event.close runs before disposal. External subscriptions must be paired across those two boundaries.

### Composite View groups

datas, specs, styles, and events isolate named components while group connects members to their nearest root context.

## Quick reference

### Reserved exports

One View file declares behavior through these stable names.

| Export | Owns |
| --- | --- |
| spec | Prop defaults, validation, and attrs |
| data | Per-instance reactive state |
| computed | Lazy cached getters and optional setters |
| watch | Observed values and cleanup |
| event | Handlers, load, close, window, and document |
| style | Scoped CSS and class recipes |
| deepStyle | Styles passed into child components |
| default | The rendered View |

### View syntax

The compiler turns these forms into small Act boundaries.

| Syntax | Use |
| --- | --- |
| bind={data.name} | Two-way component or form value |
| for={items} | Reactive list ownership |
| class={...} | Strings, arrays, and condition objects |
| html={value} | Trusted native innerHTML |
| element() | One callable native element ref |
| component() | One callable component ref |
| elements() | A collected list of element refs |

### File shapes

Pick the smallest View shape that preserves state ownership.

| Need | Pattern |
| --- | --- |
| One screen or component | default View + singular exports |
| Several independent components | named Views + plural exports |
| Composite component family | group root and members |
| Package build boundary | *.view.tsx compiled to *.view.js |

## Examples

### Reactive View

Export state and render it directly; no hook wrapper is required.

```tsx
export const data = {
  count: 0,
  name: "Luon",
};


export default () => (
  <button onClick={() => data.count++}>
    {data.name}: {data.count}
  </button>
);
```

### Computed form value

A getter and setter computed function can be used as a bind target.

```tsx
export const data = { first: "", last: "" };

export const computed = {
  name: {
    get: () => [data.first, data.last].filter(Boolean).join(" "),
    set: (value: string) => {
      [data.first, data.last] = value.split(" ", 2);
    },
  },
};

export default () => <Input bind={computed.name} />;
```

### Automatic window events

Declare window events; View registers and removes them automatically.

```tsx
export const event = {
  window: {
    resize() {
      console.log(innerWidth);
    },
  },
};

export default () => <p>Listening</p>;
```

### Named View group

A group shares root data and events without prop drilling.

```tsx
export const datas = {
  Dialog: { open: false },
};

export const events = {
  Dialog: { show() { data.open = true; } },
  DialogTrigger: { click() { event.show(); } },
};

export const specs = {
  Dialog: { modal: r.boolean().default(true) },
};

export const group = {
  Dialog: [DialogTrigger],
};

export function Dialog(props) {
  return <dialog open={data.open}>{props.children}</dialog>;
}

export const DialogTrigger = () => (
  <button onClick={event.click}>Open</button>
);
```

### Bind input, validation, and scoped style

One View can own value flow, prop rules, and local presentation.

```tsx
export const data = { email: "" };

export const computed = {
  valid: () => r.email().safeParse(data.email).success,
};

export default () => <form class="form">
  <Input bind={data.email} type="email" placeholder="you@example.com" />
  <Button disabled={!computed.valid()}>Continue</Button>
</form>;

export const style = {
  form: "grid gap-3 rounded-xl border p-5",
};
```

## API reference

### `state(value)`

Make a plain object reactive in a View store.

### `bindView(source, name?, options?)`

Create the callable two-way value contract used by bind syntax.

### `componentView(name, setup)`

Create the compiled Act boundary.

### `namedView / namedViews`

Create one or several named package View boundaries.

### `groupView / groupScope`

Connect composite members to their nearest root context.

### `computedView(definitions)`

Build callable getters and setters.

### `watchView(data, definitions)`

Run watchers with timing and cleanup.

### `event.load / event.close`

Register connection and disposal work.

### `onLoad / onClose`

Register lifecycle work from package helpers inside the current scope.

### `element / elements / component`

Create callable proxied refs.

### `attrsView / passProps / sourceView`

Preserve and forward the current component property boundary.

### `provideContext / useContext`

Publish and read explicitly shared values in a View scope.

### `styleView / deepView / dynamicView`

Connect scoped, child, and prop-aware style rules.

### `compileView(source, options?)`

Compile Luon TSX to Act source.

### `viewPlugin`

Apply the View compiler through Bun builds.

## Runtime flow

1. The compiler finds reserved exports and validates their shape.
2. It transforms Luon-only TSX syntax and generates Act-compatible code.
3. componentView creates the reactive store and one scope per mount.
4. group connects named members to the nearest mounted root context.
5. Act renders the scope and the View lifecycle owns cleanup.

## Boundaries

- The renderer is Act, while the public View syntax is a separate contract.
- Date, Map, Set, and class instances are not deep reactive values.
- html accepts trusted HTML and does not escape untrusted input.
- The supported lifecycle is limited to event.load and event.close.

## More documentation

- [Live View examples](https://view.luon.dev)
- [Complete View language](https://docs.luon.dev/frontend/view)
- [State and watchers](https://docs.luon.dev/frontend/state-watch)
- [Forms and validation](https://docs.luon.dev/frontend/forms-validation)

## License

[MIT](LICENSE) © predeve

## Ownership, caching, and error context

`computed` getters cache per instance until their reactive dependencies change.
Use pure getters and update reactive state in setters. Use `{ get, cache: false }`
for nonreactive external values that must be read on every call.

Package helpers can use `memoView(get)` to create the same lazy cached getter,
and `effectView(run)` for tracked work. Both release subscriptions automatically
with their current View scope. Outside a View, call `getter.dispose()` or the
returned effect stop function yourself.

```tsx
import { liveView, memoView, onClose, onLoad } from "@luon/view";

export default () => {
  const total = memoView(() => props.rows.reduce((n, row) => n + row.price, 0));
  onLoad(() => {
    const timer = setInterval(() => console.log(total()), 1000);
    onClose(() => clearInterval(timer));
  });
  return <p>{liveView(() => total())}</p>;
};
```

`onLoad`/`onClose` may be called in synchronous setup, render helpers, or load
callbacks (register only cleanup during load). Register cleanup before `await`.
Setup resources live for the instance; render resources live for that render.
Replacement, unmount, and setup/render failures release their scopes. One
cleanup error does not skip remaining cleanup or DOM removal. `scope(create)`
also closes only once. Reserved exports remain `event.load` and `event.close`.

`ViewError.frames` identifies the original View file, name, and execution phase.
`cause` preserves the original exception and stack, including async event,
watch, and lifecycle rejections. File, line, and column identify the handler or View definition,
not a mapped failing statement. Multiple cleanup errors use `AggregateError`.

## Editor diagnostics

`compileView` errors expose `location` with file, one-based line/column, and
UTF-16 start/length when the original location is known. The Core editor checks
the current buffer before the general linter and highlights invalid View syntax.
Typed default props and computed getter results participate in completion through
virtual declarations; saved source is unchanged. Read-only computed values throw
on writes. See the [state ownership guide](https://docs.luon.dev/frontend/state-watch).

## Declarative timers

Declare named timers with `export const timer` in a default View. Each mounted
instance gets independent controls and cleanup, including when the same View
is mounted more than once. No timer import or timer ID is needed.

```tsx
export const data = { ticks: 0 };

export default () => (
  <section>
    <p>Ticks: {data.ticks}</p>
    <button onClick={() => timer.refresh.start()}>Start</button>
    <button onClick={() => timer.refresh.stop()}>Stop</button>
  </section>
);

export const timer = {
  refresh: {
    interval: 1_000,
    run() { data.ticks++; },
  },
};
```

| Setting | Behavior |
| --- | --- |
| `interval` | Repeat at this interval in milliseconds |
| `timeout` | Run once after this delay in milliseconds |
| `active` | Start automatically on View load; defaults to `true` |
| `run` | Function to execute; may return a Promise |

Set exactly one of `interval` or `timeout`. Delays must be finite numbers
between 0 and 2,147,483,647 milliseconds. The first callback runs after the
specified delay, not immediately. Call your work function separately if an
immediate initial result is needed. Use static timer names without object spreads or computed keys.
Timer declarations require a default View;
there is no plural `timers` export for named-only modules.

### Manual control and async setup

Use `active: false` when the timer should wait for a connection, playback,
or another condition. `start()` and `stop()` control an individual timer;
`event.load` and `event.close` remain the View lifecycle names.

```tsx
export const timer = {
  refresh: {
    interval: 1_500,
    active: false,
    async run() { await refresh(); },
  },
  reconnect: {
    timeout: 2_000,
    active: false,
    run: connect,
  },
};

export const event = {
  async load() {
    await connect();
    timer.refresh.start();
  },
};

function disconnected() {
  timer.refresh.stop();
  timer.reconnect.start();
}
```

Automatic timers do not wait for an async `event.load` to finish. Use the
manual pattern above when setup must complete first.

Here `connect` and `refresh` are application functions. Controls are bound to
their View instance, so they also work after `await` and in external callbacks.
If the View closes during `connect()`, the later `start()` is a no-op.

- Repeated `start()` calls keep the existing schedule without duplicating it
  or resetting its delay. To reset a pending delay, call `stop()` then `start()`.
- Repeated `stop()` calls are safe. Calling `stop()` before load also disables
  the pending automatic start.
- `timer.refresh.active` is a read-only status for an existing schedule.
  Change execution with `start()` and `stop()`, not property assignment. It is
  not reactive UI state. A one-shot timer becomes inactive when its call starts.
- While an async callback is running, further ticks for that timer are skipped;
  they are not queued. Return or await the Promise so Luon can track it. A
  detached `void refresh()` cannot be tracked. Other timers remain independent.
- `stop()` cancels future callbacks, not a running callback or API request.
  Restarting does not allow overlap with a callback still in progress.
- View close cancels its timers and suppresses callbacks queued before close.
  A closed View cannot restart them. Native timers and sibling Views continue.
- Callback errors retain the View source and `timer.<name>` execution phase.

Keep other cleanup, such as closing a socket or disposing an editor, in
`event.close`. Download resource cleanup, request deadlines, and awaited
sequential delays may have a lifetime different from the View; do not convert
them into View timers solely because they use `setTimeout`.

## View-owned timers

For dynamic registrations in shared helpers, use
`timer.timeout(callback, milliseconds)` for one delayed call and
`timer.interval(callback, milliseconds)` for repeated calls. Luon provides
`timer` automatically in application Views. Package helpers can import it
from `@luon/view`. These helpers are separate from named declarations.
In a file declaring `export const timer`, import the helpers under another
name, such as `import { timer as viewTimer } from "@luon/view"`.

```tsx
export const data = { ticks: 0 };

export const event = {
  load() {
    timer.interval(() => data.ticks++, 1_000);
  },
};

export default () => <p>Ticks: {data.ticks}</p>;
```

No `event.close` entry is needed for these timers. Each registration belongs
to the current View scope. Closing one popup or component instance cancels
only that instance's timers; sibling Views and ordinary `setTimeout` and
`setInterval` calls remain untouched.

Both methods return an idempotent cancel function for earlier cancellation:

```ts
const cancel = timer.timeout(() => console.log("Ready"), 2_000);
cancel();
```

Register during synchronous setup, render, `event.load`, or a View event
callback. Timers created during render are canceled when that render is
replaced. Setup/load timers live until their owning instance closes. A timer
callback can create more owned timers before `await`; they inherit its owner.
Calls outside an active View, after `await`, or during cleanup fail explicitly.

Completion and manual cancellation release the timer's cleanup entry. Closing
also suppresses a callback that was queued but has not started. Canceling a
timer does not interrupt an already-running callback or abort its API request.
Async interval callbacks retain native interval behavior and can overlap;
use request cancellation or a separate task scheduler when needed.

## Automatic state persistence

Declare which `data` fields should survive reopening the View. No save or load
function is required.

```tsx
export const data = {
  theme: "dark",
  name: "mr.kim",
  loading: false,
};

export const persist = {
  preferences: ["theme", "name"],
};

export default () => <>
  <input bind={data.name} />
  <button onClick={() => data.theme = "light"}>Light theme</button>
  <p>{data.name} — {data.theme}</p>
</>;
```

`preferences` is a storage group; its array contains top-level `data` field
names. Changing `data.theme` or `data.name` saves automatically. `loading` is
not saved and starts as `false` each time. Multiple groups use the same object
syntax:

```tsx
export const persist = {
  preferences: ["theme"],
  profile: ["name"],
};
```

- Restoration runs immediately after `data` is created, before computed values,
  watchers, rendering, and `event.load` consume it. Put `data` before other
  setup declarations; `persist` itself may appear before or after `data`.
- Missing saved fields keep their declared initial values. Malformed JSON and
  incompatible top-level types are ignored. A `null` or `undefined` initial
  field can accept any supported JSON value.
- Selected arrays and plain objects are observed deeply. Nested changes,
  replacements, and deletions save synchronously. Stored object/array values
  replace their initial counterparts rather than merging nested defaults.
- Values must be JSON data: strings, finite numbers, booleans, null, arrays,
  and plain objects. Functions, Date, BigInt, cyclic objects, and other custom
  instances are not supported. An unsupported group retains its last saved
  value; memory state continues to work. An undefined/deleted top-level field
  is omitted, so the next mount uses its declared default.
- Each field must exist in `data` and appear in only one group. Compiled
  declarations require static group keys and nonempty arrays of field names.
- Persistence uses `localStorage` in the current browser/WebView profile.
  Its namespace includes the document base path, View source path, and group
  key. Different sites/origins, Views, and groups do not share stored values.
  Within Luon projects the View path is relative to `app/`, so changing the
  build directory does not change its key. Renaming the View or group starts
  a new entry. Standalone compilers should supply stable, distinct file IDs.
- Instances of the same View share the stored entry. The latest write wins;
  mounted instances and other tabs are not automatically synchronized.
  Use a shared store when multiple screens need live shared state.
- Closing the View stops persistence effects. KeepAlive keeps them active
  until eviction or owner closure. If storage is blocked or full, the View
  continues to work in memory. Clearing site/profile storage removes saved
  values; this is local preference storage, not a server backup or encryption.

For manual View setup, use
`persistView(data, { preferences: ["theme"] }, "settings")` inside
`componentView`. `data` must be reactive state. The typed `Persist<typeof data>`
helper can check field names in manual code.

## Named API calls

Declare requests once, then call them by name. `config` is optional.

```tsx
export const api = {
  users: { url: "/users" },
  save: { url: "/users", method: "POST" },
};

export const data = { name: "", saved: false };

async function save() {
  await api.save({ name: data.name });
  data.saved = true;
}

export default () => <>
  <input bind={data.name} />
  <button onClick={save}>Save</button>
  {data.saved && <p>Saved.</p>}
</>;
```

Without `config`, every endpoint uses these defaults:

```ts
config: {
  base: "/api",
  cookie: true,
  timeout: 5000,
  headers: { Accept: "application/json" },
}
```

Endpoint settings override common `api.config` settings, which override the
built-in defaults. Header keys merge case-insensitively. Formatting is left to
Oxfmt; declarations do not need to fit on one line.

```tsx
export const api = {
  config: {
    base: "/api",
    timeout: 8000,
    headers: { "X-App": "dashboard" },
    onError(error: unknown) { console.error(error); },
  },
  users: { url: "/users" },
  save: { url: "/users/:id", method: "PATCH", timeout: 3000 },
};

async function example() {
  const users = await api.users<{ items: { id: number }[] }>({ page: 2 });
  await api.save({ name: "Luon" }, { params: { id: users.items[0].id } });
}
```

- `base`: `/api` by default. Relative endpoint paths append to this base.
  An absolute HTTP(S) URL bypasses it. Use `base: ""` for origin-root paths.
- `cookie`: `true` sends same-origin cookies; `false` omits credentials.
  Explicit `"include"` also allows cross-origin credentials, subject to the
  destination server's CORS policy and browser cookie rules.
- `timeout`: milliseconds for the whole request, including reading its body.
  Default `5000`; `0` means an immediate timeout, not an unlimited request.
- `headers`: merged request headers. JSON writes add `Content-Type` only when
  it has not been set explicitly.
- `onError`: optional common error notification, overridable per endpoint.
  Errors still reject the call. Expected owner/caller cancellation skips this
  notification; timeouts notify it.

`api.name(data?, { params?, signal? }?)` returns the parsed response. GET/HEAD
turn the data object into query parameters, omitting null and undefined values;
other methods send JSON. `:id` path parameters are encoded automatically.
HTTP errors carry `status` and parsed `data`. Empty responses return `undefined`;
JSON responses are parsed, other responses return text. The optional generic
response type is a TypeScript assertion, not runtime validation.

Each View instance owns its in-flight requests and aborts them when it closes.
Calls after closure reject. A supplied signal also cancels the request.
Requests are not automatically retried, cached, or started at declaration time.
KeepAlive retains requests until eviction or owner closure, like resources.
For files, streaming, or raw Response access, use `fetch` directly.

Use a resource when the screen needs loading/error/result state:

```tsx
export const api = { profile: { url: "/profile" } };
export const resource = {
  profile: {
    load({ signal }: { signal: AbortSignal }) {
      return api.profile<{ name: string }>(undefined, { signal });
    },
  },
};

export default () => <Await value={resource.profile}
  pending={() => <p>Loading…</p>} error={() => <p>Could not load.</p>}>
  {(profile) => <h2>{profile.name}</h2>}
</Await>;
```

Standalone projects import `Await` from `@luon/view`. For manually constructed
Views, call `apiView({ ... })` inside `componentView` setup; it also exposes
callable TypeScript types. Raw `export const api` declarations require the View
compiler, and Luon's editor supplies their callable types through `viewTypes`.
Shared stores, server modules, and hooks can continue using `$fetch`/`fetch`.

## Transitions, resources, and cached Views

### Enter and leave transitions

```tsx
export const data = { open: false };
export default () => <>
  <button onClick={() => data.open = !data.open}>Toggle</button>
  {data.open && <aside transition={{ effect: "fade", duration: 180 }}>
    Saved.
  </aside>}
</>;
```

`transition` applies to native elements. `fade` is currently supported;
`duration` defaults to 180 ms and accepts 0..60000 ms. On conditional removal,
View disposes reactive work immediately and retains the visual DOM until the
animation finishes. Leaving elements are inert and hidden from accessibility
APIs. Closing the owner cancels pending animations and removes
its DOM immediately. A newly shown element enters independently of a leaving
one. Reduced-motion preferences disable animation; environments without the
Web Animations API remove elements immediately.

### View-owned asynchronous resources

```tsx
import { Await } from "@luon/view";

export const resource = {
  profile: {
    async load({ signal }: { signal: AbortSignal }) {
      const response = await fetch("/api/profile", { signal });
      if (!response.ok) throw new Error("Profile could not be loaded.");
      return response.json();
    },
  },
};

export default () => <>
  <button onClick={() => resource.profile.reload()}>Refresh</button>
  <Await value={resource.profile} pending={() => <p>Loading…</p>}
    error={(error) => <p>{String(error)}</p>}>
    {(profile) => <h2>{profile.name}</h2>}
  </Await>
</>;
```

The View compiler creates a separate resource per instance. Initial loading
starts on connection. `status` is `pending`, `ready`, or `error`; `value` and
`error` expose the result. `reload()` returns a Promise that settles after the
state update; loading failures are stored in `error`, not rethrown.
Reload aborts the previous signal. Closing the owner aborts in-flight work.
Late results are ignored even when a loader does not honor cancellation.
Previous values are retained while reloading. Dependencies are not automatically
watched: use a View watcher to call `reload()` when request inputs change.
There is no cross-instance request cache. Use `resourceView()` directly in
manual `componentView` setup; `.reload()` belongs to the compiled resource,
not the raw exported configuration object.

### Preserve a View between tab changes

```tsx
import { KeepAlive } from "@luon/view";
import Profile from "./profile";
import Settings from "./settings";

export const data = { tab: "profile" };
export default () => <>
  <button onClick={() => data.tab = "profile"}>Profile</button>
  <button onClick={() => data.tab = "settings"}>Settings</button>
  <KeepAlive cacheKey={data.tab} max={2}>
    {data.tab === "profile" ? <Profile /> : <Settings />}
  </KeepAlive>
</>;
```

The compiler evaluates the single child lazily for each new key. Keys are
strings or finite numbers. `max` is a positive integer, defaults to 2, and
limits the least-recently-used cache. Cached instances retain DOM and local
state. `event.load` runs once; `event.close` runs on eviction or owner closure.
Inactive entries are hidden in wrapper elements and ignore `event.window`,
`event.document`, and View timer callbacks. Intervals resume callbacks when
shown; timeouts that elapse while hidden are skipped, not replayed.
Resources and custom subscriptions continue until eviction. KeepAlive does
not pause arbitrary user code or native WebViews. Do not cache screens whose
background work must stop or whose shared props must be recreated on each tab
switch. Direct callers pass a lazy `children: () => ...` function.

Luon projects provide `Await` and `KeepAlive` automatically. Standalone projects
import them from `@luon/view` and compile `.view.tsx` with `viewPlugin`.

## Luon community

View is Luon's central screen engine. This repository also hosts the
community for the complete Luon product family.

- [Report a bug, request a feature, or get development help](https://github.com/predeve/luon-view/issues/new/choose)
- [Discuss ideas and ask questions](https://github.com/predeve/luon-view/discussions)
- [Sponsor Luon](https://sponsor.luon.dev)
- [Luon website](https://www.luon.dev)
- [Documentation](https://docs.luon.dev)
- [Install CLI and explore developer tools](https://www.luon.dev/tools)
- [Package registry](https://pkg.luon.dev)

Reports can cover View, UI, Act, Rule, Style, CLI, Agent, WebView, Runtime,
Worker, Provider, Core, Hub, Gateway, Package, CDN, Templates, or documentation.
Choose the closest product in the issue form, or select `Multiple products`.

Search existing issues first and include a small reproduction, relevant
versions, operating system, and CPU architecture. Remove credentials,
private URLs, and customer data. Public development help is best-effort.

Report security vulnerabilities through
[private vulnerability reporting](https://github.com/predeve/luon-view/security/advisories/new),
not public issues or discussions.

### Explore the source

- [View](https://github.com/predeve/luon-view): screen language and execution
- [Act](https://github.com/predeve/luon-act): reactive state and DOM updates
- [Style](https://github.com/predeve/luon-style): scoped and reactive styles
- [Rule](https://github.com/predeve/luon-rule): data validation
- [UI](https://github.com/predeve/luon-ui): shared screen components
