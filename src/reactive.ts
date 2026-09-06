import { act, effect, memo, type Memo, type Read } from "@luon/act";
import { currentLife, runLife } from "./life.ts";

/** Owned subscriptions are released with the current setup/render scope. */
export function effectView(run: () => void) {
  const life = currentLife();
  const stop = effect(life ? () => runLife(life, "effect", run) : run);
  if (life && !life.closed) life.close.push(stop);
  return stop;
}

export function liveView<Value>(read: () => Value): Read<Value> {
  const life = currentLife();
  return act(life ? () => runLife(life, "update", read) : read);
}

export function memoView<Value>(read: () => Value): Memo<Value> {
  const life = currentLife();
  const value = memo(life ? () => runLife(life, "computed", read) : read);
  if (life && !life.closed) life.close.push(() => value.dispose?.());
  return value;
}
