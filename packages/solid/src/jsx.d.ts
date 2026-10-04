import type { ButtonProps, ColumnProps, RowProps, TextProps } from "./index";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      Column: ColumnProps;
      Row: RowProps;
      Text: TextProps;
      Button: ButtonProps;
    }
  }
}

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      Column: ColumnProps;
      Row: RowProps;
      Text: TextProps;
      Button: ButtonProps;
    }
  }
}

export {};
