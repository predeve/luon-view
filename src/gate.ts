export type Gate = { active: boolean; parent?: Gate };
let current: Gate | undefined;
export const currentGate = () => current;
export function withGate<Value>(gate: Gate | undefined, run: () => Value) {
  const before = current;
  current = gate;
  try { return run(); } finally { current = before; }
}
export function visibleGate(gate?: Gate): boolean {
  return !gate || (gate.active && visibleGate(gate.parent));
}
