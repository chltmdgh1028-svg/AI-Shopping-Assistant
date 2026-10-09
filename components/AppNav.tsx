"use client";

import { Heart, History, Search, Sparkles, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

export type View = "home" | "result" | "history" | "preferences" | "profile";

const items: Array<{ id: View; label: string; icon: LucideIcon }> = [
  { id: "home", label: "홈", icon: Search },
  { id: "result", label: "결과", icon: Sparkles },
  { id: "preferences", label: "취향", icon: Heart },
  { id: "profile", label: "핏", icon: UserRound },
  { id: "history", label: "기록", icon: History },
];

export function AppNav({ view, hasResult, onChange }: { view: View; hasResult: boolean; onChange: (view: View) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);

  // One indicator slides between items. Its position goes through CSS variables, so no React state
  // changes during the move and the browser animates only transform (+ the pill's own width).
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const place = () => {
      const active = track.querySelector<HTMLElement>(".nav-pill.is-active");
      track.style.setProperty("--ind-x", `${active?.offsetLeft ?? 0}px`);
      track.style.setProperty("--ind-w", `${active?.offsetWidth ?? 0}px`);
      track.style.setProperty("--ind-o", active ? "1" : "0");
    };
    place();
    // Animate only after the first placement, so the indicator never slides in from the left edge on load.
    const ready = requestAnimationFrame(() => track.setAttribute("data-ready", ""));
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(ready);
      window.removeEventListener("resize", place);
    };
  }, [view, hasResult]);

  return (
    <nav className="app-nav" aria-label="주요 화면">
      <button className="brand-mark" onClick={() => onChange("home")}>
        Shopping Assistant
      </button>
      <div className="nav-track" ref={trackRef}>
        <span className="nav-indicator" aria-hidden="true" />
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`nav-pill ${view === item.id ? "is-active" : ""}`}
              onClick={() => onChange(item.id)}
              disabled={item.id === "result" && !hasResult}
              aria-current={view === item.id ? "page" : undefined}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
