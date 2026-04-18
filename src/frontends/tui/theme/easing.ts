/**
 * Easing Functions — Standard timing curves for animations.
 *
 * Each function maps an input t (0..1) to an output value (0..1).
 * Used by useAnimation() and anywhere smooth interpolation is needed.
 */

/** Linear — no easing, constant speed. */
export function linear(t: number): number {
  return t
}

/** Ease-in — slow start, accelerating. Cubic curve. */
export function easeIn(t: number): number {
  return t * t * t
}

/** Ease-out — fast start, decelerating. Good for UI appearances. */
export function easeOut(t: number): number {
  const inv = 1 - t
  return 1 - inv * inv * inv
}

/** Ease-in-out — smooth start and end. Cubic in/out. */
export function easeInOut(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2
}
