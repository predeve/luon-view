export type Transition = {
  effect: "fade";
  duration?: number;
};
const leaveKey = Symbol.for("@luon/act/leave");

export function transitionView(node: Element, rule: Transition) {
  const duration = rule.duration ?? 180;
  if (rule.effect !== "fade" || !Number.isFinite(duration)
    || duration < 0 || duration > 60_000) {
    throw new TypeError("Transition requires fade and duration 0..60000 ms.");
  }
  let animation: Animation | undefined;
  let leaving = false;
  const cancel = () => { animation?.cancel(); animation = undefined; };
  const play = async (out: boolean) => {
    const from = getComputedStyle(node).opacity || "1";
    cancel();
    if (!node.animate || !duration
      || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    animation = node.animate(
      [{ opacity: out ? from : 0 }, { opacity: out ? 0 : from }],
      { duration, easing: "ease", fill: "both" },
    );
    const current = animation;
    await current.finished.catch(() => undefined);
    if (animation === current) cancel();
  };
  Reflect.set(node, leaveKey, {
    cancel,
    leave() {
      leaving = true;
      node.setAttribute("aria-hidden", "true");
      if ("inert" in node) (node as HTMLElement).inert = true;
      return play(true);
    },
  });
  queueMicrotask(() => {
    if (!leaving && node.isConnected) void play(false);
  });
}
