import type { JsonPoster } from "@/services/extraction/adapters/zigzagDetailApi";
import type { DetailField, DetailSource, ProductFacts } from "@/types/shopping";

/** What one extraction stage added, for the metadata trail. */
export type StageRecord = { source: DetailSource; fields: DetailField[] };

/** A second stage that asks the site's own API for what the page left out. */
export type AdapterEnrichment = {
  product: Partial<ProductFacts>;
  warnings: string[];
  stage: StageRecord;
};

/** What a site-specific reader found in a page's own data, before any model is involved. */
export type ProductAdapterResult = {
  adapter: "zigzag";
  product: Partial<ProductFacts>;
  /** The page's real content (not visible HTML text), handed to the model as extra evidence. */
  text: string;
  warnings: string[];
  /** Detail-page image URLs, in page order, for the vision fallback when text had no blend or size table. */
  detailImageUrls: string[];
  /** What this first stage (the page's own serialized data) contributed. */
  stage: StageRecord;
  /** Reads what the page does not carry (a tab that loads on click) from the site's own API. */
  enrich?: (post: JsonPoster) => Promise<AdapterEnrichment | undefined>;
};
