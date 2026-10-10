"use client";

import { Archive, Heart, ShieldCheck, Shirt, WashingMachine, Wind } from "lucide-react";
import { RollingNumber } from "@/components/motion/RollingNumber";
import { traitToLabel } from "@/domain/materialEvaluation";
import { formatPriceLabel } from "@/domain/pricing";
import type { AnalysisResult, CareGuide, CareKind, EvidenceSource, MetricBasis, MetricResult, PreferenceMatch, SizeRecommendation, ValueEvaluation } from "@/types/shopping";

/** 현재 판매가, 정가, 단품 환산, 가격 대비 구성. A product-relative judgement, so it states what it did not compare. */
export function ValueCard({ value }: { value?: ValueEvaluation }) {
  if (!value) return null;
  const pricing = value.pricing;
  const unitPrice = value.unitPrice;

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
            <RollingNumber text={formatPriceLabel(pricing.currentPrice, pricing.currency)} className="price-number" />
          </div>
          {pricing.originalPrice !== undefined && (
            <div className="value-original">
              <span className="value-key">정가</span>
              <s>{formatPriceLabel(pricing.originalPrice, pricing.currency)}</s>
              {pricing.discountRate !== undefined && <em>{pricing.discountRate}% 할인</em>}
            </div>
          )}
          {unitPrice !== undefined && (
            <div className="value-unit">
              <span className="value-key">1+1 기준 단품 환산</span>
              <strong>약 {formatPriceLabel(unitPrice, pricing.currency)}</strong>
            </div>
          )}
        </div>
      ) : (
        <p className="value-price-missing">상품 페이지에서 가격을 확인하지 못했어요.</p>
      )}

      {pricing?.bundleUnconfirmed && (
        <p className="value-reference">상품명에 1+1 표시가 있지만 구성 수량을 페이지에서 확인하지 못해 단품 환산은 하지 않았어요.</p>
      )}
      <p className="value-summary">{value.summary}</p>
      {pricing?.note && <p className="value-reference">{pricing.note}</p>}
      {value.status === "available" && value.expectedPrice !== undefined && pricing && (
        <p className="value-reference">
          비슷한 소재 구성의 참고 가격대는 {unitPrice !== undefined ? "개당 " : ""}약 {formatPriceLabel(value.expectedPrice, pricing.currency)}예요.
        </p>
      )}
      <p className="value-caveat">{value.caveat}</p>
    </div>
  );
}

export function basisLabel(basis: MetricBasis | undefined, confidence: PreferenceMatch["confidence"], source?: EvidenceSource) {
  const base =
    source === "manufacturer-care"
      ? "상품 페이지의 관리 안내를 기준으로 했어요."
      : source === "product-page" || basis === "product_page"
        ? "상품 페이지에서 확인한 정보 기준이에요."
        : basis === "price_and_material"
          ? "현재 가격과 소재 구성을 함께 본 참고 평가예요."
          : "소재 특성을 기반으로 예상한 평가예요.";
  return confidence === "low" ? `${base} 정보가 제한적이어서 참고용으로 봐 주세요.` : base;
}

export function scoreLabel(score: number, confidence?: MetricResult["confidence"]) {
  const base = score >= 82 ? "매우 적합" : score >= 68 ? "적합" : score >= 48 ? "보통" : score >= 30 ? "아쉬움" : "맞지 않음";
  return confidence === "low" ? `${base} (참고)` : base;
}

function metricLabel(metric?: MetricResult) {
  return !metric || !metric.available ? "정보 부족" : scoreLabel(metric.score, metric.confidence);
}

/** Every label comes from the canonical metrics, so "Care" cannot read "적합" while the label says hand wash. */
export function buildTakeaways(result: AnalysisResult) {
  const { metrics, material, score } = result;
  if (!metrics) {
    // Saved before the canonical evaluation existed.
    return [
      { label: "Warmth", value: traitToLabel(material.traits.warmth), icon: Shirt },
      { label: "Touch", value: traitToLabel(material.traits.softness), icon: Heart },
      { label: "Care", value: traitToLabel(material.traits.careEase), icon: WashingMachine },
      { label: "Pilling", value: traitToLabel(material.traits.pillingRisk, true), icon: ShieldCheck },
    ];
  }
  const care = score.components.careCompatibility;
  return [
    { label: "Warmth", value: metricLabel(metrics.warmth), icon: Shirt },
    { label: "Touch", value: metricLabel(metrics.softness), icon: Heart },
    { label: "Care", value: care === null ? "정보 부족" : scoreLabel(care), icon: WashingMachine },
    { label: "Pilling", value: metricLabel(metrics.pillingResistance), icon: ShieldCheck },
  ];
}

export function sizeKicker(size: SizeRecommendation) {
  return size.confidence === "low" && size.recommendedSize ? "예상 사이즈 (추정)" : "추천 사이즈";
}

