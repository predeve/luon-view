import { act, type Read } from "@luon/act";

export type BindOptions = {
  clean?: "number" | "trim";
  multiple?: boolean;
  name?: string;
  tag: string;
  type?: string;
  update?: "change" | "input";
  value?: unknown;
};

type ComponentBind<Value, Name extends string> = {
  [Key in Name]: Read<Value>;
} & {
  [Key in `on${Capitalize<Name>}Change`]: (value: Value) => void;
};

type DefaultBind<Value> = {
  onValueChange: (value: Value) => void;
  value: Read<Value>;
};

type NativeBind<Value> = {
  checked?: boolean;
  onChange?: (event: Event) => void;
  onInput?: (event: Event) => void;
  value?: Value;
};

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function cleanValue(value: unknown, clean?: BindOptions["clean"]) {
  if (clean === "trim" && typeof value === "string") return value.trim();
  if (clean !== "number" || typeof value !== "string") return value;
  const number = Number.parseFloat(value);
  return Number.isNaN(number) ? value : number;
}

function inputValue(event: Event, options: BindOptions) {
  const input = event.currentTarget as HTMLInputElement;
  if (options.type === "number") {
    return input.value === "" ? "" : input.valueAsNumber;
  }
  return cleanValue(input.value, options.clean);
}

export function bindView<Value, Name extends string>(
  read: () => Value,
  write: (value: Value) => void,
  options: BindOptions & { name: Name; tag: "component" },
): ComponentBind<Value, Name>;
export function bindView<Value>(
  read: () => Value,
  write: (value: Value) => void,
  options: BindOptions & { tag: "component" },
): DefaultBind<Value>;
export function bindView<Value>(
  read: () => Value,
  write: (value: Value) => void,
  options: BindOptions,
): NativeBind<Value>;
export function bindView<Value>(
  read: () => Value,
  write: (value: Value) => void,
  options: BindOptions,
) {
  const set = (value: unknown) => {
    write(cleanValue(value, options.clean) as Value);
  };

  if (options.tag === "component") {
    const name = options.name || "value";
    const event = name === "value"
      ? "onValueChange"
      : `on${capitalize(name)}Change`;
    return {
      [name]: act(read),
      [event]: set,
    };
  }

  const current = read();

  if (options.tag === "select") {
    return {
      value: current,
      onChange(event: Event) {
        const select = event.currentTarget as HTMLSelectElement;
        const value = options.multiple
          ? [...select.selectedOptions].map((item) => item.value)
          : select.value;
        set(value);
      },
    };
  }

  if (options.type === "checkbox") {
    const values = Array.isArray(current) ? current : undefined;
    return {
      checked: values ? values.includes(options.value) : Boolean(current),
      onChange(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        if (!values) return set(input.checked);
        const next = values.filter((item) => !Object.is(item, options.value));
        if (input.checked) next.push(options.value);
        set(next);
      },
    };
  }

  if (options.type === "radio") {
    return {
      checked: current === options.value,
      onChange(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        if (input.checked) set(options.value);
      },
    };
  }

  const event = options.update === "input" ? "onInput" : "onChange";
  return {
    value: current,
    [event]: (inputEvent: Event) => set(inputValue(inputEvent, options)),
  };
}
