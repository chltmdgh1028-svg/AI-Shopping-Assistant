"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

/** Subscribes to a media query without an effect + setState round trip. */
export function useMediaQuery(query: string, serverValue = false) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => serverValue);
}

export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");

/** A mouse or trackpad that can hover. Touch screens never match, so hover effects cannot stick on phones. */
export const useFinePointer = () => useMediaQuery("(hover: hover) and (pointer: fine)");

/** True once the element has been on screen. Used for scroll reveals, which play a single time. */
export function useInViewOnce<T extends Element>(ref: RefObject<T | null>, rootMargin = "0px 0px -12% 0px") {
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin, seen]);

  return seen;
}

/**
 * Runs a callback at most once per animation frame. Pointer events arrive faster than the screen
 * refreshes; coalescing them keeps style writes to one per frame.
 */
export function useFrameGate() {
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return useCallback((callback: () => void) => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      callback();
    });
  }, []);
}
