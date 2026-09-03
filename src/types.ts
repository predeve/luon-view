import type { Child } from "@luon/act";

export type View = Child;

export type ViewProps = Record<string, unknown>;

export type ViewScope<Props extends ViewProps = ViewProps> = {
  close?: () => void;
  load?: () => void;
  render: (props: Props) => Child;
};
