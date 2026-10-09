import { describe, expect, it } from "vitest";
import { extractJsonLdProducts, extractProductFromHtml } from "@/services/extraction/htmlExtraction";

const html = `
  <html>
    <head>
      <title>Fallback title</title>
      <meta property="og:image" content="https://cdn.example.com/coat.jpg" />
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Wool blend coat",
          "brand": { "@type": "Brand", "name": "North Atelier" },
          "description": "Wool 70% Nylon 30%",
          "image": ["https://cdn.example.com/product.jpg"],
          "offers": { "@type": "Offer", "price": "129000", "priceCurrency": "KRW" }
        }
      </script>
    </head>
    <body>
      <h1>Wool blend coat</h1>
      <p>M 어깨 48 가슴 112 총장 72</p>
      <p>세탁: 드라이클리닝 권장</p>
    </body>
  </html>
`;

describe("html extraction", () => {
  it("extracts JSON-LD Product nodes", () => {
    const products = extractJsonLdProducts(html);

    expect(products).toHaveLength(1);
    expect(products[0].name).toBe("Wool blend coat");
  });

  it("maps structured and visible data into a normalized product", () => {
    const product = extractProductFromHtml(html, "https://shop.example.com/products/coat");

    expect(product.productName).toBe("Wool blend coat");
    expect(product.brand).toBe("North Atelier");
    expect(product.currency).toBe("KRW");
    expect(product.materials[0]).toMatchObject({ name: "Wool", percentage: 70, source: "structured-data" });
    expect(product.extractionMetadata?.strategy).toContain("json-ld");
  });

  it("keeps missing material and size fields empty instead of inventing them", () => {
    const product = extractProductFromHtml("<html><head><title>Plain product</title></head><body>No fabric chart.</body></html>", "https://shop.example.com/plain");

    expect(product.productName).toBe("Plain product");
    expect(product.materials).toHaveLength(0);
    expect(product.sizes).toHaveLength(0);
    expect(product.extractionMetadata?.warnings.join(" ")).toContain("소재");
  });
});
