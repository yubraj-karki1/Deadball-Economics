import type { ModelCalibration, Point } from "../../lib/deadball";
import type { LabState, PresetKey } from "./types";

export const P_L = 105;
export const P_W = 68;
export const GX = 105;
export const GY = 34;
export const X0 = 55;
export const X1 = 105;
export const VW = X1 - X0;
export const VH = 68;
export const GOAL_W = 7.32;
export const GOAL_H = 2.44;
export const GK_REACTION = 0.15;
export const GK_H = 4;
export const GK_V = 2.5;
export const SAVED_SCENARIOS_KEY = "deadball-economics-scenarios";
export const SAVED_TRAINED_MODELS_KEY = "deadball-economics-trained-models";
export const ACTIVE_TRAINED_MODEL_KEY = "deadball-economics-active-trained-model";

export const DEFAULT_CALIBRATION: Required<ModelCalibration> = {
  distanceWeight: 1,
  angleWeight: 1,
  wallPenalty: 1,
  craftBonus: 1,
  gkReaction: 1,
};

export function defaultStart(t: string): Point {
  if (t === "corner-right") return [105, 0.5];
  if (t === "corner-left") return [105, 67.5];
  if (t.startsWith("throwin")) return [88, 0.5];
  return [83, 26];
}

export const PRESETS: Record<PresetKey, { name: string } & Partial<LabState>> = {
  nearPost: { name: "Near-post corner", spType: "corner-right", shot: [101.5, 31.5], gk: [104, 34], start: defaultStart("corner-right"), defenders: [[101, 32], [102.2, 34], [100.2, 36.2], [98.8, 30.5], [99.5, 38.5]], attackers: [[101.5, 31.5], [100.2, 33.5], [99.4, 37]], swing: "Inswinging", height: "High Pass", body: "Head" },
  farPost: { name: "Far-post overload", spType: "corner-left", shot: [101.8, 39.5], gk: [103.8, 34.2], start: defaultStart("corner-left"), defenders: [[102.5, 34], [101.8, 37.5], [99.4, 35.5], [100.4, 41.2]], attackers: [[101.8, 39.5], [100.8, 41.4], [99.5, 43.2], [98.8, 36.5]], swing: "Outswinging", height: "High Pass", body: "Head" },
  directFk: { name: "Direct free kick", spType: "freekick-direct", shot: [84, 32], gk: [104, 34], start: defaultStart("freekick-direct"), defenders: [[100, 38]], attackers: [[87, 31], [95, 40]], swing: "Straight", height: "High Pass", body: "Right Foot", ball: [6.7, 1.8], gkf: [3.55, 0.45], shotSpeed: 92, curve: 62, dip: 58, knuckle: 12, wallSize: 4, wallDistance: 9, wallShift: 0.5, calibration: DEFAULT_CALIBRATION },
  longThrow: { name: "Long throw", spType: "throwin-long", shot: [99.4, 36.8], gk: [104, 34], start: [88, 0.5], defenders: [[100.4, 34.6], [101.6, 36.5], [99.5, 39.2], [98.6, 33.2]], attackers: [[99.4, 36.8], [98.7, 39.8], [97.8, 34.2]], swing: "Straight", height: "High Pass", body: "Head" },
};

export const initialState: LabState = {
  spType: "corner-right", shot: [101.5, 31.5], gk: [104, 34], start: defaultStart("corner-right"),
  defenders: [[101, 32], [102.2, 34], [100.2, 36.2], [98.8, 30.5], [99.5, 38.5]], attackers: [[101.5, 31.5], [100.2, 33.5], [99.4, 37]],
  swing: "Inswinging", height: "High Pass", body: "Head", showHeat: false, showVor: false,
  ball: [0.9, 2], gkf: [3.66, 0.5], shotSpeed: 85, curve: 0, dip: 30, knuckle: 0,
  wallSize: 0, wallDistance: 9, wallShift: 0, calibration: DEFAULT_CALIBRATION,
};
