import { currentLife } from "./life.ts";

export type TitleBar = { enabled: boolean };
type Host = { setTitlebar?: (enabled: boolean) => Promise<unknown> };
type Owner = { enabled: boolean };
const hosts = new WeakMap<Host, { owners: Owner[]; queue: Promise<unknown> }>();

// A mounted child may override a layout; closing it restores the layout.
export function titleBarView(config: TitleBar) {
  if (!config || typeof config.enabled !== "boolean") {
    throw Error("titleBar.enabled must be a boolean.");
  }
  const life = currentLife();
  if (!life || life.closed) return;
  let host: Host | undefined;
  const owner = { enabled: config.enabled };
  const apply = () => {
    if (!host) return;
    const state = hosts.get(host)!;
    const enabled = state.owners.at(-1)?.enabled ?? false;
    state.queue = state.queue.catch(() => {}).then(() =>
      host!.setTitlebar?.(enabled)).catch(error => {
        console.error("Unable to update titlebar.", error);
      });
  };
  life.load.push(() => {
    host = typeof window === "undefined" ? undefined
      : (window as Window & { luon?: Host }).luon;
    if (!host?.setTitlebar) return;
    if (!hosts.has(host)) hosts.set(host, { owners: [], queue: Promise.resolve() });
    hosts.get(host)!.owners.push(owner);
    apply();
  });
  life.close.push(() => {
    if (!host || !hosts.has(host)) return;
    const state = hosts.get(host)!;
    const index = state.owners.indexOf(owner);
    if (index < 0) return;
    state.owners.splice(index, 1);
    apply();
  });
}
