import {
  styleState as createStyleState,
  type StyleMap,
  type StyleState,
} from "@luon/style";
import { addLife } from "./life.ts";
import { refreshViews } from "./store.ts";

export type { StyleState } from "@luon/style";

export function styleState<Styles extends StyleMap>(
  factory: () => Styles,
  sourceId = "",
  isolated = false,
): StyleState<Styles> {
  return createStyleState(factory, {
    isolated,
    notify: refreshViews,
    onClose: (run) => addLife("close", run),
    sourceId,
  });
}
