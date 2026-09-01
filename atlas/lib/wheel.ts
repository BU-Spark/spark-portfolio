// Pure geometry arithmetic for the admin dashboard wheel. Extracted from
// components/admin/DashboardWheel.tsx purely so it can be tested: that component is
// "use client" and imports next/navigation, so exercising it in vitest would mean
// mocking Next to test four lines of maths.
//
// This exists because of a real outage. The wheel hardcoded six segments — 60° each,
// and `segments[(i + 5) % 6]` to find the previous one. app/admin/page.tsx filters
// the Settings segment out for non-super admins, so they got five, `segments[5]` was
// undefined, and reading a property off it 500'd /admin for 6 of 8 admin accounts
// while working for the two supers.

/** Degrees per segment. */
export function step(n: number): number {
  return n > 0 ? 360 / n : 0;
}

/**
 * Index of the segment before `i`, wrapping. The `+ n` matters: `(0 - 1) % 5` is
 * `-1` in JavaScript, not `4`, and `segments[-1]` is undefined — the same class of
 * bug in a different disguise.
 */
export function prevIndex(i: number, n: number): number {
  return n > 0 ? (i - 1 + n) % n : 0;
}
