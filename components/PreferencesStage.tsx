"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, type PointerEvent } from "react";
import { Mask } from "@/components/common";
import { useFinePointer, useFrameGate, useReducedMotion } from "@/components/motion/hooks";
import { Reveal } from "@/components/motion/Reveal";
import { RollingNumber } from "@/components/motion/RollingNumber";
import { preferenceCategoryLabels, preferenceDefinitions, type PreferenceDefinition } from "@/data/preferences";
import type { PreferenceId } from "@/types/shopping";

export function PreferencesStage({ selected, onToggle }: { selected: Set<string>; onToggle: (id: PreferenceId) => void }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const fine = useFinePointer();
  const reduced = useReducedMotion();
  const gate = useFrameGate();
  const interactive = fine && !reduced;

  // Counted against the current preference list, so a retired id in old saved data can never inflate it.
  const count = preferenceDefinitions.filter((item) => selected.has(item.id)).length;

  // Cursor proximity: tiles near the pointer brighten their border a little (--prox 0..1). Rects are cached
  // when the pointer enters and refreshed on scroll/resize, so the move handler does no layout reads.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !interactive) return;

    const radius = 240;
    let boxes: Array<{ el: HTMLElement; rect: DOMRect }> = [];
    let stale = true;
    const measure = () => {
      boxes = Array.from(canvas.querySelectorAll<HTMLElement>(".preference-tile")).map((el) => ({ el, rect: el.getBoundingClientRect() }));
      stale = false;
    };
    const invalidate = () => {
      stale = true;
    };
    const move = (event: globalThis.PointerEvent) =>
      gate(() => {
        if (stale) measure();
        for (const { el, rect } of boxes) {
          const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
          const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
          el.style.setProperty("--prox", Math.max(0, 1 - Math.hypot(dx, dy) / radius).toFixed(2));
        }
      });
    const leave = () => {
      for (const { el } of boxes) el.style.setProperty("--prox", "0");
    };

    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    window.addEventListener("scroll", invalidate, { passive: true });
    window.addEventListener("resize", invalidate);
    return () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      window.removeEventListener("scroll", invalidate);
      window.removeEventListener("resize", invalidate);
    };
  }, [interactive, gate]);

  return (
    <section className="preferences-stage stage-reveal">
      <div className="preference-intro">
        <p className="brand-line">What matters to you?</p>
        <Mask as="h1">나의 쇼핑 성향 만들기</Mask>
        <p className="preference-count">
          <RollingNumber text={String(count)} className="count-number" />
          개의 기준이 분석에 반영됩니다.
        </p>
      </div>

      <div className="preference-canvas" ref={canvasRef}>
        {Object.entries(preferenceCategoryLabels).map(([category, label], index) => (
          <Reveal key={category} as="section" className="preference-cluster" delay={index}>
            <h2>{label}</h2>
            <div>
              {preferenceDefinitions
                .filter((item) => item.category === category)
                .map((item) => (
                  <PreferenceTile key={item.id} definition={item} selected={selected.has(item.id)} onToggle={onToggle} interactive={interactive} />
                ))}
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function PreferenceTile({
  definition,
  selected,
  onToggle,
  interactive,
}: {
  definition: PreferenceDefinition;
  selected: boolean;
  onToggle: (id: PreferenceId) => void;
  interactive: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const gate = useFrameGate();

  // Pointer light, restrained tilt and a border highlight that follows the pointer around the edge.
  // Mouse only: touch has no hover, so phones get the press and selection states instead.
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!interactive || event.pointerType !== "mouse") return;
    const { clientX, clientY } = event;
    gate(() => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const py = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
      el.style.setProperty("--rx", `${((0.5 - py) * 7).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${((px - 0.5) * 7).toFixed(2)}deg`);
      const angle = (Math.atan2(clientY - (rect.top + rect.height / 2), clientX - (rect.left + rect.width / 2)) * 180) / Math.PI + 90;
      el.style.setProperty("--sweep", `${angle.toFixed(0)}deg`);
    });
  };

  const onPointerLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  };

  return (
    <button
      ref={ref}
      type="button"
      className={`preference-tile ${selected ? "is-selected" : ""}`}
      aria-pressed={selected}
      onClick={() => onToggle(definition.id)}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <span className="tile-aurora" aria-hidden="true" />
      <span className="tile-sheen" aria-hidden="true" />
      <span className="tile-check" aria-hidden="true">
        <Check size={14} strokeWidth={3} />
      </span>
      <span className="tile-label">{definition.label}</span>
      <strong className="tile-copy">{definition.plainLanguage}</strong>
    </button>
  );
}
