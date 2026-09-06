# @luon/view

Part of [Luon](https://www.luon.dev) — Luon View compiler and Act runtime.

[Package guide](https://pkg.luon.dev/packages/view/) ·
[Source](https://github.com/predeve/luon-view) ·
[Developer tools](https://www.luon.dev/tools)

## Install

```bash
bun add @luon/view --registry https://pkg.luon.dev
```

## Who it is for

Luon Site authors and tools compiling the public TSX View language.

## Core concepts

### Reserved module exports

data, computed, watch, event, style, deepStyle, and default form one View definition that the compiler connects to Act.

### Plain reactive state

Objects and arrays are mutated directly. Each mounted View receives its own data instance unless state is intentionally created in module scope.

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

### Lifecycle cleanup

Pair every external listener or subscription with event.close.

```tsx
const resize = () => console.log(innerWidth);

export const event = {
  load() {
    window.addEventListener("resize", resize);
  },
  close() {
    window.removeEventListener("resize", resize);
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
watch, and lifecycle rejections. File metadata identifies the View definition,
not a mapped failing statement. Multiple cleanup errors use `AggregateError`.
