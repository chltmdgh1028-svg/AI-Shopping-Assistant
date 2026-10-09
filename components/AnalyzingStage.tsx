"use client";

import { Check, Link2 } from "lucide-react";
import type { CSSProperties } from "react";
import { HeroPicture, Mask } from "@/components/common";
import { motion } from "@/lib/motion";

// The first three steps advance on a timer but stop at "내 취향과 비교 중" until the analysis really
// resolves, so the stage never claims "분석 완료" while the network request is still running.
export const loadingSteps = ["상품 페이지 읽는 중", "소재와 사이즈 확인 중", "내 취향과 비교 중", "분석 완료"];
export const LOADING_STEP_MS = 700;
export const MIN_ANALYZING_MS = (loadingSteps.length - 1) * LOADING_STEP_MS;
export const DONE_HOLD_MS = 450;
// How long the Home -> Analyzing flood covers the screen before the stage underneath is swapped in.
export const FLOOD_COVER_MS = Math.round(motion.slow * 0.9);

export type AnalyzingTarget = { kind: "sample"; name: string } | { kind: "url"; host: string };

export function AnalyzingStage({ activeIndex, target }: { activeIndex: number; target: AnalyzingTarget }) {
  // Real state, not a timer: the rail fills as far as the pipeline has actually progressed.
  const progress = activeIndex / (loadingSteps.length - 1);

  return (
    <section className="analyzing-stage stage-reveal" role="status" aria-live="polite" style={{ "--progress": progress } as CSSProperties}>
      <div className="analysis-figure" aria-hidden="true">
        <HeroPicture />
        <span className="scan-line" />
      </div>

      <div className="analysis-copy">
        <p className="brand-line">Analyzing</p>
        <Mask as="h2" key={activeIndex}>
          {loadingSteps[activeIndex]}
        </Mask>
        <p>상품 페이지를 옷의 언어로 다시 읽고 있어요.</p>

        {/* The sample's swatch is the element that morphs into the result's product visual. */}
        <div className="analysis-chip">
          {target.kind === "sample" ? (
            <>
              <span className="fabric-swatch chip-visual" aria-hidden="true" />
              <span>{target.name}</span>
            </>
          ) : (
            <>
              <Link2 size={16} aria-hidden="true" />
              <span>{target.host}</span>
            </>
          )}
        </div>

        <ol className="analysis-steps">
          {loadingSteps.map((step, index) => (
            <li key={step} className={`analysis-step ${index <= activeIndex ? "is-active" : ""}`}>
              <span>{index < activeIndex ? <Check size={14} aria-hidden="true" /> : index + 1}</span>
              <strong>{step}</strong>
            </li>
          ))}
        </ol>

        <div className="analysis-skeleton" aria-hidden="true">
          <span className="skeleton-line is-wide" />
          <span className="skeleton-line" />
          <span className="skeleton-line is-short" />
        </div>
      </div>
    </section>
  );
}
