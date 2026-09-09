/** @jsxImportSource @luon/view */
import { componentView } from "./view.ts";
import type { Child } from "@luon/act";

export type TitleTab = {
  id: string; label: string; icon?: Child; title?: string;
  disabled?: boolean; closable?: boolean; closeDisabled?: boolean;
  closeTitle?: string;
};
type Props = {
  items: TitleTab[]; selected: string; label?: string;
  class?: string; itemClass?: string;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
};

export const TitleTabs = componentView<Props>("TitleTabs", props => ({
  render: () => <nav class={props.class ?? "luon-title-tabs"}
    aria-label={props.label ?? "Tabs"}
    style={props.class ? undefined
      : { display: "flex", overflowX: "auto", minWidth: 0 }}>
    {props.items.map(item => <div
      class={[props.itemClass ?? "luon-title-tab",
        item.id === props.selected && "selected"]}
      style={props.itemClass ? undefined
        : { display: "flex", flexShrink: 0 }}>
      <button type="button" disabled={item.disabled} title={item.title}
        aria-current={item.id === props.selected ? "page" : undefined}
        onClick={() => props.onSelect(item.id)}
        onKeyDown={(event: KeyboardEvent) => {
          const items = props.items.filter(tab => !tab.disabled);
          const at = items.findIndex(tab => tab.id === item.id);
          const next = event.key === "ArrowRight" ? (at + 1) % items.length
            : event.key === "ArrowLeft" ? (at - 1 + items.length) % items.length
            : event.key === "Home" ? 0
              : event.key === "End" ? items.length - 1 : -1;
          if (next < 0 || !items[next]) return;
          event.preventDefault();
          const node = event.currentTarget as HTMLElement;
          const nav = node.closest("nav");
          const id = items[next]!.id;
          const index = props.items.findIndex(tab => tab.id === id);
          props.onSelect(id);
          queueMicrotask(() => nav?.children[index]
            ?.querySelector<HTMLButtonElement>("button")?.focus());
        }}>{item.icon}<span>{item.label}</span></button>
      {props.onClose && item.closable !== false ? <button type="button"
        aria-label={`Close ${item.label}`} disabled={item.closeDisabled}
        title={item.closeTitle ?? "Close tab"}
        onClick={() => props.onClose?.(item.id)}>×</button> : null}
    </div>)}
  </nav>,
}));
