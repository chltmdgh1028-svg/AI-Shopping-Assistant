import { demoProduct } from "@/data/demoProduct";
import type { ProductFacts, ProductInput } from "@/types/shopping";

export type ProductParser = {
  parse(input: ProductInput): Promise<ProductFacts>;
};

export class MockProductParser implements ProductParser {
  async parse(input: ProductInput): Promise<ProductFacts> {
    await new Promise((resolve) => setTimeout(resolve, 450));

    if (input.url?.includes("demo") || !input.manualText) {
      return {
        ...demoProduct,
        sourceUrl: input.url || demoProduct.sourceUrl,
      };
    }

    return parseManualText(input.manualText, input.url);
  }
}

function parseManualText(manualText: string, sourceUrl?: string): ProductFacts {
  const lower = manualText.toLowerCase();
  const materials = [
    ["Wool", /(?:wool|울)\s*(\d{1,3})\s*%/i],
    ["Nylon", /(?:nylon|나일론)\s*(\d{1,3})\s*%/i],
    ["Acrylic", /(?:acrylic|아크릴)\s*(\d{1,3})\s*%/i],
    ["Cotton", /(?:cotton|면|코튼)\s*(\d{1,3})\s*%/i],
    ["Polyester", /(?:polyester|폴리에스터)\s*(\d{1,3})\s*%/i],
    ["Cashmere", /(?:cashmere|캐시미어)\s*(\d{1,3})\s*%/i],
  ].flatMap(([name, pattern]) => {
    const match = manualText.match(pattern as RegExp);
    return match ? [{ name: name as string, percentage: Number(match[1]) }] : [];
  });

  const category = lower.includes("knit") || manualText.includes("니트") ? "knitwear" : "unknown";

  return {
    productName: manualText.split("\n").find(Boolean)?.slice(0, 42) || "직접 입력한 상품",
    brand: undefined,
    category,
    price: manualText.match(/[\d,]+원/)?.[0],
    images: demoProduct.images,
    description: manualText,
    materials,
    sizes: extractSizes(manualText),
    fit: lower.includes("oversized") || manualText.includes("오버") ? "oversized" : undefined,
    careInstructions: manualText
      .split("\n")
      .filter((line) => /세탁|건조|드라이|wash|dry/i.test(line))
      .slice(0, 4),
    sourceUrl,
    factsSource: "manual_input",
  };
}

function extractSizes(text: string) {
  const sizeRows = text.matchAll(/(M|L|XL|S)\s*[:-]?\s*(?:어깨\s*)?(\d{2,3}).*?(?:가슴|chest)\s*(\d{2,3}).*?(?:총장|length)\s*(\d{2,3})/gi);
  return Array.from(sizeRows).map((match) => ({
    name: match[1].toUpperCase(),
    shoulder: Number(match[2]),
    chest: Number(match[3]),
    length: Number(match[4]),
  }));
}
