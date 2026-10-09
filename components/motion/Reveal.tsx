"use client";

import { useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useInViewOnce } from "@/components/motion/hooks";

/** Fades and lifts its content in the first time it scrolls into view. Native scrolling is untouched. */
export function Reveal({
  children,
  as = "div",
  className,
  delay = 0,
  story,
}: {
  children: ReactNode;
  as?: "div" | "section";
  className?: string;
  delay?: number;
  story?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInViewOnce(ref);
  const props = {
    className: `reveal ${seen ? "is-in" : ""} ${className ?? ""}`,
    style: { "--i": delay } as CSSProperties,
    "data-story": story,
  };

  return as === "section" ? (
    <section ref={ref as unknown as RefObject<HTMLElement>} {...props}>
      {children}
    </section>
  ) : (
    <div ref={ref} {...props}>
      {children}
    </div>
  );
}