export function sizeTitle(size: SizeRecommendation) {
  if (!size.recommendedSize) return "미확인";
  return size.confidence === "low" ? `${size.recommendedSize} 가능성이 높아요` : size.recommendedSize;
}

export function SizeChips({ size, className }: { size: SizeRecommendation; className?: string }) {
  const { fitCandidates } = size;
  const hasCandidates = size.confidence === "low" && fitCandidates && (fitCandidates.regular || fitCandidates.relaxed);

  let chips: string[];
  if (hasCandidates) {
    chips =
      fitCandidates.regular === fitCandidates.relaxed
        ? [`정핏·여유핏 후보 ${fitCandidates.regular}`]
        : [fitCandidates.regular && `정핏 후보 ${fitCandidates.regular}`, fitCandidates.relaxed && `여유핏 후보 ${fitCandidates.relaxed}`].filter((chip): chip is string => Boolean(chip));
  } else {
    chips = size.alternatives.map((name) => `대안 ${name}`);
  }
  if (chips.length === 0) return null;

  const spans = chips.map((chip) => <span key={chip}>{chip}</span>);
  return className ? <div className={className}>{spans}</div> : <>{spans}</>;
}

const careKindLabels: Record<CareKind, string> = {
  washing: "세탁",
  drying: "건조",
  bleach: "표백",
  wring: "비틀기",
  ironing: "다림질",
  dry_clean: "드라이클리닝",
  other: "기타",
};

export function CareIcon({ kind }: { kind: CareKind }) {
  if (kind === "washing" || kind === "dry_clean") return <WashingMachine size={20} aria-hidden="true" />;
  if (kind === "drying") return <Wind size={20} aria-hidden="true" />;
  return <Archive size={20} aria-hidden="true" />;
}

export function storyCareLines(care: CareGuide): Array<{ kind: CareKind; text: string }> {
  if (care.manufacturer?.length) return care.manufacturer.slice(0, 4);
  if (care.inferred) return care.inferred.slice(0, 3).map((tip) => ({ kind: tip.kind === "washing" || tip.kind === "drying" ? tip.kind : "other", text: tip.text }));
  return [
    { kind: "washing", text: care.washing },
    { kind: "drying", text: care.drying },
    { kind: "other", text: care.storage },
  ];
}

export function careKicker(care: CareGuide) {
  if (care.manufacturer?.length) return "상품 페이지 안내";
  if (care.manufacturer) return "소재 기반 권장";
  return care.source === "product_page" ? "상품 안내 기준" : "소재 기반 추정";
}

/** One-line verdicts from the same metrics as the preference list. Empty when the page gave no basis. */
export function careVerdict(care: CareGuide) {
  const lines: string[] = [];
  if (care.dryer === "not_recommended") lines.push("건조기 사용은 비추천");
  else if (care.dryer === "allowed") lines.push("건조기 사용 가능");
  if (care.washing_effort === "easy") lines.push("세탁기로 편하게 관리");
  else if (care.washing_effort === "moderate") lines.push("세탁 시 약간의 주의 필요");
  else if (care.washing_effort === "demanding") lines.push("손세탁 등 세탁이 까다로움");
  return lines;
}

export function CareSection({ care }: { care: CareGuide }) {
  // Results saved before the split have no separate lists; show them as they were.
  if (!care.manufacturer || !care.inferred) {
    return (
      <div className="care-script">
        <p>
          <strong>세탁</strong>
          {care.washing}
        </p>
        <p>
          <strong>건조</strong>
          {care.drying}
        </p>
        <p>
          <strong>보관</strong>
          {care.storage}
        </p>
        <p>
          <strong>주의</strong>
          {care.cautions.join(" ") || "제조사 라벨을 한 번 더 확인하세요."}
        </p>
      </div>
    );
  }

  const verdict = careVerdict(care);
  return (
    <div className="care-split">
      {verdict.length > 0 && <p className="care-verdict">{verdict.join(" · ")}</p>}

      <div className="care-block">
        <h3>상품 페이지 안내</h3>
        {care.manufacturer.length > 0 ? (
          <ul className="care-list">
            {care.manufacturer.map((item) => (
              <li key={`${item.kind}-${item.text}`}>
                <strong>{careKindLabels[item.kind]}</strong>
                {item.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="source-note">상품 페이지에서 세탁이나 건조 안내를 찾지 못했어요. 라벨을 한 번 더 확인하세요.</p>
        )}
      </div>

      <div className="care-block is-inferred">
        <h3>소재 특성 기반 권장</h3>
        <p className="source-note">상품 페이지의 안내가 아니라 소재의 일반 특성으로 앱이 정리한 조언이에요.</p>
        <ul className="care-list">
          {care.inferred.map((tip) => (
            <li key={`${tip.kind}-${tip.text}`}>{tip.text}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
