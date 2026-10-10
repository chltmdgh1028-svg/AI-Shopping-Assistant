import type { ProductFacts } from "@/types/shopping";

/** What a site-specific reader found in a page's own data, before any model is involved. */
export type ProductAdapterResult = {
  adapter: "zigzag";
  product: Partial<ProductFacts>;
  /** The page's real content (not visible HTML text), handed to the model as extra evidence. */
  text: string;
  warnings: string[];
};
