import { extractZigzagProduct } from "@/services/extraction/adapters/zigzagAdapter";
import type { ProductAdapterResult } from "@/services/extraction/adapters/types";

export type { ProductAdapterResult } from "@/services/extraction/adapters/types";

const zigzagHosts = new Set(["zigzag.kr", "www.zigzag.kr", "store.zigzag.kr"]);

/** A site-specific reader for pages whose product data lives in script JSON. Other sites go through the generic path. */
export function extractWithAdapter(html: string, pageUrl: string): ProductAdapterResult | undefined {
  let host: string;
  try {
    host = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return zigzagHosts.has(host) ? extractZigzagProduct(html) : undefined;
}
