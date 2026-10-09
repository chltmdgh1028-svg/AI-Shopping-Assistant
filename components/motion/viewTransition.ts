import { flushSync } from "react-dom";

/**
 * Runs a state update inside a View Transition. Browsers without the API, and users who prefer
 * reduced motion, simply get the update with no transition.
 *
 * `sharedElement: true` turns on the product visual's shared name for this transition only (see the
 * html[data-vt] rules in motion.css), so the cover/chip morphs into the result. Without it no element
 * carries the name, which keeps ordinary navigation to a short crossfade instead of waiting for a morph
 * that has no partner.
 */
export function withViewTransition(update: () => void, options: { sharedElement?: boolean } = {}) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || typeof document.startViewTransition !== "function") {
    update();
    return;
  }

  const root = document.documentElement;
  if (options.sharedElement) root.dataset.vt = "product";

  const transition = document.startViewTransition(() => {
    flushSync(update);
  });
  transition.finished.finally(() => {
    delete root.dataset.vt;
  });
}
