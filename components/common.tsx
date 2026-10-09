"use client";

import { getImageProps } from "next/image";
import { AlertCircle, ChevronDown, Shirt } from "lucide-react";
import { useState } from "react";

export type AnalysisErrorState = { title: string; message: string; code?: string } | null;

// Brand photography with art direction: a portrait crop for phones and portrait tablets, landscape otherwise.
// This is a brand visual only; it is never shown as the product being analyzed.
export function HeroPicture() {
  const common = { alt: "", sizes: "100vw" };
  const {
    props: { srcSet: portrait },
  } = getImageProps({ ...common, width: 941, height: 1672, src: "/images/home-hero-mobile.webp" });
  const { props: landscape } = getImageProps({ ...common, width: 1672, height: 941, src: "/images/home-hero.webp" });

  return (
    <picture>
      <source media="(max-width: 1099px) and (orientation: portrait)" srcSet={portrait} />
      {/* alt is intentionally empty: decorative brand photography */}
      <img {...landscape} alt="" loading="eager" fetchPriority="high" />
    </picture>
  );
}

// Shop images come from arbitrary hosts, so they are plain <img> (next/image would reject unknown hosts).
// Only http(s) URLs are accepted, the referrer is withheld, and a missing or broken image becomes a swatch.
export function ProductVisual({ src, eager }: { src?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const usable = src && /^https?:\/\//i.test(src) && !failed;

  if (!usable) return <span className="fabric-swatch" />;
  return (
    <img
      src={src}
      alt=""
      className="product-visual"
      referrerPolicy="no-referrer"
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/** A line of text that rises out of a clipped box. `index` staggers several lines. */
export function Mask({ children, index = 0, as: Tag = "span", className }: { children: React.ReactNode; index?: number; as?: "span" | "p" | "h1" | "h2"; className?: string }) {
  return (
    <Tag className={`mask ${className ?? ""}`}>
      <span className="mask-inner" style={{ "--i": index } as React.CSSProperties}>
        {children}
      </span>
    </Tag>
  );
}

export function EmptyJourney({ title, body, onAction }: { title: string; body: string; onAction?: () => void }) {
  return (
    <section className="empty-journey stage-reveal">
      <Shirt size={34} aria-hidden="true" />
      <h1>{title}</h1>
      <p>{body}</p>
      {onAction && (
        <button className="primary-action" onClick={onAction}>
          상품 분석하러 가기
        </button>
      )}
    </section>
  );
}

export function InlineFailure({ error }: { error: NonNullable<AnalysisErrorState> }) {
  return (
    <div className="inline-failure" role="status" aria-live="polite">
      <AlertCircle size={18} aria-hidden="true" />
      <div>
        <p>{error.title}</p>
        <span>{error.message}</span>
      </div>
    </div>
  );
}

export function ProgressivePanel({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="progressive-panel">
      <button onClick={onToggle} aria-expanded={open}>
        <span>{title}</span>
        <ChevronDown className={open ? "is-open" : ""} size={19} aria-hidden="true" />
      </button>
      {open && <div className="progressive-content stage-reveal">{children}</div>}
    </section>
  );
}

export function NumberField({ label, value, optional, onChange }: { label: string; value: number; optional?: boolean; onChange: (value: number) => void }) {
  return (
    <label className="field-label">
      {label}
      <input
        type="number"
        name={label}
        autoComplete="off"
        min={optional ? 0 : 1}
        value={optional && value === 0 ? "" : value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field-label">
      {label}
      <input name={label} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <label className="field-label">
      {label}
      <select name={label} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)}>
        {Object.entries(options).map(([key, optionLabel]) => (
          <option key={key} value={key}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
