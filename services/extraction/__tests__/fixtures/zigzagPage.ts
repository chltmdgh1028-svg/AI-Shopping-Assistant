type Options = {
  name?: string;
  currentPrice?: number | null;
  listPrice?: number | null;
  couponPrice?: number | null;
  detailHtml?: string;
  withNextData?: boolean;
  /** The collapsed "상품정보 제공고시" list. */
  essentials?: Array<{ name: string; value: string }>;
  /** Extra <img> tags appended to the seller's description. */
  images?: string[];
};

// The seller's detail text of a real Zigzag listing (October 2026), reduced to the lines the app reads. The blend and
// the size are printed as text; the care line is only a link to a guide.
export const realisticDetailHtml = [
  '<div class="edibot-product-detail"><style>.x{color:red}</style>',
  "<div><span>MD COMMENT</span></div>",
  "<div><span>부드럽고 포근한 터치감의 니트 소재에 쫀쫀한 신축성이 더해졌어요</span></div>",
  "<div><span>Fabric Check 🧵</span></div>",
  "<div><span>cotton 50% polyester 29% pbt 21%</span></div>",
  "<div><span>PRODUCT INFO</span></div>",
  "<div><span>COLOR 아이보리,레드,그레이,네이비</span></div>",
  "<div><span>SIZE</span></div>",
  "<div><span>어깨34 가슴43.5 암홀20</span></div>",
  "<div><span>소매총장56 총장49</span></div>",
  "<div><span>소재별 세탁 가이드 바로가기 ↓</span></div>",
  "<div><span>https://shop.example.com/article/notice/1/4/</span></div>",
  "</div>",
].join("\n");

export function zigzagPage({
  name = "[가을신상/기획특가!] 베니즈 브이넥 베이직 긴팔 니트 가디건",
  currentPrice = 29900,
  listPrice = 39900,
  couponPrice = 20930,
  detailHtml = realisticDetailHtml,
  withNextData = true,
  essentials = [],
  images = [],
}: Options = {}) {
  const product = {
    id: "172008665",
    name,
    category_list: [{ category_id: 4056, value: "여성 패션의류" }],
    product_image_list: [
      {
        id: "1",
        url: "https://cf.product-image.s.zigzag.kr/original/a.gif",
        pdp_static_image_url: "https://cf.product-image.s.zigzag.kr/original/a.gif?width=720&height=720&quality=80&format=jpeg",
      },
    ],
    product_price: {
      store_discount_info: currentPrice === null ? null : { discount_price: currentPrice, discount_rate: 25 },
      final_discount_info: couponPrice === null ? null : { discount_price: couponPrice, discount_rate: 48 },
      max_price_info: listPrice === null ? null : { price: listPrice },
      display_final_price: currentPrice === null ? null : { final_price: { price: currentPrice } },
    },
    essentials,
    description: detailHtml + images.map((src) => `<div><img src="${src}"></div>`).join(""),
  };
  const nextData = {
    runtimeConfig: { config: { apiConsumerBaseUrl: "https://api.zigzag.kr/api/2" } },
    props: {
      pageProps: {
        dehydratedState: {
          queries: [
            { queryKey: ["getPdpBaseInfo", "172008665"], state: { data: { shop: { name: "베러뮤즈" }, product } } },
            { queryKey: ["getUserName"], state: { data: { user_account: null } } },
          ],
        },
      },
    },
  };
  const ld = { "@context": "https://schema.org", "@type": "Product", name: `베러뮤즈 ${name}`, brand: { "@type": "Brand", name: "베러뮤즈" }, image: ["https://cf.product-image.s.zigzag.kr/original/a.gif"] };
  return [
    '<!DOCTYPE html><html lang="ko"><head>',
    `<title>${name}</title>`,
    `<meta property="og:title" content="${name}"/><meta property="og:image" content="https://cf.product-image.s.zigzag.kr/original/a.gif"/>`,
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
    "</head><body><div id=\"__next\"><span>지그재그 앱에서 보기</span></div>",
    withNextData ? `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>` : "",
    "</body></html>",
  ].join("");
}
