export type ViewSource = {
  file?: string;
};
export type ViewFrame = ViewSource & {
  view: string;
  phase: string;
};

export class ViewError extends Error {
  readonly frames: ViewFrame[];

  constructor(cause: unknown, frame: ViewFrame) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`[Luon ${frame.view} · ${frame.phase}]`
      + `${frame.file ? ` ${frame.file}` : ""}\n${detail}`, { cause });
    this.name = "ViewError";
    this.frames = [frame,
      ...(cause instanceof ViewError ? cause.frames : [])];
  }
}

export function traceView<Value>(
  frame: ViewFrame, run: () => Value,
): Value {
  try {
    return run();
  } catch (cause) {
    if (cause instanceof ViewError && cause.frames.some((entry) => (
      entry.view === frame.view && entry.file === frame.file
        && entry.phase === frame.phase
    ))) throw cause;
    throw new ViewError(cause, frame);
  }
}
