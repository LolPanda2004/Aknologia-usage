// Single source of truth for breakpoints and motion timings.
// theme.css, landing/index.html and landing/download/index.html repeat these literals in their @media rules
// (plain CSS can't use var() in a media query); tests/responsive/check-breakpoints.mjs fails on any other width.
//   CSS form: below → (max-width: <bp - 0.02>px), up → (min-width: <bp>px)

export const BP = { sm: 480, md: 768, lg: 1024, xl: 1280 } as const;
export type Breakpoint = keyof typeof BP;

export const mq = {
  below: (b: Breakpoint) => `(max-width: ${BP[b] - 0.02}px)`,
  up: (b: Breakpoint) => `(min-width: ${BP[b]}px)`,
};

/** Milliseconds; the same numbers as the --dur-* tokens in theme.css. */
export const MOTION = { press: 120, hover: 180, enter: 240, page: 320, countUp: 480, stagger: 15 } as const;
