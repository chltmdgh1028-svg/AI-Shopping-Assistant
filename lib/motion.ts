// Motion tokens for JavaScript timers. The CSS twins (--motion-*, --ease-*) live at the top of
// app/globals.css; keep the two in step. Every transition in the app uses one of these four durations.
export const motion = {
  /** Press, hover, focus: feedback the hand expects immediately. */
  fast: 160,
  /** Toggles, small state changes, accordion. */
  standard: 280,
  /** Section and card reveals, page changes. */
  slow: 480,
  /** Hero moments only: the Home intro, the result reveal. */
  cinematic: 1100,
} as const;
