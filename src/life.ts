export type ViewLife = {
  close: Array<() => void>;
  load: Array<() => void>;
};

let active: ViewLife | undefined;

export function withLife<Value>(life: ViewLife, run: () => Value) {
  const previous = active;
  active = life;
  try {
    return run();
  } finally {
    active = previous;
  }
}

export function addLife(name: keyof ViewLife, run: () => void) {
  if (!active) {
    throw new Error(`Luon ${name} must be registered inside a View.`);
  }
  active[name].push(run);
}
