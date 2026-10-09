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

### 사실과 추정의 구분

각 소재와 사이즈 값에는 출처(`source`)가 붙고 결과 화면에 표시됩니다.

- 상품 페이지에서 확인: `structured-data`, `meta`, `page`
- AI가 페이지에서 추출하고 페이지의 숫자와 대조: `gemini-extracted`
- 직접 입력: `user-input`, 샘플: `demo`
- 보온성, 촉감 같은 소재 감각과 관리법은 소재별 일반 특성으로 **예상**한 값이며, 상품 페이지의 관리 안내가 있으면 그것을 우선합니다.

Gemini가 상상한 값이 점수에 들어가지 않도록 두 겹으로 막습니다.

1. 프롬프트: 페이지에 없는 값은 `null`, `[]`, `unknown`으로 돌려주도록 지시하고, 페이지 내용은 신뢰할 수 없는 데이터로 취급합니다(프롬프트 인젝션 대비).
2. 코드: 소재 비율과 사이즈 수치는 페이지 텍스트에 실제로 나타날 때만 통과합니다. 없으면 제외하고 경고를 남깁니다. 인치 표기는 cm로 환산하고 알립니다.

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
