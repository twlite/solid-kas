import type { ButtonProps, ColumnProps, TextProps } from "./index";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      Column: ColumnProps;
      Text: TextProps;
      Button: ButtonProps;
    }
  }
}

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      Column: ColumnProps;
      Text: TextProps;
      Button: ButtonProps;
    }
  }
}

export {};
