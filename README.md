# Shopping Assistant

쇼핑 중 발견한 옷의 상품 페이지 URL을 붙여 넣으면 "이 옷, 나한테 맞을까?"에 답해 주는 서비스입니다.
소재, 사이즈, 취향, 관리 난이도를 내 기준(체형, 선호 핏, 쇼핑 성향)으로 판단해 하나의 결과로 보여 줍니다.

로그인 없이 바로 쓸 수 있고, 프로필, 취향, 분석 기록은 브라우저(`localStorage`)에만 저장됩니다.

## 로컬 실행

```bash
npm install
npm run dev
```

`http://localhost:3000`을 엽니다. API 키 없이도 실행되며, 이때는 AI 없이 동작합니다(아래 "동작 모드" 참고).

## Gemini API 연결

상품 페이지는 형식이 제각각이라, 페이지 텍스트를 구조화된 상품 정보로 바꾸는 단계에만 Gemini를 씁니다.
**추천 점수는 Gemini가 만들지 않습니다.** 점수, 소재 평가, 취향 매칭, 사이즈 추천, 관리법은 기존 규칙 기반 코드가 계산합니다.

1. [Google AI Studio](https://aistudio.google.com/apikey)에서 API 키를 발급합니다.
2. `.env.example`을 `.env.local`로 복사하고 값을 채웁니다.

   ```bash
   cp .env.example .env.local
   ```

   | 변수 | 필수 | 설명 |
   | --- | --- | --- |
   | `GEMINI_API_KEY` | 예 (AI를 쓰려면) | 서버에서만 읽습니다. 브라우저 번들, 로그, 에러 응답에 나가지 않습니다. |
   | `GEMINI_MODEL` | 아니오 | 기본값 `gemini-3.5-flash-lite`. 정확도가 더 필요하면 안정(Stable) 모델(예: `gemini-3.8-flash`)로 바꿉니다. |

3. 개발 서버를 다시 시작합니다. 키를 넣는 것 외에 코드 수정은 필요 없습니다.

SDK는 공식 [`@google/genai`](https://github.com/googleapis/js-genai)를 쓰고, 모델에는 JSON Schema 기반 구조화 출력(`responseJsonSchema`)을 요청합니다.
모델 목록과 상태는 [공식 모델 문서](https://ai.google.dev/gemini-api/docs/models)를 확인하세요. 모델 ID는 바뀔 수 있어서 코드가 아니라 환경변수로 둡니다.

### 동작 모드

| 상태 | 동작 |
| --- | --- |
| `GEMINI_API_KEY` 있음 | 페이지에서 읽은 텍스트를 Gemini로 구조화하고, 결과를 페이지 원문과 대조해 검증합니다. |
| 키 없음 | 구조화 데이터(JSON-LD), 메타 태그, 본문 정규식으로 추출합니다. 못 찾은 항목은 경고로 보여 주고, 설명 직접 입력으로 보완할 수 있습니다. |
| Gemini 오류, 한도 초과, 시간 초과 | 앱은 계속 동작합니다. 위 "키 없음"과 같은 결과에 "AI 분석을 쓰지 못했다"는 안내와 직접 입력 버튼이 붙습니다. 내부 오류 문구나 키는 노출하지 않습니다. |
| "샘플로 보기" | 네트워크 없이 샘플 상품(가상 데이터)으로 전체 흐름을 보여 줍니다. |

## 구조

```text
상품 URL
  → POST /api/analyze-url                   (서버)
  → safeFetch: URL 검증, 연결 시점 IP 검증, 리다이렉트 재검증, 크기·시간 제한
  → htmlExtraction: JSON-LD / 메타 / 본문 텍스트 (결정론적 추출)
  → GeminiProductExtractionProvider        (키가 있을 때만)
        구조화 출력(JSON Schema) → zod 검증 → 페이지 원문 대조
  → ProductFacts (각 값에 출처 표시)
  → 소재 평가 · 취향 매칭 · 사이즈 추천 · 관리 안내 · 점수   (브라우저, 규칙 기반)
  → Result
```

주요 위치:

| 경로 | 역할 |
| --- | --- |
| `components/ShoppingApp.tsx` | 화면 전체 (Home, Analyzing, Result, Fit, Preferences, History) |
| `app/api/analyze-url/route.ts` | 분석 API (입력 검증, 스로틀, 중복 요청 합치기) |
| `services/extraction/safeFetch.ts` | SSRF 방어 fetch |
| `services/extraction/geminiProvider.ts`, `geminiSchema.ts` | Gemini 호출, 스키마, 검증, 매핑 |
| `services/extraction/urlExtraction.ts` | 추출 파이프라인과 병합 규칙 |
| `domain/` | 소재, 취향, 사이즈, 점수 규칙 (Gemini와 무관) |
| `repository/localShoppingRepository.ts` | 저장소 추상화 (지금은 `localStorage`) |
| `lib/urlSafety.ts`, `lib/env.ts`, `lib/requestGuard.ts` | URL 안전 규칙, 환경변수 검증, 남용 방어 |

### 취향과 평가 metric

취향은 13개이고, **각 취향은 자기만의 metric 하나로만 평가합니다.** 서로 다른 취향이 같은 값을 쓰지 않아서, 두 개를 골라도 같은 사실이 두 번 계산되지 않습니다(`data/preferences.ts`, 테스트로 고정).

| 분류 | 취향 | metric |
| --- | --- | --- |
| 착용감 | 부드러운 촉감 | `softness` |
| | 가벼운 옷 | `lightweight` |
| 기능 | 보온성 | `warmth` |
| | 통기성 | `breathability` (공기가 통하는 정도) |
| | 땀 배출·속건 | `moistureWicking` (땀을 이동시키고 말리는 정도) |
| | 신축성 | `stretch` |
| 관리 | 세탁이 편함 | `washEase` |
| | 건조기 사용 가능 | `dryerSafe` |
| | 보풀 적음 | `pillingResistance` |
| | 구김 적음 | `wrinkleResistance` |
| 구매 성향 | 오래 입기 | `durability` |
| | 천연 소재 선호 | `naturalFiberRatio` (천연 섬유 비중) |
| | 가성비 | `valueForMoney` (가격 대비 구성, 아래 참고) |

이전 버전에서 합치거나 뺀 항목:

- **까슬거림 싫음 → 부드러운 촉감에 통합.** 둘 다 같은 `softness`로 계산되던 중복이었습니다.
- **품질 우선은 제거.** 브랜드, 봉제, 원단 등급은 상품 페이지만으로 판단할 수 없어서, 다른 항목으로 바꾸지 않고 뺐습니다.
- 통기성과 땀 배출, 세탁과 건조와 구김은 서로 다른 특성이라 각각 독립 metric이 되었습니다. "세탁은 쉬운데 건조기는 안 되는" 옷도 그대로 표현됩니다.

관리 항목은 **제조사 안내가 있으면 그것을 가장 먼저** 따르고(`basis: product_page`, 신뢰도 높음), 없을 때만 소재 특성으로 예상합니다(`material_inference`, 결과 화면에 구분해서 표시).

### 가격과 가성비

가격은 `ProductFacts.pricing`에 `currentPrice`(실제 결제하는 가격), `originalPrice`, `discountRate`, `currency`, 출처, 신뢰도로 들어갑니다. 할인율은 두 가격에서 직접 계산하고, 마케팅 문구는 믿지 않습니다.

추출 우선순위: **JSON-LD Product/Offer → 메타 태그(`product:price:*`, `og:price:*`) → 마이크로데이터 → 본문의 라벨이 붙은 가격(정가, 판매가, 할인가 …) → Gemini.** 본문에서는 통화 표시와 라벨이 모두 있는 숫자만 읽습니다(사이즈, 상품번호, 배송비를 가격으로 읽지 않기 위해서). Gemini가 돌려준 가격도 페이지에 그 숫자와 통화가 실제로 있어야만 인정하고, 없으면 `null`로 둡니다. 가격을 못 찾으면 비워 두고 경고만 남깁니다.

**가성비(`valueForMoney`)는 내구성과 별개로 계산합니다.** "현재 판매가에 비해 소재 구성과 기능이 어느 정도인가"를 보는 값입니다.

1. 상품 종류와 통화별 기준 가격(`data/priceReference.ts`)에 소재 원가 계수(폴리에스터 1 … 캐시미어 6)를 곱해 "비슷한 구성의 참고 가격대"를 만듭니다.
2. 현재 가격 ÷ 참고 가격대로 점수를 매기고, 내구성과 보풀 저항으로 ±5점만 보정합니다. 할인율은 점수를 올리지 않습니다(정가가 부풀려졌을 수 있어서).
3. 시장 전체 가격 데이터는 없으므로 결과는 "참고 추정"입니다. 신뢰도는 최대 `medium`이고, 화면에는 "브랜드, 봉제 완성도, 원단 등급은 반영하지 못했다"는 안내가 항상 붙습니다.
4. 가격, 소재, 상품 종류, 지원 통화 중 하나라도 없으면 "판단 어려움"이고 점수를 만들지 않습니다.

기준 가격표는 의도적으로 거칠고 고치기 쉬운 상수입니다. KRW와 USD만 지원하며, 다른 통화는 판단하지 않습니다.

### 정보가 부족할 때

- 판단할 수 없는 metric은 `available: false`입니다. 가짜 중간 점수를 넣지 않습니다.
- 취향 점수는 판단 가능한 항목만의 가중 평균이고, 판단 불가 항목은 분자와 분모에서 모두 빠집니다. 선택한 취향이 전부 판단 불가면 취향 점수는 `null`이고, 전체 궁합 점수는 남은 구성요소로만 계산합니다. 소재와 관리도 같은 방식입니다.
- 소재 정보가 일부만 있으면 신뢰도가 `low`가 되고 취향 점수에서 0.6배로 반영됩니다. 소재 특성으로 예상한 값은 신뢰도가 `medium`을 넘지 않습니다.
- 가격은 사용자가 가성비를 선택했을 때만 궁합 점수에 들어옵니다. 선택하지 않았다면 가격이 달라도 점수는 같습니다(테스트로 고정).
- 결과 화면은 선택한 기준마다 ✓ 잘 맞아요, △ 보통이에요, ✕ 아쉬워요, ? 정보가 부족해요로 보여 줍니다.

### 저장된 취향 마이그레이션

저장소는 스키마 버전(`shopping-assistant:schema`, 현재 2)을 갖습니다. 이전 버전에서 저장된 취향은 처음 읽을 때 한 번만 변환됩니다.

- 부드러운 촉감과 까슬거림 싫음 중 하나 또는 둘 다 선택돼 있으면 **부드러운 촉감 하나**가 됩니다. 두 항목이 모두 있으면 가중치는 합이 아니라 큰 쪽을 씁니다(두 배가 되지 않도록).
- 품질 우선은 삭제되고 다른 항목으로 바뀌지 않습니다.
- 프로필과 분석 기록은 건드리지 않습니다. 이전 기록은 저장된 그대로 열립니다.

### 사실과 추정의 구분

각 소재와 사이즈 값에는 출처(`source`)가 붙고 결과 화면에 표시됩니다.

- 상품 페이지에서 확인: `structured-data`, `meta`, `page`
- AI가 페이지에서 추출하고 페이지의 숫자와 대조: `gemini-extracted`
- 직접 입력: `user-input`, 샘플: `demo`
- 보온성, 촉감 같은 소재 감각과 관리법은 소재별 일반 특성으로 **예상**한 값이며, 상품 페이지의 관리 안내가 있으면 그것을 우선합니다.

Gemini가 상상한 값이 점수에 들어가지 않도록 두 겹으로 막습니다.

1. 프롬프트: 페이지에 없는 값은 `null`, `[]`, `unknown`으로 돌려주도록 지시하고, 페이지 내용은 신뢰할 수 없는 데이터로 취급합니다(프롬프트 인젝션 대비).
2. 코드: 소재 비율과 사이즈 수치는 페이지 텍스트에 실제로 나타날 때만 통과합니다. 없으면 제외하고 경고를 남깁니다. 인치 표기는 cm로 환산하고 알립니다.

## 모션과 인터랙션

의존성을 더하지 않고 CSS와 작은 훅으로 만들었습니다(`app/motion.css`, `components/motion/`, `lib/motion.ts`). 효과의 수가 아니라 일관성을 기준으로 삼았습니다.

- **모션 토큰**: 시간은 `fast 160ms`(누름, hover), `standard 280ms`(토글, 아코디언), `slow 480ms`(섹션·화면 전환), `cinematic 1100ms`(Home 인트로 한정) 네 가지, 곡선도 이름이 붙은 네 가지만 씁니다.
- **GPU 친화**: 계속 움직이는 속성은 `transform`과 `opacity`뿐입니다. 포인터 값은 rAF로 한 프레임에 한 번만 CSS 변수로 내보냅니다.
- **화면별 연출**
  - Home: 확대 상태에서 자리잡는 인트로, 마우스에 반응하는 몇 픽셀의 시차, 천천히 움직이는 빛, 아주 약한 마그네틱 CTA.
  - Home → Analyzing: 누른 버튼에서 화면이 번지는 전환 뒤 Analyzing이 드러납니다. 분석은 그 전에 이미 시작돼 있고, 진행 레일은 실제 진행 상태를 따라갑니다.
  - Preferences: 포인터 위치 조명, 절제된 3D 기울기, 테두리를 따라 도는 빛, 선택 시 따뜻한 라임·크림 톤 오로라(선택·hover 상태에서만 켜짐).
  - Result: 스크롤 위치(IntersectionObserver)에 따라 왼쪽 비주얼이 MATCH → 사이즈 → 소재 → 취향 → 관리로 바뀝니다. 스크롤을 가로채거나 스냅하지 않습니다.
  - History: 3D Coverflow. 네이티브 스크롤과 scroll-snap 위에 위치만 CSS 변수로 얹었고, 버튼과 방향키로도 이동합니다.
  - 상품을 열면 View Transitions로 상품 비주얼이 다음 화면으로 이어집니다(미지원 브라우저는 그냥 전환).
- **접근성**: hover는 `(hover: hover) and (pointer: fine)`에서만 동작해 터치 기기에서 고착되지 않고, `prefers-reduced-motion`에서는 움직임이 빠지되 상태 변화는 그대로 보입니다.

## 보안

- API 키는 서버 코드에서만 읽고, 클라이언트 컴포넌트는 `lib/env.ts`를 import하지 않습니다.
- `.env.local`은 `.gitignore`에 포함되어 있습니다. `.env.example`에는 빈 값만 있습니다.
- URL 분석은 SSRF 방어를 적용합니다.
  - `http`/`https`만 허용, 기본 포트(80/443)만 허용, 계정 정보(`user:pw@`)와 2048자 초과 URL 차단
  - `localhost`, `*.local`, `*.internal`, 단일 라벨 호스트, 사설/루프백/링크로컬/CGNAT/메타데이터(`169.254.169.254`)/예약 대역 차단 (IPv4, IPv6, IPv4-mapped, NAT64, 6to4 포함)
  - DNS 조회 결과를 **연결 시점에** 검증하고(DNS rebinding 방어), 리다이렉트는 최대 4번까지 매번 다시 검증
  - 응답 시간 8초, 압축 해제 후 1.5MB 제한, HTML Content-Type만 허용
- API는 JSON만 받고 본문 크기를 제한하며, 응답은 `no-store`입니다.

## 남용 방지와 한계

로그인이 없는 공개 API라 Gemini 호출 비용이 남용될 수 있습니다. 현재는 다음만 적용돼 있습니다.

- 입력 검증, 본문 크기 제한, 타임아웃, 서버 전용 API 키
- 같은 URL의 동시 요청 합치기, 화면의 중복 분석 방지
- 클라이언트별 분당 12회 제한

**마지막 항목은 보안 장치가 아닙니다.** 서버리스 인스턴스마다 메모리가 따로이고 인스턴스가 자주 바뀌므로, 한 인스턴스의 짧은 폭주만 완화합니다. 의도적인 우회는 막지 못합니다.
트래픽이 늘면 영구 저장소 기반 제한이 필요합니다(Vercel WAF의 Rate Limiting, Upstash Redis 등). 그 전까지는 Google AI Studio에서 키의 일일 한도와 예산 알림을 설정해 두세요.

## 배포 (GitHub, Vercel)

1. GitHub 저장소: <https://github.com/chltmdgh1028-svg/AI-Shopping-Assistant> (`main` 브랜치)
2. Vercel에서 저장소를 Import합니다. Framework는 Next.js로 자동 인식되며 별도 설정이 필요 없습니다.
3. **Project → Settings → Environment Variables**에서 `GEMINI_API_KEY`를 추가합니다. `GEMINI_MODEL`은 선택입니다. Production(필요하면 Preview도)에 적용합니다.
4. 환경변수는 새 배포에만 적용됩니다. 값을 추가한 뒤 **Redeploy** 하세요.

키를 추가하기 전에도 배포는 정상 동작하고(AI 없이), 추가 후 재배포하면 Gemini 분석이 켜집니다.

## 테스트와 검증

```bash
npm test          # 단위, 통합 테스트
npm run lint
npm run typecheck
npm run build
```

테스트는 규칙 기반 도메인(소재, 취향, 사이즈, 점수), URL 안전 규칙, 로컬 HTTP 서버를 쓰는 fetch 동작(리다이렉트, 압축, EUC-KR, 크기·시간 제한), Gemini 스키마·검증·오류 처리(SDK는 모킹), 추출 파이프라인의 대체 동작, API 라우트의 입력 제한을 다룹니다.
실제 Gemini 호출은 자동 테스트에 포함되지 않습니다(키와 요금이 필요). 키를 넣은 뒤 개발 서버에서 상품 URL을 분석해 확인하세요.

## 현재 제한사항

- 자바스크립트로 그려지는 쇼핑몰(상품 정보를 클라이언트에서 렌더링)은 서버가 받는 HTML에 정보가 없을 수 있습니다. 이 경우 "설명 직접 입력"으로 보완합니다. 브라우저 렌더링 단계는 아직 없습니다.
- 일부 쇼핑몰은 자동 요청을 차단합니다. 쇼핑몰의 이용약관과 robots 정책은 별도로 확인해야 합니다.
- 사이즈 추천은 상품 사이즈표와 입력한 체형에 기반한 추정이며, 사이즈표를 못 읽으면 신뢰도를 낮게 표시합니다.
- Gemini 모델은 안정 라인이라도 시간이 지나면 교체됩니다. `GEMINI_MODEL`로 바꿀 수 있습니다.
- 프로필, 취향, 기록은 기기와 브라우저마다 따로 저장됩니다.

## 앞으로의 계획

- 인증(로그인)과 기기 간 동기화: `repository/localShoppingRepository.ts`와 같은 인터페이스로 Supabase/Postgres 구현을 추가합니다. 화면 코드는 저장소 구현을 모릅니다.
- 영구 저장소 기반 레이트 리미팅과 사용자별 한도
- 주요 쇼핑몰 전용 파서, JS 렌더링이 필요한 페이지 대응
- 상품 비교
