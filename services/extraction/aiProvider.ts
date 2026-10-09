import type { ProductFacts } from "@/types/shopping";

export type PageExtractionInput = {
  url: string;
  title?: string;
  metaDescription?: string;
  pageText: string;
  structuredProduct?: Partial<ProductFacts>;
};

export type ProductExtractionProvider = {
  extract(input: PageExtractionInput): Promise<Partial<ProductFacts>>;
  isAvailable(): boolean;
  providerName: "unavailable" | "mock" | "configured";
};

export class UnavailableProductExtractionProvider implements ProductExtractionProvider {
  providerName = "unavailable" as const;

  isAvailable() {
    return false;
  }

  async extract(): Promise<Partial<ProductFacts>> {
    return {};
  }
}
