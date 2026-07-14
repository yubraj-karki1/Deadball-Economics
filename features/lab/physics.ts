import type { ModelCalibration, Point } from "../../lib/deadball";
import { DEFAULT_CALIBRATION, GK_H, GK_REACTION, GK_V, GOAL_H, GOAL_W, GX, GY, X0, X1 } from "./constants";
import type { PsxgCalc } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function calcPhysics(ball: Point, gk: Point, speed: number, shotDistance: number, craftBonus = 0, calibration: Required<ModelCalibration> = DEFAULT_CALIBRATION): PsxgCalc {
  const hd = Math.abs(ball[0] - gk[0]);
  const vd = Math.abs(ball[1] - Math.max(0, gk[1]));
  const speedMs = speed / 3.6;
  const ballTime = speedMs > 0 ? shotDistance / speedMs : 999;
  const hTime = hd / GK_H;
  const vTime = vd / GK_V;
  const reaction = (GK_REACTION + craftBonus * 0.45) * calibration.gkReaction;
  const diveTime = reaction + Math.max(hTime, vTime);
  const margin = diveTime - ballTime;
  let psxg = margin > 0.3 ? 0.95 : margin > 0.15 ? 0.75 + (margin - 0.15) * 1.33 : margin > 0.05 ? 0.55 + (margin - 0.05) * 2 : margin > -0.05 ? 0.15 + (margin + 0.05) * 4 : margin > -0.15 ? 0.08 + (margin + 0.15) * 0.7 : margin > -0.3 ? 0.03 + (margin + 0.3) * 0.33 : 0.03;
  if (ball[1] > 2) psxg = Math.min(0.99, psxg + 0.12);
  if (ball[0] < 0.5 || ball[0] > GOAL_W - 0.5) psxg = Math.min(0.99, psxg + 0.1);
  if (Math.hypot(hd, vd) < 0.5) psxg = Math.max(0.03, psxg * 0.2);
  psxg = clamp(psxg + craftBonus, 0.01, 0.99);
  const diff = margin > 0.2 ? "Very Hard" : margin > 0.05 ? "Hard" : margin > -0.05 ? "Medium" : margin > -0.15 ? "Moderate" : "Easy";
  return { psxg, diveDist: Math.hypot(hd, vd), ballTime, diveTime, margin, diff, speedMs, hd, vd, hTime, vTime, reaction };
}

export function swingPath(s: Point, e: Point, swing: string) {
  const mx = (s[0] + e[0]) / 2;
  const my = (s[1] + e[1]) / 2;
  const dx = e[0] - s[0];
  const dy = e[1] - s[1];
  const len = Math.hypot(dx, dy) || 1;
  let px = -dy / len;
  let py = dx / len;
  if (px * (GX - mx) + py * (GY - my) < 0) {
    px = -px;
    py = -py;
  }
  const k = swing === "Straight" ? 2 : 13;
  const sign = swing === "Inswinging" ? -1 : 1;
  const cx = clamp(mx + px * k * sign, X0 + 3, X1 - 2);
  const cy = clamp(my + py * k * sign, 2, 66);
  return `M ${s[0]} ${s[1]} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${e[0]} ${e[1]}`;
}

export function goalPointToSvg([x, y]: Point) {
  return [16 + x * 100, 16 + (GOAL_H - y) * 100] as Point;
}

export function footAdjustedCurve(curve: number, foot: string) {
  return foot === "Left Foot" ? -curve : curve;
}

