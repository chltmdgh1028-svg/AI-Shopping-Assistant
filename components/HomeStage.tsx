"use client";

import { Link2, Search, SlidersHorizontal, WandSparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { HeroPicture, InlineFailure, Mask, type AnalysisErrorState } from "@/components/common";
import { useFinePointer, useFrameGate, useReducedMotion } from "@/components/motion/hooks";
import { demoUrl } from "@/data/demoProduct";

const heroFacts = [
  ["WOOL", "60%"],
  ["WARMTH", "HIGH"],
  ["RELAXED", "FIT"],
  ["YOUR SIZE", "L"],
];

type HomeProps = {
  url: string;
  setUrl: (value: string) => void;
  manualText: string;
  setManualText: (value: string) => void;
  useManual: boolean;
  setUseManual: (value: boolean | ((current: boolean) => boolean)) => void;
  error: AnalysisErrorState;
  /** `origin` is the element the flood transition grows out of. */
  onAnalyze: (origin: HTMLElement | null) => void;
  onDemo: (origin: HTMLElement | null) => void;
};

export function HomeStage(props: HomeProps) {
  const stageRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const fine = useFinePointer();
  const reduced = useReducedMotion();
  const gate = useFrameGate();

  // Depth: the photo and the light layer drift a few pixels against the pointer. Only on a real mouse,
  // only a few pixels, and only through two CSS variables read by transform rules.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !fine || reduced) return;

    let rect = stage.getBoundingClientRect();
    const measure = () => {
      rect = stage.getBoundingClientRect();
    };
    const move = (event: PointerEvent) =>
      gate(() => {
        stage.style.setProperty("--px", (((event.clientX - rect.left) / rect.width - 0.5) * 2).toFixed(3));
        stage.style.setProperty("--py", (((event.clientY - rect.top) / rect.height - 0.5) * 2).toFixed(3));
      });
    const leave = () => {
      stage.style.setProperty("--px", "0");
      stage.style.setProperty("--py", "0");
    };

    stage.addEventListener("pointerenter", measure);
    stage.addEventListener("pointermove", move);
    stage.addEventListener("pointerleave", leave);
    window.addEventListener("resize", measure);
    return () => {
      stage.removeEventListener("pointerenter", measure);
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerleave", leave);
      window.removeEventListener("resize", measure);
    };
  }, [fine, reduced, gate]);

  // Magnetic CTA: within ~90px the button leans a few pixels toward the pointer, then settles back.
  useEffect(() => {
    const form = formRef.current;
    const button = submitRef.current;
    if (!form || !button || !fine || reduced) return;

    const reach = 90;
    const max = 6;
    let center = { x: 0, y: 0 };
    const measure = () => {
      const box = button.getBoundingClientRect();
      center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    };
    const move = (event: PointerEvent) =>
      gate(() => {
        const dx = event.clientX - center.x;
        const dy = event.clientY - center.y;
        const near = Math.hypot(dx, dy) < reach;
        button.style.setProperty("--tx", near ? `${Math.max(-max, Math.min(max, dx * 0.18)).toFixed(1)}px` : "0px");
        button.style.setProperty("--ty", near ? `${Math.max(-max, Math.min(max, dy * 0.18)).toFixed(1)}px` : "0px");
      });
    const leave = () => {
      button.style.setProperty("--tx", "0px");
      button.style.setProperty("--ty", "0px");
    };

    form.addEventListener("pointerenter", measure);
    form.addEventListener("pointermove", move);
    form.addEventListener("pointerleave", leave);
    return () => {
      form.removeEventListener("pointerenter", measure);
      form.removeEventListener("pointermove", move);
      form.removeEventListener("pointerleave", leave);
    };
  }, [fine, reduced, gate]);

  return (
    <section className="home-stage" ref={stageRef}>
      <div className="hero-media" aria-hidden="true">
        <HeroPicture />
      </div>
      <div className="hero-light" aria-hidden="true" />
      <div className="hero-scrim" />

      <div className="hero-composition">
        <div className="hero-copy">
          <p className="brand-line enter" style={{ "--i": 0 } as React.CSSProperties}>Personal styling product</p>
          <Mask as="h1" index={1}>
            이 옷, 나한테 맞을까?
          </Mask>
        </div>

        <div className="hero-facts enter" style={{ "--i": 3 } as React.CSSProperties} aria-label="분석 예시">
          <div className="facts-caption">
            <span className="fabric-swatch" aria-hidden="true" />
            <p>
              샘플 상품 분석 예시
              <br />
              울 블렌드 크루넥 니트
            </p>
          </div>
          {heroFacts.map(([label, value]) => (
            <div key={label} className="hero-fact">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>

        <form
          ref={formRef}
          className="url-lens enter"
          style={{ "--i": 4 } as React.CSSProperties}
          onSubmit={(event) => {
            event.preventDefault();
            props.onAnalyze(submitRef.current);
          }}
        >
          <label htmlFor="product-url" className="sr-only">
            상품 URL
          </label>
          <Link2 aria-hidden="true" size={22} />
          <input
            id="product-url"
            name="product-url"
            type="url"
            autoComplete="off"
            value={props.url}
            onChange={(event) => props.setUrl(event.target.value)}
            // The sample address is only a stand-in: touching the field removes it so a real link can be pasted at once.
            onFocus={() => props.url === demoUrl && props.setUrl("")}
            placeholder="상품 URL을 붙여넣기… (비우면 샘플 분석)"
            inputMode="url"
          />
          <button type="submit" className="lens-submit" ref={submitRef}>
            <span>분석하기</span>
            <Search aria-hidden="true" size={18} />
          </button>
        </form>

        <div className="home-actions enter" style={{ "--i": 5 } as React.CSSProperties}>
          <button className="text-action" onClick={(event) => props.onDemo(event.currentTarget)}>
            <WandSparkles size={17} aria-hidden="true" />
            샘플로 보기
          </button>
          <button className="text-action" onClick={() => props.setUseManual((value) => !value)} aria-expanded={props.useManual}>
            <SlidersHorizontal size={17} aria-hidden="true" />
            설명 직접 입력
          </button>
        </div>

        {props.error && <InlineFailure error={props.error} />}

        {props.useManual && (
          <div className="manual-drawer stage-reveal">
            <label htmlFor="manual-product-info">상품 설명</label>
            <textarea
              id="manual-product-info"
              name="manual-product-info"
              autoComplete="off"
              value={props.manualText}
              onChange={(event) => props.setManualText(event.target.value)}
              rows={6}
              placeholder={"상품명…\nWool 60% Nylon 25% Acrylic 15%\n59,000원\nM 어깨 46 가슴 106 총장 65\n세탁: 찬물 울코스 권장"}
            />
          </div>
        )}
      </div>
    </section>
  );
}
