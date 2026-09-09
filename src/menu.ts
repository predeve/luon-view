import { currentLife } from "./life.ts";

type Action = () => unknown;
type Menu = Record<string, Record<string, Action | { action: Action }>>;
type Entry = { file: string; menu: Menu };
const key = Symbol.for("luon.view.menus");
const scope = globalThis as typeof globalThis & Record<symbol, unknown>;
const entries = (scope[key] ||= new Set<Entry>()) as Set<Entry>;

export function menuView(file: string, menu: Menu) {
  const life = currentLife();
  if (!life || life.closed) return;
  const entry = { file: file.replaceAll("\\", "/"), menu };
  life.load.push(() => entries.add(entry));
  life.close.push(() => entries.delete(entry));
}

export function viewMenus(file: string) {
  return [...entries].filter(entry => entry.file === file
    || entry.file === `app/${file}`
    || entry.file.endsWith(`/app/${file}`)).map(entry => entry.menu);
}
