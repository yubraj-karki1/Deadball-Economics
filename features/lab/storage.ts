import type { ModelCalibration, Point } from "../../lib/deadball";
import { DEFAULT_CALIBRATION, SAVED_SCENARIOS_KEY, SAVED_TRAINED_MODELS_KEY, initialState } from "./constants";
import type { LabState, ReliabilityBucket, SavedScenario, TrainedModel, TrainingMetrics } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const makeScenarioId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const isPoint = (value: unknown): value is Point => Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "number" && Number.isFinite(v));
const isReliabilityBucket = (value: unknown): value is ReliabilityBucket => {
  if (!value || typeof value !== "object") return false;
  const raw = value as Partial<ReliabilityBucket>;
  return ["count", "avgPredicted", "avgActual", "minP", "maxP"].every((key) => typeof raw[key as keyof ReliabilityBucket] === "number");
};
const pointsOr = (value: unknown, fallback: Point[]) => Array.isArray(value) && value.every(isPoint) ? value : fallback;
export const numberOr = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const stringOr = (value: unknown, fallback: string) => typeof value === "string" ? value : fallback;
const boolOr = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;

export function calibrationOr(value: unknown): Required<ModelCalibration> {
  const raw = value && typeof value === "object" ? value as Partial<ModelCalibration> : {};
  return {
    distanceWeight: clamp(numberOr(raw.distanceWeight, DEFAULT_CALIBRATION.distanceWeight), 0.25, 2),
    angleWeight: clamp(numberOr(raw.angleWeight, DEFAULT_CALIBRATION.angleWeight), 0.25, 2),
    wallPenalty: clamp(numberOr(raw.wallPenalty, DEFAULT_CALIBRATION.wallPenalty), 0.25, 2),
    craftBonus: clamp(numberOr(raw.craftBonus, DEFAULT_CALIBRATION.craftBonus), 0.25, 2),
    gkReaction: clamp(numberOr(raw.gkReaction, DEFAULT_CALIBRATION.gkReaction), 0.25, 2),
  };
}

function normalizeLabState(value: unknown): LabState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<LabState>;
  if (!isPoint(raw.shot) || !isPoint(raw.gk) || !isPoint(raw.start) || !isPoint(raw.ball) || !isPoint(raw.gkf)) return null;
  return { spType: stringOr(raw.spType, initialState.spType), shot: raw.shot, gk: raw.gk, start: raw.start, defenders: pointsOr(raw.defenders, initialState.defenders), attackers: pointsOr(raw.attackers, initialState.attackers), swing: stringOr(raw.swing, initialState.swing), height: stringOr(raw.height, initialState.height), body: stringOr(raw.body, initialState.body), showHeat: boolOr(raw.showHeat, false), showVor: boolOr(raw.showVor, false), ball: raw.ball, gkf: raw.gkf, shotSpeed: numberOr(raw.shotSpeed, initialState.shotSpeed), curve: numberOr(raw.curve, initialState.curve), dip: numberOr(raw.dip, initialState.dip), knuckle: numberOr(raw.knuckle, initialState.knuckle), wallSize: numberOr(raw.wallSize, initialState.wallSize), wallDistance: numberOr(raw.wallDistance, initialState.wallDistance), wallShift: numberOr(raw.wallShift, initialState.wallShift), calibration: calibrationOr(raw.calibration) };
}

export function readSavedScenarios(): SavedScenario[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SAVED_SCENARIOS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const raw = item as Partial<SavedScenario>;
      const state = normalizeLabState(raw.state);
      return state && typeof raw.id === "string" && typeof raw.name === "string" ? [{ id: raw.id, name: raw.name, state, createdAt: numberOr(raw.createdAt, Date.now()), updatedAt: numberOr(raw.updatedAt, Date.now()) }] : [];
    });
  } catch { return []; }
}

export const writeSavedScenarios = (scenarios: SavedScenario[]) => window.localStorage.setItem(SAVED_SCENARIOS_KEY, JSON.stringify(scenarios));

export function readTrainedModels(): TrainedModel[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SAVED_TRAINED_MODELS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const raw = item as Partial<TrainedModel>;
      if (typeof raw.id !== "string" || typeof raw.name !== "string") return [];
      const fallback: TrainingMetrics = { rows: numberOr(raw.rows, 0), goals: Math.round(numberOr(raw.rows, 0) * numberOr(raw.goalRate, 0)), goalRate: numberOr(raw.goalRate, 0), loss: numberOr(raw.loss, 0), brier: 0, accuracy: 0, auc: 0 };
      return [{ id: raw.id, name: raw.name, calibration: calibrationOr(raw.calibration), rows: fallback.rows, goalRate: fallback.goalRate, loss: fallback.loss, train: raw.train ?? fallback, test: raw.test ?? fallback, coefficients: Array.isArray(raw.coefficients) && raw.coefficients.every((v) => typeof v === "number") ? raw.coefficients : undefined, features: Array.isArray(raw.features) && raw.features.every((v) => typeof v === "string") ? raw.features : undefined, quality: raw.quality, importance: raw.importance, confidence: raw.confidence, warnings: Array.isArray(raw.warnings) && raw.warnings.every((v) => typeof v === "string") ? raw.warnings : undefined, psxg: raw.psxg, reliability: Array.isArray(raw.reliability) && raw.reliability.every(isReliabilityBucket) ? raw.reliability : undefined, notes: typeof raw.notes === "string" ? raw.notes : "", createdAt: numberOr(raw.createdAt, Date.now()) }];
    });
  } catch { return []; }
}

export const writeTrainedModels = (models: TrainedModel[]) => window.localStorage.setItem(SAVED_TRAINED_MODELS_KEY, JSON.stringify(models));
