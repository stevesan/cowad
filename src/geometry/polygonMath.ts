import type { DrawVertex, Point } from '../types';

/** Doubled signed area (trapezoidal shoelace). Positive = CW, Negative = CCW (in y-up coords). */
export function signedArea2(pts: Point[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return a;
}

export function isCCW(pts: Point[]): boolean {
  return signedArea2(pts) < 0;
}

/**
 * Pick a test point for enclosing-sector detection.
 * Prefers a newly-created (non-existing) vertex; falls back to centroid.
 */
export function computeTestPoint(chain: DrawVertex[]): Point {
  for (let i = 1; i < chain.length - 1; i++) {
    if (!chain[i].existingId) return { x: chain[i].x, y: chain[i].y };
  }
  let x = 0, y = 0;
  for (const pt of chain) { x += pt.x; y += pt.y; }
  return { x: x / chain.length, y: y / chain.length };
}

/**
 * Split a boundary loop at two vertices into two sub-paths.
 * path1: startVid → endVid (forward in loop)
 * path2: endVid → startVid (forward in loop)
 */
export function buildSplitPaths(
  loop: string[], startVid: string, endVid: string
): { path1: string[]; path2: string[] } {
  const si = loop.indexOf(startVid);
  const ei = loop.indexOf(endVid);
  const len = loop.length;

  const path1: string[] = [];
  for (let i = si; ; ) {
    path1.push(loop[i]);
    if (i === ei) break;
    i = (i + 1) % len;
  }

  const path2: string[] = [];
  for (let i = ei; ; ) {
    path2.push(loop[i]);
    if (i === si) break;
    i = (i + 1) % len;
  }

  return { path1, path2 };
}
