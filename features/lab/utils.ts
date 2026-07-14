import type { Point } from "../../lib/deadball";
import { GX, GY, P_L, P_W } from "./constants";

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const pct = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "-" : `${(v * 100).toFixed(1)}%`);
export const distM = (p: Point) => Math.hypot(GX - p[0], GY - p[1]);
export const toSB = (p: Point): Point => [+(p[0] * 120 / P_L).toFixed(2), +(p[1] * 80 / P_W).toFixed(2)];
export const isAbortError = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

export function heatColor(xg: number) {
  const t = Math.min(1, xg / 0.35);
  const r = t < 0.5 ? Math.round(80 + 350 * t) : 235;
  const g = t < 0.5 ? 200 : Math.round(200 - 150 * (t - 0.5) * 2);
  return `rgb(${r},${g},70)`;
}
