"use client";

import { AlertCircle, Archive, Check, CircleHelp, Heart, Ruler, ShieldCheck, Shirt, Triangle, WashingMachine, Wind, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Mask, ProductVisual } from "@/components/common";
import { Reveal } from "@/components/motion/Reveal";
import { RollingNumber } from "@/components/motion/RollingNumber";
import { traitToLabel } from "@/domain/materialEvaluation";
import { formatPrice } from "@/domain/pricing";
import type { AnalysisResult, MetricBasis, PreferenceMatch, ValueEvaluation } from "@/types/shopping";

// The left visual follows the section being read. Order matches the page, top to bottom.
type Story = "match" | "size" | "material" | "preference" | "care";

export function ResultStage({
  result,
  onEditProfile,
  onEditPreferences,
  onManualInput,
}: {
  result: AnalysisResult;
  onEditProfile: () => void;
  onEditPreferences: () => void;
  onManualInput: () => void;
}) {
  const articleRef = useRef<HTMLElement>(null);
  const [story, setStory] = useState<Story>("match");
  const insights = buildTopInsights(result);
  const notice = extractionNotice(result);
  const hasMaterials = result.material.materialNotes.length > 0;
  const valueMatch = result.preferenceMatches.find((match) => match.metric === "valueForMoney");
  const counts = countRatings(result.preferenceMatches);
  const pricing = result.product.pricing;

  // Native scrolling stays untouched. A section crossing the middle of the viewport just tells the
  // sticky visual which layer to show.
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setStory((entry.target as HTMLElement).dataset.story as Story);
        }
      },
      { rootMargin: "-35% 0px -55% 0px" },
    );
    root.querySelectorAll("[data-story]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const materialTakeaways = [
    { label: "Warmth", value: traitToLabel(result.material.traits.warmth), icon: Shirt },
    { label: "Touch", value: traitToLabel(result.material.traits.softness), icon: Heart },
    { label: "Care", value: traitToLabel(result.material.traits.careEase), icon: WashingMachine },
    { label: "Pilling", value: traitToLabel(result.material.traits.pillingRisk, true), icon: ShieldCheck },
  ];

  return (
    <article className="result-stage" ref={articleRef}>
      <section className="result-hero">
        <div className="result-media" aria-hidden="true">
          <ProductVisual key={result.product.images[0] ?? "none"} src={result.product.images[0]} eager />
        </div>
        <div className="result-scrim" />

        <div className="story-layer" data-layer="match" data-on={story === "match"} aria-hidden={story !== "match"}>
          <div className="result-score">
            <RollingNumber text={String(result.score.total)} className="score-number" />
            <strong>MATCH</strong>
          </div>
          <div className="result-title">
            <Mask as="p">{result.product.brand ?? "브랜드 미확인"}</Mask>
            <Mask as="h1" index={1}>
              {verdictCopy(result.score.verdict)}
            </Mask>
            <Mask as="p" index={2} className="result-summary">
              {result.score.summary}
            </Mask>
          </div>
        </div>

        <div className="story-layer" data-layer="size" data-on={story === "size"} aria-hidden={story !== "size"}>
          <div className="story-panel">
            <p className="story-kicker">추천 사이즈</p>
            <p className="story-big">{result.size.recommendedSize ?? "?"}</p>
            <p className="story-line">신뢰도 {confidenceLabel(result.size.confidence)}</p>
            {result.size.alternatives.length > 0 && (
              <div className="story-chips">
                {result.size.alternatives.map((size) => (
                  <span key={size}>대안 {size}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="story-layer" data-layer="material" data-on={story === "material"} aria-hidden={story !== "material"}>
          <div className="story-panel">
            <p className="story-kicker">소재 구성</p>
            {hasMaterials ? (
              <ul className="story-bars">
                {result.material.materialNotes.map((note, index) => (
                  <li key={note.name} style={{ "--w": note.percentage / 100, "--i": index } as CSSProperties}>
                    <span>{note.name}</span>
                    <RollingNumber text={String(note.percentage)} />
                    <i className="bar-track">
                      <b className="bar-fill" />
                    </i>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="story-line">소재 정보를 확인하지 못했어요.</p>
            )}
          </div>
        </div>

        <div className="story-layer" data-layer="preference" data-on={story === "preference"} aria-hidden={story !== "preference"}>
          <div className="story-panel">
            <p className="story-kicker">선택한 기준과의 거리</p>
            {result.preferenceMatches.length === 0 ? (
              <p className="story-line">선택한 취향이 없어요.</p>
            ) : (
              <>
                <ul className="story-signals">
                  {result.preferenceMatches.map((match, index) => (
                    <li key={match.preferenceId} data-state={ratingState(match)} style={{ "--i": index } as CSSProperties}>
                      <RatingMark state={ratingState(match)} />
                      <span>{match.label}</span>
                    </li>
                  ))}
                </ul>
                <p className="story-line">{signalSummary(counts)}</p>
              </>
            )}
          </div>
        </div>

        <div className="story-layer" data-layer="care" data-on={story === "care"} aria-hidden={story !== "care"}>
          <div className="story-panel">
            <p className="story-kicker">{result.care.source === "product_page" ? "제조사 안내" : "소재로 예상한 관리"}</p>
            <ul className="story-care">
              <li style={{ "--i": 0 } as CSSProperties}>
                <WashingMachine size={20} aria-hidden="true" />
                <span>{result.care.washing}</span>
              </li>
              <li style={{ "--i": 1 } as CSSProperties}>
                <Wind size={20} aria-hidden="true" />
                <span>{result.care.drying}</span>
              </li>
              <li style={{ "--i": 2 } as CSSProperties}>
                <Archive size={20} aria-hidden="true" />
                <span>{result.care.storage}</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <div className="result-flow">
        <section className="product-strip" data-story="match">
          <div>
            <p className="strip-label">Product</p>
            <h2>{result.product.productName}</h2>
          </div>
          <div className="strip-meta">
            <span>{sourceLabel(result.product.factsSource)}</span>
            <span>{metadataLabel(result)}</span>
            {pricing && <span>현재가 {formatPrice(pricing.currentPrice, pricing.currency)}</span>}
          </div>
        </section>

        {notice && (
          <section className="extraction-note" role="status" data-story="match">
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <p>{notice}</p>
              <button onClick={onManualInput} className="quiet-button">
                상품 설명 직접 입력하기
              </button>
            </div>
          </section>
        )}

        <section className="insight-band" aria-label="핵심 판단" data-story="match">
          {insights.map((insight) => (
            <div key={insight.text}>
              <insight.icon size={19} aria-hidden="true" />
              <p>{insight.text}</p>
            </div>
          ))}
        </section>

        <EditorialSection story="size" label="SIZE" title={result.size.recommendedSize ?? "미확인"} kicker="추천 사이즈">
          <p>{result.size.reason}</p>
          <p className="source-note">{sizeProvenance(result)}</p>
          <div className="inline-cluster">
            <span>신뢰도 {confidenceLabel(result.size.confidence)}</span>
            {result.size.alternatives.map((size) => (
              <span key={size}>대안 {size}</span>
            ))}
          </div>
          {(result.size.confidence === "low" || result.size.confidence === "unavailable") && (
            <button onClick={onEditProfile} className="quiet-button">
              추천 정확도 높이기
            </button>
          )}
        </EditorialSection>

        <EditorialSection story="material" label="MATERIAL" title={hasMaterials ? result.material.blendSummary : "소재 미확인"} kicker="소재 감각">
          <p className="source-note">{materialProvenance(result)}</p>
          {hasMaterials ? (
            <div className="takeaway-row">
              {materialTakeaways.map((item) => (
                <div key={item.label}>
                  <item.icon size={18} aria-hidden="true" />
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p>소재 정보를 찾지 못해 소재 감각은 평가하지 않았어요.</p>
          )}
          <details className="editorial-details">
            <summary>소재별 근거 보기</summary>
            <div>
              {!hasMaterials && <p>소재 정보가 없어 상세 근거를 만들지 않았습니다.</p>}
              {result.material.materialNotes.map((note) => (
                <p key={note.name}>
                  <strong>
                    {note.name} {note.percentage}%
                  </strong>
                  {[...note.pros, ...note.cons].join(" ")}
                </p>
              ))}
            </div>
          </details>
        </EditorialSection>

        <EditorialSection story="preference" label="PREFERENCE MATCH" title="취향과의 거리" kicker="선택한 기준">
          {result.preferenceMatches.length === 0 ? (
            <>
              <p>선택한 취향이 없어요. 취향을 고르면 그 기준으로 이 옷을 평가해요.</p>
              <button onClick={onEditPreferences} className="quiet-button">
                취향 고르러 가기
              </button>
            </>
          ) : (
            <>
              <p className="signal-summary">{signalSummary(counts)}</p>
              {valueMatch && <ValueCard value={result.value} />}
              <div className="preference-report">
                {result.preferenceMatches.map((match) => (
                  <details key={match.preferenceId} className="editorial-details" data-state={ratingState(match)}>
                    <summary>
                      <RatingMark state={ratingState(match)} />
                      <span className="summary-label">{match.label}</span>
                      <strong>{ratingLabel(match)}</strong>
                    </summary>
                    <p>{match.reason}</p>
                    <p className="basis-note">{basisLabel(match.basis, match.confidence)}</p>
                  </details>
                ))}
              </div>
            </>
          )}
        </EditorialSection>

        <EditorialSection story="care" label="CARE" title="입고 관리하기" kicker={result.care.source === "product_page" ? "상품 안내 기준" : "소재 기반 추정"}>
          <div className="care-script">
            <p>
              <strong>세탁</strong>
              {result.care.washing}
            </p>
            <p>
              <strong>건조</strong>
              {result.care.drying}
            </p>
            <p>
              <strong>보관</strong>
              {result.care.storage}
            </p>
            <p>
              <strong>주의</strong>
              {result.care.cautions.join(" ") || "제조사 라벨을 한 번 더 확인하세요."}
            </p>
          </div>
        </EditorialSection>

        <EvidenceSection result={result} />
      </div>
    </article>
  );
}

function EditorialSection({ story, label, title, kicker, children }: { story: Story; label: string; title: string; kicker: string; children: React.ReactNode }) {
  return (
    <Reveal as="section" className="editorial-section" story={story}>
      <div className="section-index">{label}</div>
      <div className="section-body">
        <p>{kicker}</p>
        <h2 className={title.length <= 4 ? "is-display" : undefined}>{title}</h2>
        <div className="section-content">{children}</div>
      </div>
    </Reveal>
  );
}

function EvidenceSection({ result }: { result: AnalysisResult }) {
  const warnings = result.product.extractionMetadata?.warnings ?? [];
  return (
    <section className="evidence-note">
      <h2>분석 근거</h2>
      <div>
        {result.score.reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
        {warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
      </div>
    </section>
  );
}

/** 현재 판매가, 정가, 가격 대비 구성. It is a reference estimate, so it never reads as a verdict. */
function ValueCard({ value }: { value?: ValueEvaluation }) {
  if (!value) return null;
  const pricing = value.pricing;

  return (
    <div className="value-card" data-status={value.status}>
      <div className="value-head">
        <span className="value-eyebrow">가격 대비 구성</span>
        <strong className="value-label">{value.label}</strong>
      </div>

      {pricing ? (
        <div className="value-price">
          <div>
            <span className="value-key">현재 판매가</span>
            <RollingNumber text={formatPrice(pricing.currentPrice, pricing.currency)} className="price-number" />
          </div>
          {pricing.originalPrice !== undefined && (
            <div className="value-original">
              <span className="value-key">정가</span>
              <s>{formatPrice(pricing.originalPrice, pricing.currency)}</s>
              {pricing.discountRate !== undefined && <em>{pricing.discountRate}% 할인</em>}
            </div>
          )}
        </div>
      ) : (
        <p className="value-price-missing">상품 페이지에서 가격을 확인하지 못했어요.</p>
      )}

      <p className="value-summary">{value.summary}</p>
      {value.status === "available" && value.expectedPrice !== undefined && pricing && (
        <p className="value-reference">
          비슷한 소재 구성의 참고 가격대는 약 {formatPrice(value.expectedPrice, pricing.currency)}예요.
        </p>
      )}
      <p className="value-caveat">{value.caveat}</p>
    </div>
  );
}

type RatingStateName = "good" | "fair" | "poor" | "unknown";

function ratingState(match: PreferenceMatch): RatingStateName {
  if (match.available === false || match.rating === "unavailable") return "unknown";
  if (match.rating === "excellent" || match.rating === "good") return "good";
  return match.rating === "fair" ? "fair" : "poor";
}

const ratingMarks = {
  good: { Icon: Check, label: "잘 맞아요" },
  fair: { Icon: Triangle, label: "보통이에요" },
  poor: { Icon: X, label: "아쉬워요" },
  unknown: { Icon: CircleHelp, label: "정보가 부족해요" },
} as const;

function RatingMark({ state }: { state: RatingStateName }) {
  const { Icon } = ratingMarks[state];
  return (
    <span className="rating-mark" data-state={state} aria-hidden="true">
      <Icon size={14} strokeWidth={3} />
    </span>
  );
}

function ratingLabel(match: PreferenceMatch) {
  const state = ratingState(match);
  const base = ratingMarks[state].label;
  return state !== "unknown" && match.confidence === "low" ? `${base} (참고)` : base;
}

function countRatings(matches: PreferenceMatch[]) {
  const counts = { good: 0, fair: 0, poor: 0, unknown: 0 };
  for (const match of matches) counts[ratingState(match)] += 1;
  return counts;
}

function signalSummary(counts: ReturnType<typeof countRatings>) {
  const parts = [
    counts.good ? `잘 맞아요 ${counts.good}` : null,
    counts.fair ? `보통이에요 ${counts.fair}` : null,
    counts.poor ? `아쉬워요 ${counts.poor}` : null,
    counts.unknown ? `정보가 부족해요 ${counts.unknown}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function basisLabel(basis: MetricBasis | undefined, confidence: PreferenceMatch["confidence"]) {
  const base =
    basis === "product_page"
      ? "상품 페이지에서 확인한 정보 기준이에요."
      : basis === "price_and_material"
        ? "현재 가격과 소재 구성을 함께 본 참고 평가예요."
        : "소재 특성을 기반으로 예상한 평가예요.";
  return confidence === "low" ? `${base} 정보가 일부 부족해 참고용으로 봐 주세요.` : base;
}

function buildTopInsights(result: AnalysisResult) {
  const warmScore = result.metrics?.warmth;
  const warm = warmScore ? warmScore.available && warmScore.score >= 68 : result.material.traits.warmth >= 4;
  const sizeOk = result.size.confidence === "high" || result.size.confidence === "medium";
  const care = result.score.components.careCompatibility;
  const careEasy = care !== null && care >= 70;
  return [
    { icon: Shirt, text: warm ? "보온성이 좋은 편이에요" : "보온성은 보통 수준이에요" },
    { icon: Ruler, text: sizeOk ? "사이즈 근거가 비교적 충분해요" : "사이즈 신뢰도는 낮게 봤어요" },
    { icon: WashingMachine, text: careEasy ? "관리 난도는 무난해요" : "관리에 조금 신경 써야 해요" },
  ] as const;
}

function sourceLabel(source: string) {
  if (source === "demo") return "샘플 상품";
  if (source === "manual_input") return "직접 입력 정보";
  return "상품 페이지 정보";
}

function metadataLabel(result: AnalysisResult) {
  const metadata = result.product.extractionMetadata;
  if (result.product.factsSource === "demo") return "샘플 데이터";
  if (result.product.factsSource === "manual_input") return "입력한 정보 기준";
  if (!metadata) return "추출 정보 없음";
  if (metadata.aiStatus === "used") return metadata.status === "complete" ? "AI로 구조화" : "AI로 일부 구조화";
  if (metadata.aiStatus === "failed") return "AI 분석 실패, 페이지 기반";
  return "AI 추출 미연결";
}

const sourceDescriptions: Record<string, string> = {
  "structured-data": "상품 페이지의 구조화 정보에서 확인",
  meta: "상품 페이지 메타 정보에서 확인",
  page: "상품 페이지 본문에서 확인",
  "gemini-extracted": "AI가 상품 페이지 문구에서 추출하고 페이지의 숫자와 대조",
  "user-input": "직접 입력한 값",
  demo: "샘플 데이터",
  inferred: "소재 특성을 기반으로 예상",
};

function materialProvenance(result: AnalysisResult) {
  const source = result.product.materials[0]?.source;
  const origin = source ? `혼용률: ${sourceDescriptions[source] ?? "출처 미확인"}.` : "혼용률을 확인하지 못했어요.";
  return `${origin} 보온성·촉감 같은 소재 감각은 소재별 일반 특성으로 예상한 값이에요.`;
}

function sizeProvenance(result: AnalysisResult) {
  const source = result.product.sizes[0]?.source;
  return source ? `사이즈표: ${sourceDescriptions[source] ?? "출처 미확인"}.` : "상품 페이지에서 사이즈표를 확인하지 못했어요.";
}

function extractionNotice(result: AnalysisResult) {
  const { product } = result;
  if (product.factsSource !== "product_page") return null;
  const metadata = product.extractionMetadata;
  if (metadata?.aiStatus === "failed") {
    return "AI 분석을 쓰지 못해 페이지에서 직접 읽은 정보만 반영했어요. 소재나 사이즈가 빠졌다면 상품 설명을 붙여 넣어 보완할 수 있어요.";
  }
  if (metadata?.status !== "complete") {
    return "상품 페이지에서 소재나 사이즈를 모두 찾지 못했어요. 상품 설명을 붙여 넣으면 더 정확해져요.";
  }
  return null;
}

function verdictCopy(verdict: string) {
  if (verdict === "추천해요") return "나와 잘 맞아요.";
  if (verdict === "조건부 추천") return "확인하고 사면 좋아요.";
  return "조금 더 신중히 보세요.";
}

function confidenceLabel(confidence: string) {
  if (confidence === "high") return "높음";
  if (confidence === "medium") return "보통";
  if (confidence === "low") return "낮음";
  return "없음";
}

