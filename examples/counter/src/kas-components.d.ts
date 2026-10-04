import type { JSX } from "solid-js";

declare global {
  const Column: (props: Record<string, unknown>) => JSX.Element;
  const Row: (props: Record<string, unknown>) => JSX.Element;
  const Button: (props: Record<string, unknown>) => JSX.Element;
  function Text(props: Record<string, unknown>): JSX.Element;
}

export {};
