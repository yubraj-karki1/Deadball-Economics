import type { ModelCalibration, Point, XgResponse } from "../../lib/deadball";
import { GY, P_L, P_W } from "./constants";
import type { LabState } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));
const toSB = (p: Point): Point => [+(p[0] * 120 / P_L).toFixed(2), +(p[1] * 80 / P_W).toFixed(2)];

export function fmt(v: number, digits = 3) {
  if (!Number.isFinite(v)) return "-";
  return v.toFixed(digits);
}

export function signed(v: number, digits = 3) {
  if (!Number.isFinite(v)) return "-";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

export function xgMath(result: XgResponse | null, state: LabState, modelShot: Point, isDirect: boolean, calibration: Required<ModelCalibration>) {
  if (!result) return null;
  const [x, y] = toSB(modelShot);
  const distance = Math.hypot(120 - x, 40 - y);
  const centrality = Math.abs(y - 40);
  const derived = result.derived;
  const kind = result.setpiece_type;
  const body = isDirect && state.body === "Head" ? "Right Foot" : state.body;
  const nearest = Number(derived.nearest_defender_dist ?? 0);
  const sixYard = Number(derived.defenders_in_6yard ?? 0);
  const attackers = Number(derived.attackers_in_box ?? 0);
  const gkLine = Number(derived.gk_dist_from_line ?? 0);
  const zone = result.zone;
  const marking = result.marking_label;
  const terms: Array<[string, number]> = [];
  let base = -2.45;

  if (kind === "freekick" && isDirect) {
    const distanceTerm = clamp((29 - distance) / 9.5, -1.25, 1.15) * calibration.distanceWeight;
    const centerTerm = -centrality * 0.018 * calibration.angleWeight;
    const wallTerm = -Number(derived.wall_obstruction ?? derived.wall_size ?? state.wallSize) * 0.085 * calibration.wallPenalty;
    const craftTerm = Number(derived.direct_craft_logit ?? 0) * calibration.craftBonus;
    base = -2.9;
    terms.push(["distance", distanceTerm], ["angle", centerTerm], ["wall", wallTerm], ["craft", craftTerm]);
  } else {
    terms.push(
      ["distance", clamp((18 - distance) / 7.5, -2.1, 1.8) * calibration.distanceWeight],
      ["angle", clamp((7 - centrality) / 14, -0.8, 0.6) * calibration.angleWeight],
      ["shot x", (x - 104) * 0.035],
      ["nearest def", nearest ? clamp((nearest - 1.5) * 0.14, -0.35, 0.35) : 0.08],
      ["six-yard def", -Math.max(0, sixYard - 1) * 0.08],
      ["attackers", Math.min(attackers, 5) * 0.035],
      ["GK line", gkLine > 0 ? -clamp((gkLine - 1.5) * 0.04, -0.12, 0.18) : 0],
    );
    if (zone === "near-post" || zone === "far-post") terms.push(["zone", 0.32]);
    if (zone === "penalty-spot") terms.push(["zone", 0.18]);
    if (zone === "edge") terms.push(["zone", -0.38]);
    if (zone === "second-ball") terms.push(["zone", -0.75]);
    if (body === "Head") terms.push(["body", kind === "corner" ? 0.08 : -0.04]);
    if (body.includes("Foot")) terms.push(["body", 0.04]);
    if (state.swing === "Inswinging") terms.push(["delivery", 0.12]);
    if (state.swing === "Outswinging") terms.push(["delivery", -0.08]);
    if (state.height === "Low Pass") terms.push(["height", 0.1]);
    if (state.height === "Ground Pass") terms.push(["height", -0.1]);
    if (marking === "man") terms.push(["marking", -0.18]);
    if (marking === "zonal") terms.push(["marking", 0.08]);
    if (kind === "freekick") terms.push(["crossed FK", -0.16]);
    if (kind === "throwin") {
      terms.push(["throw-in", -0.1]);
      if (state.spType.includes("long")) terms.push(["long throw", 0.14]);
    }
  }

  const logit = base + terms.reduce((sum, [, value]) => sum + value, 0);
  const rawXg = sigmoid(logit);
  return {
    base,
    terms,
    logit,
    rawXg,
    clampedXg: clamp(rawXg, 0.006, 0.62),
    distance,
    centrality,
  };
}

function cubicPoint(start: Point, c1: Point, c2: Point, end: Point, t: number): Point {
  const mt = 1 - t;
  return [
    mt ** 3 * start[0] + 3 * mt ** 2 * t * c1[0] + 3 * mt * t ** 2 * c2[0] + t ** 3 * end[0],
    mt ** 3 * start[1] + 3 * mt ** 2 * t * c1[1] + 3 * mt * t ** 2 * c2[1] + t ** 3 * end[1],
  ];
}

export function directFreeKickVisual(start: Point, target: Point, curve: number, dip: number, knuckle: number) {
  const dx = target[0] - start[0];
  const dy = target[1] - start[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const bendSide = start[1] < GY ? -1 : 1;
  const bend = curve / 100 * 5.5;
  const dipStrength = clamp(dip / 100, 0, 1);
  const knuckleStrength = clamp(knuckle / 100, 0, 1);
  const flightSide = (curve === 0 ? 1 : Math.sign(curve)) * bendSide;
  const dipLift = dipStrength * 4.8 * flightSide;
  const lateDrop = dipStrength * 2.8 * -flightSide;
  const wobble = knuckleStrength * 1.2;
  const c1Bend = bend * 0.55 * bendSide + dipLift + wobble;
  const c2Bend = bend * bendSide + lateDrop - wobble * 0.45;

  const c1x = start[0] + ux * len * 0.34 + nx * c1Bend;
  const c1y = start[1] + uy * len * 0.34 + ny * c1Bend;
  const c2x = start[0] + ux * len * 0.72 + nx * c2Bend;
  const c2y = start[1] + uy * len * 0.72 + ny * c2Bend;
  const apexLift = (2.4 + dipStrength * 5.2) * flightSide;
  const arcC1: Point = [start[0] + ux * len * 0.28 + nx * (c1Bend + apexLift), start[1] + uy * len * 0.28 + ny * (c1Bend + apexLift)];
  const arcC2: Point = [start[0] + ux * len * 0.7 + nx * (c2Bend + apexLift * 0.28), start[1] + uy * len * 0.7 + ny * (c2Bend + apexLift * 0.28)];
  const heightMarks = [0.3, 0.5, 0.7, 0.86].map((t, i) => {
    const [x, y] = cubicPoint(start, arcC1, arcC2, target, t);
    const fall = i / 3;
    return {
      x,
      y,
      radius: 0.18 + dipStrength * (0.48 - fall * 0.22),
      opacity: 0.24 + dipStrength * (0.42 - fall * 0.12),
    };
  });

  return {
    path: `M ${start[0]} ${start[1]} C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${target[0]} ${target[1]}`,
    dipPath: `M ${start[0]} ${start[1]} C ${arcC1[0].toFixed(1)} ${arcC1[1].toFixed(1)} ${arcC2[0].toFixed(1)} ${arcC2[1].toFixed(1)} ${target[0]} ${target[1]}`,
    heightMarks,
  };
}

