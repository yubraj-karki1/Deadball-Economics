"use client";

import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { predict, type GridResponse, type ModelCalibration, type Point, type XgResponse } from "../lib/deadball";

const P_L = 105;
const P_W = 68;
const GX = 105;
const GY = 34;
const X0 = 55;
const X1 = 105;
const VW = X1 - X0;
const VH = 68;
const GOAL_W = 7.32;
const GOAL_H = 2.44;
const GK_REACTION = 0.15;
const GK_H = 4;
const GK_V = 2.5;
const SAVED_SCENARIOS_KEY = "deadball-economics-scenarios";
const SAVED_TRAINED_MODELS_KEY = "deadball-economics-trained-models";

type PresetKey = "nearPost" | "farPost" | "directFk" | "longThrow";
type DragTarget = { kind: "shot" | "gk" | "start" | "def" | "atk"; index?: number } | null;
type GoalDrag = "ball" | "gk" | null;

type LabState = {
  spType: string;
  shot: Point;
  gk: Point;
  start: Point;
  defenders: Point[];
  attackers: Point[];
  swing: string;
  height: string;
  body: string;
  showHeat: boolean;
  showVor: boolean;
  ball: Point;
  gkf: Point;
  shotSpeed: number;
  curve: number;
  dip: number;
  knuckle: number;
  wallSize: number;
  wallDistance: number;
  wallShift: number;
  calibration: Required<ModelCalibration>;
};

type SavedScenario = { id: string; name: string; state: LabState; createdAt: number; updatedAt: number };
type TrainingRow = { goal: number; features: number[] };
type SkipReason = "missingGoal" | "missingShotX" | "missingShotY" | "invalidNumber";
type TrainingMetrics = { rows: number; goals: number; goalRate: number; loss: number; brier: number; accuracy: number; auc: number };
type DataQuality = { total: number; valid: number; skipped: number; missingGoal: number; missingShotX: number; missingShotY: number; invalidNumber: number };
type FeatureImportance = { name: string; label: string; weight: number; share: number; direction: string };
type ModelConfidence = { label: "Low" | "Medium" | "High"; score: number; reasons: string[] };
type PsxgTraining = { rows: number; predicted: number; actual: number; suggestedGkReaction: number };
type TrainedModel = {
  id: string;
  name: string;
  calibration: Required<ModelCalibration>;
  rows: number;
  goalRate: number;
  loss: number;
  train?: TrainingMetrics;
  test?: TrainingMetrics;
  coefficients?: number[];
  features?: string[];
  quality?: DataQuality;
  importance?: FeatureImportance[];
  confidence?: ModelConfidence;
  warnings?: string[];
  psxg?: PsxgTraining;
  notes?: string;
  createdAt: number;
};
type TrainingReport = { rows: number; skipped: number; quality: DataQuality; train: TrainingMetrics; test: TrainingMetrics; confidence: ModelConfidence; warnings: string[]; model: TrainedModel } | { error: string };

type PsxgCalc = {
  psxg: number;
  diveDist: number;
  ballTime: number;
  diveTime: number;
  margin: number;
  diff: string;
  speedMs: number;
  hd: number;
  vd: number;
  hTime: number;
  vTime: number;
  reaction: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const pct = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "-" : `${(v * 100).toFixed(1)}%`);
const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));
const distM = (p: Point) => Math.hypot(GX - p[0], GY - p[1]);
const toSB = (p: Point): Point => [+(p[0] * 120 / P_L).toFixed(2), +(p[1] * 80 / P_W).toFixed(2)];
const isAbortError = (error: unknown) => error instanceof DOMException && error.name === "AbortError";
const heatColor = (xg: number) => {
  const t = Math.min(1, xg / 0.35);
  const r = t < 0.5 ? Math.round(80 + 350 * t) : 235;
  const g = t < 0.5 ? 200 : Math.round(200 - 150 * (t - 0.5) * 2);
  return `rgb(${r},${g},70)`;
};

const DEFAULT_CALIBRATION: Required<ModelCalibration> = {
  distanceWeight: 1,
  angleWeight: 1,
  wallPenalty: 1,
  craftBonus: 1,
  gkReaction: 1,
};

function defaultStart(t: string): Point {
  if (t === "corner-right") return [105, 0.5];
  if (t === "corner-left") return [105, 67.5];
  if (t.startsWith("throwin")) return [88, 0.5];
  return [83, 26];
}

const PRESETS: Record<PresetKey, { name: string } & Partial<LabState>> = {
  nearPost: {
    name: "Near-post corner",
    spType: "corner-right",
    shot: [101.5, 31.5],
    gk: [104, 34],
    start: defaultStart("corner-right"),
    defenders: [[101, 32], [102.2, 34], [100.2, 36.2], [98.8, 30.5], [99.5, 38.5]],
    attackers: [[101.5, 31.5], [100.2, 33.5], [99.4, 37]],
    swing: "Inswinging",
    height: "High Pass",
    body: "Head",
  },
  farPost: {
    name: "Far-post overload",
    spType: "corner-left",
    shot: [101.8, 39.5],
    gk: [103.8, 34.2],
    start: defaultStart("corner-left"),
    defenders: [[102.5, 34], [101.8, 37.5], [99.4, 35.5], [100.4, 41.2]],
    attackers: [[101.8, 39.5], [100.8, 41.4], [99.5, 43.2], [98.8, 36.5]],
    swing: "Outswinging",
    height: "High Pass",
    body: "Head",
  },
  directFk: {
    name: "Direct free kick",
    spType: "freekick-direct",
    shot: [84, 32],
    gk: [104, 34],
    start: defaultStart("freekick-direct"),
    defenders: [[100, 38]],
    attackers: [[87, 31], [95, 40]],
    swing: "Straight",
    height: "High Pass",
    body: "Right Foot",
    ball: [6.7, 1.8],
    gkf: [3.55, 0.45],
    shotSpeed: 92,
    curve: 62,
    dip: 58,
    knuckle: 12,
    wallSize: 4,
    wallDistance: 9,
    wallShift: 0.5,
    calibration: DEFAULT_CALIBRATION,
  },
  longThrow: {
    name: "Long throw",
    spType: "throwin-long",
    shot: [99.4, 36.8],
    gk: [104, 34],
    start: [88, 0.5],
    defenders: [[100.4, 34.6], [101.6, 36.5], [99.5, 39.2], [98.6, 33.2]],
    attackers: [[99.4, 36.8], [98.7, 39.8], [97.8, 34.2]],
    swing: "Straight",
    height: "High Pass",
    body: "Head",
  },
};

const initialState: LabState = {
  spType: "corner-right",
  shot: [101.5, 31.5],
  gk: [104, 34],
  start: defaultStart("corner-right"),
  defenders: [[101, 32], [102.2, 34], [100.2, 36.2], [98.8, 30.5], [99.5, 38.5]],
  attackers: [[101.5, 31.5], [100.2, 33.5], [99.4, 37]],
  swing: "Inswinging",
  height: "High Pass",
  body: "Head",
  showHeat: false,
  showVor: false,
  ball: [0.9, 2],
  gkf: [3.66, 0.5],
  shotSpeed: 85,
  curve: 0,
  dip: 30,
  knuckle: 0,
  wallSize: 0,
  wallDistance: 9,
  wallShift: 0,
  calibration: DEFAULT_CALIBRATION,
};

const makeScenarioId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const isPoint = (value: unknown): value is Point => Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "number" && Number.isFinite(v));
const pointsOr = (value: unknown, fallback: Point[]) => Array.isArray(value) && value.every(isPoint) ? value : fallback;
const numberOr = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const stringOr = (value: unknown, fallback: string) => typeof value === "string" ? value : fallback;
const boolOr = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;

function calibrationOr(value: unknown): Required<ModelCalibration> {
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

  return {
    spType: stringOr(raw.spType, initialState.spType),
    shot: raw.shot,
    gk: raw.gk,
    start: raw.start,
    defenders: pointsOr(raw.defenders, initialState.defenders),
    attackers: pointsOr(raw.attackers, initialState.attackers),
    swing: stringOr(raw.swing, initialState.swing),
    height: stringOr(raw.height, initialState.height),
    body: stringOr(raw.body, initialState.body),
    showHeat: boolOr(raw.showHeat, false),
    showVor: boolOr(raw.showVor, false),
    ball: raw.ball,
    gkf: raw.gkf,
    shotSpeed: numberOr(raw.shotSpeed, initialState.shotSpeed),
    curve: numberOr(raw.curve, initialState.curve),
    dip: numberOr(raw.dip, initialState.dip),
    knuckle: numberOr(raw.knuckle, initialState.knuckle),
    wallSize: numberOr(raw.wallSize, initialState.wallSize),
    wallDistance: numberOr(raw.wallDistance, initialState.wallDistance),
    wallShift: numberOr(raw.wallShift, initialState.wallShift),
    calibration: calibrationOr(raw.calibration),
  };
}

function readSavedScenarios() {
  try {
    const stored = window.localStorage.getItem(SAVED_SCENARIOS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const raw = item as Partial<SavedScenario>;
      const savedState = normalizeLabState(raw.state);
      if (!savedState || typeof raw.id !== "string" || typeof raw.name !== "string") return [];
      return [{
        id: raw.id,
        name: raw.name,
        state: savedState,
        createdAt: numberOr(raw.createdAt, Date.now()),
        updatedAt: numberOr(raw.updatedAt, Date.now()),
      }];
    });
  } catch {
    return [];
  }
}

function writeSavedScenarios(scenarios: SavedScenario[]) {
  window.localStorage.setItem(SAVED_SCENARIOS_KEY, JSON.stringify(scenarios));
}

function readTrainedModels() {
  try {
    const stored = window.localStorage.getItem(SAVED_TRAINED_MODELS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const raw = item as Partial<TrainedModel>;
      if (typeof raw.id !== "string" || typeof raw.name !== "string") return [];
      const fallbackMetrics: TrainingMetrics = {
        rows: numberOr(raw.rows, 0),
        goals: Math.round(numberOr(raw.rows, 0) * numberOr(raw.goalRate, 0)),
        goalRate: numberOr(raw.goalRate, 0),
        loss: numberOr(raw.loss, 0),
        brier: 0,
        accuracy: 0,
        auc: 0,
      };
      return [{
        id: raw.id,
        name: raw.name,
        calibration: calibrationOr(raw.calibration),
        rows: fallbackMetrics.rows,
        goalRate: fallbackMetrics.goalRate,
        loss: fallbackMetrics.loss,
        train: raw.train ?? fallbackMetrics,
        test: raw.test ?? fallbackMetrics,
        coefficients: Array.isArray(raw.coefficients) && raw.coefficients.every((value) => typeof value === "number") ? raw.coefficients : undefined,
        features: Array.isArray(raw.features) && raw.features.every((value) => typeof value === "string") ? raw.features : undefined,
        quality: raw.quality,
        importance: raw.importance,
        confidence: raw.confidence,
        warnings: Array.isArray(raw.warnings) && raw.warnings.every((value) => typeof value === "string") ? raw.warnings : undefined,
        psxg: raw.psxg,
        notes: typeof raw.notes === "string" ? raw.notes : "",
        createdAt: numberOr(raw.createdAt, Date.now()),
      }];
    });
  } catch {
    return [];
  }
}

function writeTrainedModels(models: TrainedModel[]) {
  window.localStorage.setItem(SAVED_TRAINED_MODELS_KEY, JSON.stringify(models));
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === "\"" && quoted && next === "\"") {
      cell += "\"";
      i += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell.trim());
  return cells;
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase());

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""]));
  });
}

function csvNumber(row: Record<string, string>, names: string[]) {
  for (const name of names) {
    const value = row[name];
    if (value == null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function csvHasValue(row: Record<string, string>, names: string[]) {
  return names.some((name) => row[name] != null && row[name] !== "");
}

function csvGoal(row: Record<string, string>) {
  const raw = (row.goal ?? row.is_goal ?? row.scored ?? row.outcome ?? row.result ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "goal", "scored"].includes(raw)) return 1;
  if (["0", "false", "no", "miss", "missed", "saved", "blocked", "off target"].includes(raw)) return 0;
  const numeric = Number(raw);
  return numeric === 1 ? 1 : numeric === 0 ? 0 : null;
}

const SHOT_X_COLUMNS = ["shot_x", "x", "location_x"];
const SHOT_Y_COLUMNS = ["shot_y", "y", "location_y"];

function validateTrainingRow(row: Record<string, string>): { data: TrainingRow } | { reason: SkipReason } {
  const goal = csvGoal(row);
  const rawX = csvNumber(row, SHOT_X_COLUMNS);
  const rawY = csvNumber(row, SHOT_Y_COLUMNS);
  if (goal == null) return { reason: "missingGoal" as const };
  if (rawX == null) return { reason: csvHasValue(row, SHOT_X_COLUMNS) ? "invalidNumber" as const : "missingShotX" as const };
  if (rawY == null) return { reason: csvHasValue(row, SHOT_Y_COLUMNS) ? "invalidNumber" as const : "missingShotY" as const };

  const x = rawX <= P_L ? rawX * 120 / P_L : rawX;
  const y = rawY <= P_W ? rawY * 80 / P_W : rawY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { reason: "invalidNumber" as const };

  const distance = Math.hypot(120 - x, 40 - y);
  const centrality = Math.abs(y - 40);
  const wall = csvNumber(row, ["wall_size", "wall", "wall_players"]) ?? 0;
  const curve = Math.abs(csvNumber(row, ["shot_curve", "curve"]) ?? 0) / 100;
  const dip = (csvNumber(row, ["shot_dip", "dip"]) ?? 0) / 100;
  const knuckle = (csvNumber(row, ["shot_knuckle", "knuckle"]) ?? 0) / 100;
  const speed = clamp(((csvNumber(row, ["shot_speed", "speed"]) ?? 85) - 40) / 100, 0, 1);

  const data = {
    goal,
    features: [
      clamp((18 - distance) / 7.5, -2.1, 1.8),
      clamp((7 - centrality) / 14, -0.8, 0.6),
      -Math.max(0, wall) * 0.09,
      clamp(curve, 0, 1) * 0.14 + clamp(dip, 0, 1) * 0.32 + clamp(knuckle, 0, 1) * 0.18 + speed * 0.08,
    ],
  };

  return { data };
}

function rowTrainingFeatures(row: Record<string, string>): TrainingRow | null {
  const validated = validateTrainingRow(row);
  return "data" in validated ? validated.data : null;
}

function dataQuality(parsedRows: Array<Record<string, string>>) {
  const quality: DataQuality = { total: parsedRows.length, valid: 0, skipped: 0, missingGoal: 0, missingShotX: 0, missingShotY: 0, invalidNumber: 0 };
  const rows: TrainingRow[] = [];

  parsedRows.forEach((row) => {
    const validated = validateTrainingRow(row);
    if ("data" in validated) {
      quality.valid += 1;
      rows.push(validated.data);
    } else {
      quality.skipped += 1;
      quality[validated.reason] += 1;
    }
  });

  return { quality, rows };
}

function seededShuffle<T>(items: T[]) {
  const copy = [...items];
  let seed = 1337;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const j = seed % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function predictTrainingRow(weights: number[], features: number[]) {
  return clamp(sigmoid(weights[0] + features.reduce((sum, feature, i) => sum + weights[i + 1] * feature, 0)), 0.001, 0.999);
}

function aucScore(scored: Array<{ goal: number; p: number }>) {
  const positives = scored.filter((item) => item.goal === 1).length;
  const negatives = scored.length - positives;
  if (!positives || !negatives) return 0.5;

  const ranked = [...scored].sort((a, b) => a.p - b.p);
  let rankSum = 0;
  ranked.forEach((item, index) => {
    if (item.goal === 1) rankSum += index + 1;
  });

  return (rankSum - positives * (positives + 1) / 2) / (positives * negatives);
}

function trainingMetrics(rows: TrainingRow[], weights: number[]): TrainingMetrics {
  const scored = rows.map((row) => ({ goal: row.goal, p: predictTrainingRow(weights, row.features) }));
  const goals = rows.reduce((sum, row) => sum + row.goal, 0);
  const loss = scored.reduce((sum, row) => sum - (row.goal * Math.log(row.p) + (1 - row.goal) * Math.log(1 - row.p)), 0) / rows.length;
  const brier = scored.reduce((sum, row) => sum + (row.p - row.goal) ** 2, 0) / rows.length;
  const accuracy = scored.filter((row) => (row.p >= 0.5 ? 1 : 0) === row.goal).length / rows.length;

  return {
    rows: rows.length,
    goals,
    goalRate: goals / rows.length,
    loss,
    brier,
    accuracy,
    auc: aucScore(scored),
  };
}

const TRAINING_FEATURES = [
  { name: "distance", label: "Distance", direction: "closer shots" },
  { name: "angle", label: "Angle", direction: "central angle" },
  { name: "wall", label: "Wall pressure", direction: "wall blocks" },
  { name: "craft", label: "FK craft", direction: "curve/dip/knuckle" },
];

function featureImportance(weights: number[]): FeatureImportance[] {
  const raw = TRAINING_FEATURES.map((feature, i) => ({
    ...feature,
    weight: weights[i + 1] ?? 0,
  }));
  const total = raw.reduce((sum, feature) => sum + Math.abs(feature.weight), 0) || 1;

  return raw
    .map((feature) => ({ ...feature, share: Math.abs(feature.weight) / total }))
    .sort((a, b) => b.share - a.share);
}

function modelConfidence(train: TrainingMetrics, test: TrainingMetrics, quality: DataQuality): ModelConfidence {
  const lossGap = Math.max(0, test.loss - train.loss);
  const skippedRate = quality.total ? quality.skipped / quality.total : 0;
  const rowsScore = clamp(test.rows / 500, 0, 1) * 30;
  const aucScorePart = clamp((test.auc - 0.5) / 0.35, 0, 1) * 35;
  const lossGapScore = clamp(1 - lossGap / 0.16, 0, 1) * 20;
  const qualityScore = clamp(1 - skippedRate / 0.35, 0, 1) * 15;
  const score = Math.round(rowsScore + aucScorePart + lossGapScore + qualityScore);
  const reasons = [
    `${test.rows} test rows`,
    `AUC ${fmt(test.auc)}`,
    `loss gap ${fmt(lossGap)}`,
    `${pct(skippedRate)} skipped`,
  ];

  return { label: score >= 76 ? "High" : score >= 52 ? "Medium" : "Low", score, reasons };
}

function modelWarnings(train: TrainingMetrics, test: TrainingMetrics, quality: DataQuality, psxg?: PsxgTraining) {
  const warnings: string[] = [];
  const skippedRate = quality.total ? quality.skipped / quality.total : 0;
  if (test.rows < 120) warnings.push("Small test sample");
  if (test.auc < 0.65) warnings.push("Weak test AUC");
  if (test.loss - train.loss > 0.12) warnings.push("Possible overfit");
  if (skippedRate > 0.25) warnings.push("Many skipped rows");
  if (test.goalRate < 0.03 || test.goalRate > 0.35) warnings.push("Unusual goal rate");
  if (!psxg) warnings.push("PSxG needs ball_x, ball_y, gk_x and gk_y columns");
  return warnings;
}

function psxgTrainingFromCsv(parsedRows: Array<Record<string, string>>): PsxgTraining | undefined {
  const scored = parsedRows.flatMap((row) => {
    const goal = csvGoal(row);
    const rawShotX = csvNumber(row, SHOT_X_COLUMNS);
    const rawShotY = csvNumber(row, SHOT_Y_COLUMNS);
    const ballX = csvNumber(row, ["ball_x", "goal_x", "post_shot_x", "end_x"]);
    const ballY = csvNumber(row, ["ball_y", "goal_y", "post_shot_y", "end_y"]);
    const gkX = csvNumber(row, ["gk_x", "keeper_x", "goalkeeper_x"]);
    const gkY = csvNumber(row, ["gk_y", "keeper_y", "goalkeeper_y"]);
    if (goal == null || rawShotX == null || rawShotY == null || ballX == null || ballY == null || gkX == null || gkY == null) return [];

    const shot: Point = rawShotX <= P_L ? [rawShotX, rawShotY <= P_W ? rawShotY : rawShotY * P_W / 80] : [rawShotX * P_L / 120, rawShotY * P_W / 80];
    const ball: Point = [clamp(ballX <= 1 ? ballX * GOAL_W : ballX, 0.01, GOAL_W - 0.01), clamp(ballY <= 1 ? ballY * GOAL_H : ballY, 0.01, GOAL_H - 0.01)];
    const gk: Point = [clamp(gkX <= 1 ? gkX * GOAL_W : gkX, 0.5, GOAL_W - 0.5), clamp(gkY <= 1 ? gkY * GOAL_H : gkY, 0, 1.5)];
    const speed = csvNumber(row, ["shot_speed", "speed"]) ?? 85;
    const curve = Math.abs(csvNumber(row, ["shot_curve", "curve"]) ?? 0) / 100;
    const dip = (csvNumber(row, ["shot_dip", "dip"]) ?? 0) / 100;
    const knuckle = (csvNumber(row, ["shot_knuckle", "knuckle"]) ?? 0) / 100;
    const craft = Math.min(0.18, curve * 0.055 + clamp(dip, 0, 1) * 0.08 + clamp(knuckle, 0, 1) * 0.07);

    return [{ goal, psxg: calcPhysics(ball, gk, speed, distM(shot), craft).psxg }];
  });

  if (scored.length < 20) return undefined;

  const predicted = scored.reduce((sum, row) => sum + row.psxg, 0) / scored.length;
  const actual = scored.reduce((sum, row) => sum + row.goal, 0) / scored.length;
  return {
    rows: scored.length,
    predicted,
    actual,
    suggestedGkReaction: clamp(1 + (actual - predicted) * 1.8, 0.25, 2),
  };
}

function trainCalibrationFromCsv(text: string, name: string): TrainingReport {
  const parsedRows = parseCsv(text);
  const { quality, rows } = dataQuality(parsedRows);
  if (rows.length < 30) return { error: "Need at least 30 valid rows with goal, shot_x and shot_y columns." };

  const shuffled = seededShuffle(rows);
  const splitIndex = Math.max(12, Math.floor(shuffled.length * 0.8));
  const trainRows = shuffled.slice(0, splitIndex);
  const testRows = shuffled.slice(splitIndex);
  let weights = [0, 1, 1, 1, 1];
  const learningRate = 0.08;
  const l2 = 0.002;

  for (let step = 0; step < 650; step += 1) {
    const gradients = [0, 0, 0, 0, 0];
    for (const row of trainRows) {
      const error = predictTrainingRow(weights, row.features) - row.goal;
      gradients[0] += error;
      row.features.forEach((feature, i) => {
        gradients[i + 1] += error * feature + l2 * weights[i + 1];
      });
    }
    weights = weights.map((weight, i) => weight - learningRate * gradients[i] / trainRows.length);
  }

  const train = trainingMetrics(trainRows, weights);
  const test = trainingMetrics(testRows.length ? testRows : trainRows, weights);
  const psxg = psxgTrainingFromCsv(parsedRows);
  const confidence = modelConfidence(train, test, quality);
  const warnings = modelWarnings(train, test, quality, psxg);
  const goals = rows.reduce((sum, row) => sum + row.goal, 0);

  const calibration: Required<ModelCalibration> = {
    distanceWeight: clamp(Math.abs(weights[1]), 0.25, 2),
    angleWeight: clamp(Math.abs(weights[2]), 0.25, 2),
    wallPenalty: clamp(Math.abs(weights[3]), 0.25, 2),
    craftBonus: clamp(Math.abs(weights[4]), 0.25, 2),
    gkReaction: psxg?.suggestedGkReaction ?? 1,
  };
  const model: TrainedModel = {
    id: makeScenarioId(),
    name: (name.trim() || "Trained model").slice(0, 64),
    calibration,
    rows: rows.length,
    goalRate: goals / rows.length,
    loss: test.loss,
    train,
    test,
    coefficients: weights.map((weight) => +weight.toFixed(5)),
    features: TRAINING_FEATURES.map((feature) => feature.name),
    quality,
    importance: featureImportance(weights),
    confidence,
    warnings,
    psxg,
    notes: "",
    createdAt: Date.now(),
  };

  return { rows: rows.length, skipped: quality.skipped, quality, train, test, confidence, warnings, model };
}

function calcPhysics(ball: Point, gk: Point, speed: number, shotDistance: number, craftBonus = 0, calibration: Required<ModelCalibration> = DEFAULT_CALIBRATION): PsxgCalc {
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

function swingPath(s: Point, e: Point, swing: string) {
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

function goalPointToSvg([x, y]: Point) {
  return [16 + x * 100, 16 + (GOAL_H - y) * 100] as Point;
}

function footAdjustedCurve(curve: number, foot: string) {
  return foot === "Left Foot" ? -curve : curve;
}

function fmt(v: number, digits = 3) {
  if (!Number.isFinite(v)) return "-";
  return v.toFixed(digits);
}

function signed(v: number, digits = 3) {
  if (!Number.isFinite(v)) return "-";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

function xgMath(result: XgResponse | null, state: LabState, modelShot: Point, isDirect: boolean, calibration: Required<ModelCalibration>) {
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
    const wallTerm = -Number(derived.wall_size ?? state.wallSize) * 0.09 * calibration.wallPenalty;
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

function directFreeKickVisual(start: Point, target: Point, curve: number, dip: number, knuckle: number) {
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

export default function DeadballLab() {
  const [state, setState] = useState<LabState>(initialState);
  const [scenarioName, setScenarioName] = useState("Near-post corner");
  const [activePreset, setActivePreset] = useState<PresetKey | null>("nearPost");
  const [saveName, setSaveName] = useState("Custom setup");
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([]);
  const [selectedSavedId, setSelectedSavedId] = useState("");
  const [trainedModels, setTrainedModels] = useState<TrainedModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelName, setModelName] = useState("Custom trained model");
  const [trainingReport, setTrainingReport] = useState<TrainingReport | null>(null);
  const [result, setResult] = useState<XgResponse | null>(null);
  const [heat, setHeat] = useState<GridResponse["grid"]>([]);
  const [drag, setDrag] = useState<DragTarget>(null);
  const [goalDrag, setGoalDrag] = useState<GoalDrag>(null);
  const pitchRef = useRef<SVGSVGElement | null>(null);
  const goalRef = useRef<SVGSVGElement | null>(null);

  const isDirect = state.spType === "freekick-direct";
  const isFreeKick = state.spType.startsWith("freekick");
  const isCorner = state.spType.startsWith("corner");
  const modelShot = isDirect ? state.start : state.shot;
  const directFoot = isDirect && state.body === "Left Foot" ? "Left Foot" : "Right Foot";
  const effectiveCurve = footAdjustedCurve(state.curve, directFoot);
  const craftBonus = isDirect ? Math.min(0.18, Math.abs(state.curve) / 100 * 0.055 + state.dip / 100 * 0.08 + state.knuckle / 100 * 0.07) : 0;
  const psxg = useMemo(() => calcPhysics(state.ball, state.gkf, state.shotSpeed, distM(modelShot), craftBonus, state.calibration), [state.ball, state.calibration, state.gkf, state.shotSpeed, modelShot, craftBonus]);
  const combined = result ? result.xg * psxg.psxg : null;
  const wallPlayers = useMemo(() => {
    if (!isFreeKick || state.wallSize <= 0) return [];
    const [sx, sy] = state.start;
    const dx = GX - sx;
    const dy = GY - sy;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const nx = -uy;
    const ny = ux;
    const cx = sx + ux * state.wallDistance + nx * state.wallShift;
    const cy = sy + uy * state.wallDistance + ny * state.wallShift;
    return Array.from({ length: Math.round(state.wallSize) }, (_, i) => {
      const offset = (i - (state.wallSize - 1) / 2) * 0.82;
      return [clamp(cx + nx * offset, X0, X1), clamp(cy + ny * offset, 0, 68)] as Point;
    });
  }, [isFreeKick, state.start, state.wallDistance, state.wallShift, state.wallSize]);

  useEffect(() => {
    const scenarios = readSavedScenarios();
    setSavedScenarios(scenarios);
    setSelectedSavedId(scenarios[0]?.id ?? "");
  }, []);

  useEffect(() => {
    const models = readTrainedModels();
    setTrainedModels(models);
    setSelectedModelId(models[0]?.id ?? "");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const [shot_x, shot_y] = toSB(modelShot);
        const payload = {
          setpiece_type: state.spType,
          shot_x,
          shot_y,
          gk: toSB(state.gk),
          defenders: [...state.defenders, ...wallPlayers].map(toSB),
          attackers: state.attackers.map(toSB),
          delivery_technique: isDirect ? "" : state.swing,
          delivery_height: isDirect ? "" : state.height,
          corner_side: state.spType === "corner-right" ? "right" : state.spType === "corner-left" ? "left" : "",
          body_part: isDirect ? directFoot : state.body,
          shot_type: isDirect ? "Free Kick" : "",
          shot_speed: isDirect ? state.shotSpeed : undefined,
          shot_curve: isDirect ? effectiveCurve : undefined,
          shot_dip: isDirect ? state.dip : undefined,
          shot_knuckle: isDirect ? state.knuckle : undefined,
          calibration: state.calibration,
        };
        const res = await fetch("/api/calculate_xg", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        setResult(await res.json() as XgResponse);
      } catch (error) {
        if (!isAbortError(error)) throw error;
      }
    }, 120);

    return () => {
      window.clearTimeout(timer);
      controller.abort(new DOMException("Deadball xG request superseded", "AbortError"));
    };
  }, [effectiveCurve, isDirect, modelShot, state.attackers, state.body, state.calibration, state.defenders, state.dip, state.gk, state.height, state.knuckle, state.shotSpeed, state.spType, state.swing, wallPlayers]);

  useEffect(() => {
    if (!state.showHeat) {
      setHeat([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/calculate_xg_grid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            setpiece_type: state.spType,
            gk: toSB(state.gk),
            defenders: [...state.defenders, ...wallPlayers].map(toSB),
            attackers: state.attackers.map(toSB),
            delivery_technique: isDirect ? "" : state.swing,
            delivery_height: isDirect ? "" : state.height,
            corner_side: state.spType === "corner-right" ? "right" : state.spType === "corner-left" ? "left" : "",
            body_part: isDirect ? directFoot : state.body,
            shot_type: isDirect ? "Free Kick" : "",
            shot_speed: isDirect ? state.shotSpeed : undefined,
            shot_curve: isDirect ? effectiveCurve : undefined,
            shot_dip: isDirect ? state.dip : undefined,
            shot_knuckle: isDirect ? state.knuckle : undefined,
            calibration: state.calibration,
          }),
          signal: controller.signal,
        });
        const data = await res.json() as GridResponse;
        setHeat(data.grid.map((c) => ({ x: c.x * P_L / 120, y: c.y * P_W / 80, xg: c.xg })));
      } catch (error) {
        if (!isAbortError(error)) throw error;
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort(new DOMException("Deadball xG grid request superseded", "AbortError"));
    };
  }, [effectiveCurve, isDirect, state.attackers, state.body, state.calibration, state.defenders, state.dip, state.gk, state.height, state.knuckle, state.shotSpeed, state.showHeat, state.spType, state.swing, wallPlayers]);

  useEffect(() => {
    const up = () => {
      setDrag(null);
      setGoalDrag(null);
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const update = (patch: Partial<LabState>) => {
    setState((s) => ({ ...s, ...patch }));
    setActivePreset(null);
  };
  const updateCalibration = (patch: Partial<ModelCalibration>) => {
    update({ calibration: calibrationOr({ ...state.calibration, ...patch }) });
  };
  const persistSavedScenarios = (scenarios: SavedScenario[]) => {
    setSavedScenarios(scenarios);
    writeSavedScenarios(scenarios);
  };
  const saveScenario = () => {
    const name = (saveName.trim() || scenarioName.trim() || "Custom setup").slice(0, 64);
    const now = Date.now();
    const existing = savedScenarios.find((s) => s.name.toLowerCase() === name.toLowerCase());
    const saved: SavedScenario = {
      id: existing?.id ?? makeScenarioId(),
      name,
      state,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const next = existing ? savedScenarios.map((s) => (s.id === existing.id ? saved : s)) : [saved, ...savedScenarios];
    persistSavedScenarios(next);
    setSelectedSavedId(saved.id);
    setScenarioName(name);
    setActivePreset(null);
  };
  const loadScenario = () => {
    const saved = savedScenarios.find((s) => s.id === selectedSavedId);
    if (!saved) return;
    setState(saved.state);
    setScenarioName(saved.name);
    setSaveName(saved.name);
    setActivePreset(null);
  };
  const deleteScenario = () => {
    const next = savedScenarios.filter((s) => s.id !== selectedSavedId);
    persistSavedScenarios(next);
    setSelectedSavedId(next[0]?.id ?? "");
  };
  const persistTrainedModels = (models: TrainedModel[]) => {
    setTrainedModels(models);
    writeTrainedModels(models);
  };
  const applyTrainedModel = (modelId = selectedModelId) => {
    const model = trainedModels.find((item) => item.id === modelId);
    if (!model) return;
    update({ calibration: model.calibration });
    setSelectedModelId(model.id);
    setModelName(model.name);
  };
  const deleteTrainedModel = () => {
    const next = trainedModels.filter((item) => item.id !== selectedModelId);
    persistTrainedModels(next);
    setSelectedModelId(next[0]?.id ?? "");
  };
  const exportTrainedModel = () => {
    const model = trainedModels.find((item) => item.id === selectedModelId);
    if (!model) return;
    const blob = new Blob([JSON.stringify(model, null, 2)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${model.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trained-model"}.json`;
    link.click();
    window.URL.revokeObjectURL(url);
  };
  const importTrainedModel = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text()) as Partial<TrainedModel>;
      if (typeof parsed.name !== "string" || !parsed.calibration) {
        setTrainingReport({ error: "That JSON file is not a valid trained model." });
        return;
      }
      const model: TrainedModel = {
        id: typeof parsed.id === "string" ? parsed.id : makeScenarioId(),
        name: parsed.name.slice(0, 64),
        calibration: calibrationOr(parsed.calibration),
        rows: numberOr(parsed.rows, 0),
        goalRate: numberOr(parsed.goalRate, 0),
        loss: numberOr(parsed.loss, 0),
        train: parsed.train,
        test: parsed.test,
        coefficients: parsed.coefficients,
        features: parsed.features,
        quality: parsed.quality,
        importance: parsed.importance,
        confidence: parsed.confidence,
        warnings: parsed.warnings,
        psxg: parsed.psxg,
        notes: typeof parsed.notes === "string" ? parsed.notes : "",
        createdAt: numberOr(parsed.createdAt, Date.now()),
      };
      const next = [model, ...trainedModels.filter((item) => item.id !== model.id)];
      persistTrainedModels(next);
      setSelectedModelId(model.id);
      setModelName(model.name);
      setTrainingReport(null);
    } catch {
      setTrainingReport({ error: "Could not read that trained model JSON file." });
    }
  };
  const trainFromCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const report = trainCalibrationFromCsv(await file.text(), modelName);
    setTrainingReport(report);
    if ("error" in report) return;

    const next = [report.model, ...trainedModels.filter((model) => model.name.toLowerCase() !== report.model.name.toLowerCase())];
    persistTrainedModels(next);
    setSelectedModelId(report.model.id);
    setModelName(report.model.name);
  };
  const downloadCsvTemplate = () => {
    const template = [
      "goal,shot_x,shot_y,wall_size,shot_curve,shot_dip,shot_knuckle,shot_speed,ball_x,ball_y,gk_x,gk_y",
      "1,84,32,4,62,58,12,92,6.7,1.8,3.55,0.45",
      "0,101.5,31.5,0,0,0,0,78,3.1,1.2,3.66,0.5",
    ].join("\n");
    const blob = new Blob([template], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "deadball-training-template.csv";
    link.click();
    window.URL.revokeObjectURL(url);
  };
  const resetDefaultModel = () => {
    update({ calibration: DEFAULT_CALIBRATION });
    setSelectedModelId("");
  };
  const updateSelectedModelNotes = (notes: string) => {
    if (!selectedModelId) return;
    const next = trainedModels.map((model) => model.id === selectedModelId ? { ...model, notes } : model);
    persistTrainedModels(next);
  };
  const pitchPoint = (e: PointerEvent<SVGSVGElement>): Point => {
    const r = pitchRef.current!.getBoundingClientRect();
    return [
      clamp(+(X0 + ((e.clientX - r.left) / r.width) * VW).toFixed(1), X0, X1),
      clamp(+(((e.clientY - r.top) / r.height) * VH).toFixed(1), 0, 68),
    ];
  };
  const goalPoint = (e: PointerEvent<SVGSVGElement>): Point => {
    const r = goalRef.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 764;
    const y = ((e.clientY - r.top) / r.height) * 280;
    return [clamp((x - 16) / 100, 0.01, GOAL_W - 0.01), clamp(GOAL_H - (y - 16) / 100, 0.01, GOAL_H - 0.01)];
  };

  const onPitchMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = pitchPoint(e);
    setScenarioName("Custom setup");
    if (drag.kind === "shot") update({ shot: p });
    if (drag.kind === "gk") update({ gk: p });
    if (drag.kind === "start" && !isCorner) update({ start: state.spType.startsWith("throwin") ? [p[0], p[1] < 34 ? 0.5 : 67.5] : p });
    if (drag.kind === "def" && drag.index != null) update({ defenders: state.defenders.map((d, i) => (i === drag.index ? p : d)) });
    if (drag.kind === "atk" && drag.index != null) update({ attackers: state.attackers.map((a, i) => (i === drag.index ? p : a)) });
  };

  const onGoalMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!goalDrag) return;
    const p = goalPoint(e);
    if (goalDrag === "ball") update({ ball: p });
    else update({ gkf: [clamp(p[0], 0.5, GOAL_W - 0.5), clamp(p[1], 0, 1.5)] });
  };

  const applyPreset = (key: PresetKey) => {
    const preset = PRESETS[key];
    setState((s) => ({ ...s, ...preset, showHeat: s.showHeat, showVor: s.showVor } as LabState));
    setScenarioName(preset.name);
    setActivePreset(key);
  };

  const directTarget: Point = [GX, clamp(GY - GOAL_W / 2 + state.ball[0], GY - GOAL_W / 2, GY + GOAL_W / 2)];
  const directVisual = isDirect ? directFreeKickVisual(state.start, directTarget, effectiveCurve, state.dip, state.knuckle) : null;
  const shotPath = directVisual?.path ?? swingPath(state.start, state.shot, state.swing);
  const [ballSvgX, ballSvgY] = goalPointToSvg(state.ball);
  const [gkSvgX, gkSvgY] = goalPointToSvg(state.gkf);
  const xgSolution = xgMath(result, state, modelShot, isDirect, state.calibration);
  const selectedTrainedModel = trainedModels.find((model) => model.id === selectedModelId) ?? null;
  const defaultModelResult = useMemo(() => {
    const [shot_x, shot_y] = toSB(modelShot);
    return predict({
      setpiece_type: state.spType,
      shot_x,
      shot_y,
      gk: toSB(state.gk),
      defenders: [...state.defenders, ...wallPlayers].map(toSB),
      attackers: state.attackers.map(toSB),
      delivery_technique: isDirect ? "" : state.swing,
      delivery_height: isDirect ? "" : state.height,
      corner_side: state.spType === "corner-right" ? "right" : state.spType === "corner-left" ? "left" : "",
      body_part: isDirect ? directFoot : state.body,
      shot_type: isDirect ? "Free Kick" : "",
      shot_speed: isDirect ? state.shotSpeed : undefined,
      shot_curve: isDirect ? effectiveCurve : undefined,
      shot_dip: isDirect ? state.dip : undefined,
      shot_knuckle: isDirect ? state.knuckle : undefined,
      calibration: DEFAULT_CALIBRATION,
    });
  }, [directFoot, effectiveCurve, isDirect, modelShot, state.attackers, state.body, state.defenders, state.dip, state.gk, state.height, state.knuckle, state.shotSpeed, state.spType, state.swing, wallPlayers]);
  const selectedModelResult = useMemo(() => {
    if (!selectedTrainedModel) return null;
    const [shot_x, shot_y] = toSB(modelShot);
    return predict({
      setpiece_type: state.spType,
      shot_x,
      shot_y,
      gk: toSB(state.gk),
      defenders: [...state.defenders, ...wallPlayers].map(toSB),
      attackers: state.attackers.map(toSB),
      delivery_technique: isDirect ? "" : state.swing,
      delivery_height: isDirect ? "" : state.height,
      corner_side: state.spType === "corner-right" ? "right" : state.spType === "corner-left" ? "left" : "",
      body_part: isDirect ? directFoot : state.body,
      shot_type: isDirect ? "Free Kick" : "",
      shot_speed: isDirect ? state.shotSpeed : undefined,
      shot_curve: isDirect ? effectiveCurve : undefined,
      shot_dip: isDirect ? state.dip : undefined,
      shot_knuckle: isDirect ? state.knuckle : undefined,
      calibration: selectedTrainedModel.calibration,
    });
  }, [directFoot, effectiveCurve, isDirect, modelShot, selectedTrainedModel, state.attackers, state.body, state.defenders, state.dip, state.gk, state.height, state.knuckle, state.shotSpeed, state.spType, state.swing, wallPlayers]);
  const selectedModelPsxg = selectedTrainedModel ? calcPhysics(state.ball, state.gkf, state.shotSpeed, distM(modelShot), craftBonus, selectedTrainedModel.calibration) : null;
  const selectedCombined = selectedModelResult && selectedModelPsxg ? selectedModelResult.xg * selectedModelPsxg.psxg : null;
  const selectedXgDelta = selectedModelResult ? selectedModelResult.xg - defaultModelResult.xg : null;
  const confidence = selectedTrainedModel?.confidence ?? (selectedTrainedModel?.train && selectedTrainedModel?.test && selectedTrainedModel?.quality ? modelConfidence(selectedTrainedModel.train, selectedTrainedModel.test, selectedTrainedModel.quality) : null);
  const retrainWarnings = selectedTrainedModel?.warnings ?? [];
  const recommendation = result ? recommendationFor(result, combined, isDirect) : "Move the shot marker or load a preset to generate a tactical read.";

  return (
    <>
      <header className="topbar">
        <div>
          <h1>TactiSet <span className="tag">Set-piece xG</span></h1>
          <p className="sub">A tactical set-piece lab rebuilt as a Next.js and React TypeScript app.</p>
        </div>
        <div className="top-actions">
          <span className="model-pill">36,055 source shots</span>
          <a className="health" href="/api/health" target="_blank">API health</a>
        </div>
      </header>

      <section className="scenario-strip">
        {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
          <button key={key} className={`preset ${activePreset === key ? "on" : ""}`} onClick={() => applyPreset(key)}>{PRESETS[key].name}</button>
        ))}
      </section>

      <main className="grid">
        <aside className="panel controls">
          <div className="panel-head"><span>Scenario</span><b>{scenarioName}</b></div>
          <div className="scenario-library">
            <div className="fk-title">Scenario library</div>
            <label>Name
              <input type="text" value={saveName} maxLength={64} onChange={(e) => setSaveName(e.target.value)} />
            </label>
            <div className="scenario-actions">
              <button className="btn" onClick={saveScenario}>Save</button>
              <button className="btn" onClick={loadScenario} disabled={!selectedSavedId}>Load</button>
              <button className="btn danger" onClick={deleteScenario} disabled={!selectedSavedId}>Delete</button>
            </div>
            <label>Saved setups
              <select value={selectedSavedId} onChange={(e) => {
                const id = e.target.value;
                const saved = savedScenarios.find((s) => s.id === id);
                setSelectedSavedId(id);
                if (saved) setSaveName(saved.name);
              }}>
                {savedScenarios.length === 0 && <option value="">No saved setups</option>}
                {savedScenarios.map((saved) => <option key={saved.id} value={saved.id}>{saved.name}</option>)}
              </select>
            </label>
          </div>
          <label>Set piece
            <select value={state.spType} onChange={(e) => {
              const spType = e.target.value;
              update({ spType, start: defaultStart(spType), wallSize: spType === "freekick-direct" ? 4 : spType === "freekick-cross" ? 3 : 0, body: spType === "freekick-direct" && state.body === "Head" ? "Right Foot" : state.body });
              setScenarioName("Custom setup");
            }}>
              <option value="corner-right">Corner (right)</option>
              <option value="corner-left">Corner (left)</option>
              <option value="freekick-cross">Free kick (crossed)</option>
              <option value="freekick-direct">Free kick (direct)</option>
              <option value="throwin-long">Throw-in (long)</option>
              <option value="throwin-short">Throw-in (short)</option>
            </select>
          </label>
          {!isDirect && <>
            <label>Swing<select value={state.swing} onChange={(e) => update({ swing: e.target.value })}><option>Inswinging</option><option>Outswinging</option><option>Straight</option></select></label>
            <label>Height<select value={state.height} onChange={(e) => update({ height: e.target.value })}><option>High Pass</option><option>Low Pass</option><option>Ground Pass</option></select></label>
          </>}
          <label>Finish / foot<select value={isDirect ? directFoot : state.body} onChange={(e) => update({ body: e.target.value })}><option hidden={isDirect}>Head</option><option>Right Foot</option><option>Left Foot</option></select></label>
          {isDirect && <div className="direct-fk-card open">
            <div className="fk-title">Direct FK craft</div>
            <Slider label="Curve" value={state.curve} min={-100} max={100} onChange={(curve) => update({ curve })} suffix={state.curve === 0 ? " straight" : " bend"} />
            <Slider label="Dip" value={state.dip} min={0} max={100} onChange={(dip) => update({ dip })} />
            <Slider label="Knuckle" value={state.knuckle} min={0} max={100} onChange={(knuckle) => update({ knuckle })} />
          </div>}
          {isFreeKick && <div className="fk-wall-card open">
            <div className="fk-title">Free kick wall</div>
            <Slider label="Wall size" value={state.wallSize} min={0} max={6} step={1} onChange={(wallSize) => update({ wallSize })} suffix=" players" />
            <Slider label="Wall distance" value={state.wallDistance} min={5} max={12} step={0.5} onChange={(wallDistance) => update({ wallDistance })} suffix=" m" />
            <Slider label="Wall shift" value={state.wallShift} min={-3} max={3} step={0.5} onChange={(wallShift) => update({ wallShift })} suffix=" m" />
          </div>}
          <div className="tool-row">
            <button className="btn" onClick={() => update({ defenders: [...state.defenders, [96, 34]] })}>+ DEF</button>
            <button className="btn" onClick={() => update({ defenders: state.defenders.slice(0, -1) })}>- DEF</button>
            <button className="btn" onClick={() => update({ attackers: [...state.attackers, [98, 38]] })}>+ ATK</button>
            <button className="btn" onClick={() => update({ attackers: state.attackers.slice(0, -1) })}>- ATK</button>
          </div>
          <div className="tool-row">
            <button className={`btn toggle ${state.showHeat ? "on" : ""}`} onClick={() => update({ showHeat: !state.showHeat })}>xG heatmap</button>
            <button className={`btn toggle ${state.showVor ? "on" : ""}`} onClick={() => update({ showVor: !state.showVor })}>Voronoi</button>
          </div>
          <div className="training-card open">
            <div className="panel-row-title">
              <div className="fk-title">Retrain model</div>
            </div>
            <label>Model name
              <input type="text" value={modelName} maxLength={64} onChange={(e) => setModelName(e.target.value)} />
            </label>
            <label>Training CSV
              <input type="file" accept=".csv,text/csv" onChange={trainFromCsv} />
            </label>
            <label>Import model JSON
              <input type="file" accept=".json,application/json" onChange={importTrainedModel} />
            </label>
            <div className="tool-row">
              <button className="btn" onClick={downloadCsvTemplate}>CSV template</button>
              <button className="btn" onClick={resetDefaultModel}>Reset model</button>
            </div>
            <div className="scenario-actions">
              <button className="btn" onClick={() => applyTrainedModel()} disabled={!selectedModelId}>Apply</button>
              <button className="btn" onClick={exportTrainedModel} disabled={!selectedModelId}>Export</button>
              <button className="btn danger" onClick={deleteTrainedModel} disabled={!selectedModelId}>Delete</button>
            </div>
            <label>Trained models
              <select value={selectedModelId} onChange={(e) => {
                const id = e.target.value;
                const model = trainedModels.find((item) => item.id === id);
                setSelectedModelId(id);
                if (model) setModelName(model.name);
              }}>
                {trainedModels.length === 0 && <option value="">No trained models</option>}
                {trainedModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
              </select>
            </label>
            <label>Model notes
              <textarea value={selectedTrainedModel?.notes ?? ""} onChange={(e) => updateSelectedModelNotes(e.target.value)} placeholder="Dataset, league, season, filter..." disabled={!selectedTrainedModel} />
            </label>
            <div className="training-stats">
              <Row k="Default / selected" v={`${pct(defaultModelResult.xg)} / ${selectedModelResult ? pct(selectedModelResult.xg) : "--"}`} />
              <Row k="Before / after" v={selectedModelResult && selectedXgDelta != null ? `${pct(defaultModelResult.xg)} -> ${pct(selectedModelResult.xg)} (${signed(selectedXgDelta * 100, 1)} pts)` : "--"} />
              <Row k="Active xG" v={pct(result?.xg)} />
              <Row k="PSxG preview" v={selectedModelPsxg ? `${pct(psxg.psxg)} -> ${pct(selectedModelPsxg.psxg)}` : "--"} />
              <Row k="Combined preview" v={selectedCombined != null ? pct(selectedCombined) : "--"} />
              {confidence && <Row k="Confidence" v={`${confidence.label} (${confidence.score}/100)`} />}
              {selectedTrainedModel?.test && <>
                <Row k="Test loss / Brier" v={`${fmt(selectedTrainedModel.test.loss)} / ${fmt(selectedTrainedModel.test.brier)}`} />
                <Row k="Test acc / AUC" v={`${pct(selectedTrainedModel.test.accuracy)} / ${fmt(selectedTrainedModel.test.auc)}`} />
              </>}
              {selectedTrainedModel?.quality && <>
                <Row k="Data quality" v={`${selectedTrainedModel.quality.valid} valid / ${selectedTrainedModel.quality.skipped} skipped`} />
                <Row k="Skip reasons" v={`goal ${selectedTrainedModel.quality.missingGoal}, x ${selectedTrainedModel.quality.missingShotX}, y ${selectedTrainedModel.quality.missingShotY}, number ${selectedTrainedModel.quality.invalidNumber}`} />
              </>}
              {selectedTrainedModel?.importance?.slice(0, 4).map((feature) => (
                <Row key={feature.name} k={feature.label} v={`${pct(feature.share)} (${feature.direction})`} />
              ))}
              {selectedTrainedModel?.psxg && <Row k="PSxG training" v={`${selectedTrainedModel.psxg.rows} rows, GK reaction ${fmt(selectedTrainedModel.psxg.suggestedGkReaction, 2)}x`} />}
              {retrainWarnings.length > 0 && <Row k="Warnings" v={retrainWarnings.join(", ")} />}
              {trainingReport && "error" in trainingReport && <Row k="Training" v={trainingReport.error} />}
              {trainingReport && !("error" in trainingReport) && <>
                <Row k="Rows / skipped" v={`${trainingReport.rows} / ${trainingReport.skipped}`} />
                <Row k="Skipped reasons" v={`goal ${trainingReport.quality.missingGoal}, x ${trainingReport.quality.missingShotX}, y ${trainingReport.quality.missingShotY}, number ${trainingReport.quality.invalidNumber}`} />
                <Row k="Train / test rows" v={`${trainingReport.train.rows} / ${trainingReport.test.rows}`} />
                <Row k="Goal rate" v={`${pct(trainingReport.train.goalRate)} train / ${pct(trainingReport.test.goalRate)} test`} />
                <Row k="Train / test loss" v={`${fmt(trainingReport.train.loss)} / ${fmt(trainingReport.test.loss)}`} />
                <Row k="Test accuracy / AUC" v={`${pct(trainingReport.test.accuracy)} / ${fmt(trainingReport.test.auc)}`} />
                <Row k="New confidence" v={`${trainingReport.confidence.label} (${trainingReport.confidence.score}/100)`} />
                {trainingReport.warnings.length > 0 && <Row k="New warnings" v={trainingReport.warnings.join(", ")} />}
              </>}
            </div>
          </div>
          <div className="mini-card"><span>Pitch mode</span><b>105 x 68 m</b></div>
        </aside>

        <section className="panel pitchpanel">
          <div className="panel-head"><span>Live pitch</span><b>Drag to edit</b></div>
          <svg ref={pitchRef} viewBox="55 0 50 68" preserveAspectRatio="xMidYMid meet" className="pitch" onPointerMove={onPitchMove}>
            <PitchMarks />
            {state.showVor && <Voronoi defenders={[...state.defenders, ...wallPlayers]} attackers={state.attackers} gk={state.gk} />}
            {heat.map((c, i) => <rect key={i} x={c.x - 1.1} y={c.y - 1.3} width="2.2" height="2.6" fill={heatColor(c.xg)} opacity="0.5" />)}
            {directVisual && state.dip > 0 && <path d={directVisual.dipPath} fill="none" stroke="#fff9d6" strokeWidth={0.16 + state.dip / 230} strokeDasharray="0.8 1" opacity={0.15 + state.dip / 170} />}
            <path d={shotPath} fill="none" stroke="#d7f25c" strokeWidth="0.48" strokeDasharray="1.2 0.8" />
            {directVisual && state.dip > 0 && directVisual.heightMarks.map((mark, i) => <circle key={`dip${i}`} cx={mark.x} cy={mark.y} r={mark.radius} fill="#fff9d6" opacity={mark.opacity} />)}
            {state.attackers.map((a, i) => <Player key={`a${i}`} p={a} color="#2dd4bf" onPointerDown={() => setDrag({ kind: "atk", index: i })} />)}
            {state.defenders.map((d, i) => <Player key={`d${i}`} p={d} color="#ff5a5f" onPointerDown={() => setDrag({ kind: "def", index: i })} />)}
            {wallPlayers.map((d, i) => <g key={`w${i}`}><Player p={d} color="#f6b73c" /><text x={d[0]} y={d[1] + 0.34} textAnchor="middle" fontSize="0.82" fill="#241706" fontWeight="bold">W</text></g>)}
            <Player p={state.gk} color="#d7f25c" label="GK" onPointerDown={() => setDrag({ kind: "gk" })} />
            <Player p={state.start} color="#d7f25c" radius={0.8} onPointerDown={() => setDrag({ kind: "start" })} />
            {!isDirect ? <>
              <line x1={state.shot[0]} y1={state.shot[1]} x2={GX} y2={GY} stroke="#ffffffaa" strokeWidth="0.25" strokeDasharray="1.2 0.8" />
              <Player p={state.shot} color="#fff" radius={1.12} onPointerDown={() => setDrag({ kind: "shot" })} />
            </> : <circle cx={directTarget[0]} cy={directTarget[1]} r="0.45" fill="#fff" stroke="#111" strokeWidth="0.2" />}
          </svg>
          <div className="legend"><Legend color="#fff9d6" text="Shot" /><Legend color="#d7f25c" text="Delivery / GK" /><Legend color="#ff5a5f" text="Defenders" /><Legend color="#2dd4bf" text="Attackers" /><Legend color="#f6b73c" text="Wall" /></div>
          <div className="pitch-math-grid">
            {xgSolution && <div className="calculation-card math-card">
              <div className="bk-title">xG calculation</div>
              <div className="equation">xG = clamp(1 / (1 + e^(-logit)), 0.006, 0.62)</div>
              <Row k="Base logit" v={fmt(xgSolution.base)} />
              <Row k="Terms" v={xgSolution.terms.map(([name, value]) => `${name} ${signed(value, 2)}`).join("  ")} />
              <Row k="Logit total" v={`${fmt(xgSolution.logit)} -> raw ${pct(xgSolution.rawXg)}`} />
              <Row k="Final xG" v={`${pct(xgSolution.clampedXg)} shown as ${pct(result?.xg)}`} />
            </div>}
            <div className="calculation-card math-card combined-math">
              <div className="bk-title">Combined</div>
              <div className="equation">Combined = xG x PSxG</div>
              <Row k="Calculation" v={`${pct(result?.xg)} x ${pct(psxg.psxg)} = ${pct(combined)}`} />
            </div>
          </div>
        </section>

        <section className="panel psxgpanel">
          <div className="panel-head"><span>Post-shot xG</span><b>GK biomechanics</b></div>
          <svg ref={goalRef} viewBox="0 0 764 280" className="goalframe" onPointerMove={onGoalMove}>
            <rect x="11" y="11" width="742" height="254" fill="none" stroke="#fff" strokeWidth="8" rx="2" />
            <rect x="16" y="16" width="732" height="244" fill="rgba(18,92,51,.42)" />
            {Array.from({ length: 4 }).map((_, c) => Array.from({ length: 3 }).map((__, r) => {
              const x = (c + 0.5) * GOAL_W / 4;
              const y = GOAL_H - (r + 0.5) * GOAL_H / 3;
              const v = calcPhysics([x, y], state.gkf, state.shotSpeed, distM(modelShot), craftBonus, state.calibration).psxg;
              return <g key={`${c}-${r}`}><rect x={16 + c * 183} y={16 + r * 81.33} width="183" height="81.33" fill={zoneFill(v)} stroke="rgba(255,255,255,.25)" /><text x={16 + c * 183 + 91.5} y={16 + r * 81.33 + 44} textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold">{v.toFixed(2)}</text></g>;
            }))}
            <ellipse cx={gkSvgX} cy={gkSvgY} rx={Math.max(50, (psxg.ballTime - 0.15) * GK_H * 100)} ry={Math.max(50, (psxg.ballTime - 0.15) * GK_V * 100)} fill="rgba(45,212,191,.16)" stroke="rgba(45,212,191,.9)" strokeDasharray="6 4" />
            <GoalkeeperFigure x={gkSvgX} y={gkSvgY} onPointerDown={() => setGoalDrag("gk")} />
            <g onPointerDown={() => setGoalDrag("ball")} className="grab"><circle cx={ballSvgX} cy={ballSvgY} r="16" fill="#fff" stroke="#333" strokeWidth="2" /><text x={ballSvgX} y={ballSvgY + 29} textAnchor="middle" fill="#fff" fontSize="12" fontWeight="bold">BALL</text></g>
          </svg>
          <Slider label="Shot speed" value={state.shotSpeed} min={40} max={140} onChange={(shotSpeed) => update({ shotSpeed })} suffix=" km/h" />
          <div className="metrics">
            <Metric k="Ball time" v={`${psxg.ballTime.toFixed(3)}s`} />
            <Metric k="GK reach" v={`${psxg.diveTime.toFixed(3)}s`} />
            <Metric k="Margin" v={`${psxg.margin > 0 ? "+" : ""}${psxg.margin.toFixed(3)}s`} />
            <Metric k="GK dive" v={`${psxg.diveDist.toFixed(2)}m`} />
            <Metric k="Difficulty" v={psxg.diff} />
            <Metric k="PSxG" v={pct(psxg.psxg)} />
          </div>
          <div className="formula-live">
            <span>Shot distance</span><b>{distM(modelShot).toFixed(2)} m</b>
            <span>Ball time</span><b>{distM(modelShot).toFixed(2)} / {psxg.speedMs.toFixed(2)} = {psxg.ballTime.toFixed(3)} s</b>
            <span>GK dx / dy</span><b>{psxg.hd.toFixed(2)} m / {psxg.vd.toFixed(2)} m</b>
            <span>GK reach</span><b>{psxg.reaction.toFixed(3)} + max({psxg.hTime.toFixed(3)}, {psxg.vTime.toFixed(3)}) = {psxg.diveTime.toFixed(3)} s</b>
          </div>
          <div className="calculation-card math-card psxg-calculation">
            <div className="bk-title">PSxG calculation</div>
            <div className="equation">PSxG = clamp(f(GK reach - ball time), 0.01, 0.99)</div>
            <Row k="Ball time" v={`${fmt(distM(modelShot), 2)} / ${fmt(psxg.speedMs, 2)} = ${fmt(psxg.ballTime)} s`} />
            <Row k="Reach time" v={`${fmt(psxg.reaction)} + max(${fmt(psxg.hTime)}, ${fmt(psxg.vTime)}) = ${fmt(psxg.diveTime)} s`} />
            <Row k="Time margin" v={`${signed(psxg.margin)} s -> ${pct(psxg.psxg)}`} />
          </div>
        </section>

        <aside className="cards">
          <Card label="Shot xG" value={pct(result?.xg)} big />
          <Card label="Set-piece value" value={pct(result?.setpiece_value)} note={`P(shot) = ${pct(result?.p_shot)}${isDirect ? " (direct FK = the shot)" : ""}`} />
          <Card label="Combined (xG x PSxG)" value={pct(combined)} note={`PSxG = ${pct(psxg.psxg)} (physics)`} />
          <div className="card small">
            <Row k="Zone" v={result?.zone ?? "-"} />
            <Row k="Distance" v={`${(result?.distance_to_goal ?? distM(modelShot)).toFixed(1)} m`} />
            <Row k="Marking" v={result?.marking_label || "-"} />
            <Row k="In box - def / atk" v={`${result?.derived.defenders_in_box ?? "-"} / ${result?.derived.attackers_in_box ?? "-"}`} />
            {isFreeKick && <Row k="Wall" v={`${result?.derived.wall_size ?? state.wallSize} players`} />}
            {isDirect && <Row k="Craft" v={`${Number(result?.derived.direct_craft_logit ?? 0).toFixed(3)} logit`} />}
            {isDirect && <Row k="Dip effect" v={`${Number(result?.derived.direct_dip_logit ?? 0).toFixed(3)} logit`} />}
            {isDirect && <Row k="Knuckle effect" v={`${Number(result?.derived.direct_knuckle_logit ?? 0).toFixed(3)} logit`} />}
          </div>
          <div className="card small insight"><div className="bk-title">Analyst note</div><div>{recommendation}</div></div>
        </aside>
      </main>

      <footer className="foot">TactiSet · Next.js TypeScript build · models approximated natively in TypeScript.</footer>
    </>
  );
}

function Slider({ label, value, min, max, step = 1, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return <label>{label} <b>{value.toFixed(digits)}{suffix}</b><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>;
}

function Player({ p, color, label, radius = 0.95, onPointerDown }: { p: Point; color: string; label?: string; radius?: number; onPointerDown?: () => void }) {
  return <g onPointerDown={onPointerDown} className={onPointerDown ? "grab" : undefined}><circle cx={p[0]} cy={p[1]} r={radius} fill={color} stroke="#fff9d6" strokeWidth="0.22" />{label && <text x={p[0]} y={p[1] + 0.35} textAnchor="middle" fontSize="0.9" fill="#15200c" fontWeight="bold">{label}</text>}</g>;
}

function GoalkeeperFigure({ x, y, onPointerDown }: { x: number; y: number; onPointerDown: () => void }) {
  return (
    <g onPointerDown={onPointerDown} className="grab">
      <line x1={x - 14} y1={y - 78} x2={x - 44} y2={y - 50} stroke="#ff5a5f" strokeWidth="11" strokeLinecap="round" />
      <line x1={x + 14} y1={y - 78} x2={x + 44} y2={y - 50} stroke="#ff5a5f" strokeWidth="11" strokeLinecap="round" />
      <circle cx={x - 49} cy={y - 46} r="9" fill="#fff" stroke="#17241b" strokeWidth="2" />
      <circle cx={x + 49} cy={y - 46} r="9" fill="#fff" stroke="#17241b" strokeWidth="2" />
      <line x1={x - 8} y1={y - 18} x2={x - 24} y2={y + 6} stroke="#17241b" strokeWidth="10" strokeLinecap="round" />
      <line x1={x + 8} y1={y - 18} x2={x + 24} y2={y + 6} stroke="#17241b" strokeWidth="10" strokeLinecap="round" />
      <line x1={x - 24} y1={y + 6} x2={x - 38} y2={y + 6} stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <line x1={x + 24} y1={y + 6} x2={x + 38} y2={y + 6} stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <rect x={x - 18} y={y - 104} width="36" height="90" rx="10" fill="#ff5a5f" stroke="#fff" strokeWidth="2" />
      <circle cx={x} cy={y - 118} r="12" fill="#f0bc8f" stroke="#fff" strokeWidth="2" />
      <text x={x} y={y - 60} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="bold">GK</text>
    </g>
  );
}

function PitchMarks() {
  return <><rect x={GX - 16.5} y={GY - 20.16} width="16.5" height="40.32" fill="none" stroke="#ffffff88" strokeWidth="0.3" /><rect x={GX - 5.5} y={GY - 9.16} width="5.5" height="18.32" fill="none" stroke="#ffffff88" strokeWidth="0.3" /><line x1={GX} y1={GY - 3.66} x2={GX} y2={GY + 3.66} stroke="#fff" strokeWidth="1" /><circle cx={GX - 11} cy={GY} r="0.5" fill="#fff" /><line x1={X0} y1="0" x2={X0} y2={P_W} stroke="#ffffff55" strokeWidth="0.3" /></>;
}

function Voronoi({ defenders, attackers, gk }: { defenders: Point[]; attackers: Point[]; gk: Point }) {
  const pts: Array<[Point, string]> = [...defenders.map((p) => [p, "#ff8a76"] as [Point, string]), ...attackers.map((p) => [p, "#6ee7d8"] as [Point, string]), [gk, "#d7f25c"]];
  const cells = [];
  for (let x = X0; x <= X1; x += 1.4) for (let y = 0; y <= 68; y += 1.4) {
    let best = Infinity;
    let col = "#5a6b5f";
    for (const [p, c] of pts) {
      const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
      if (d < best) {
        best = d;
        col = c;
      }
    }
    cells.push(<rect key={`${x}-${y}`} x={x - 0.7} y={y - 0.7} width="1.45" height="1.45" fill={col} opacity="0.32" />);
  }
  return <>{cells}</>;
}

function zoneFill(v: number) {
  if (v >= 0.8) return "rgba(255,90,95,.68)";
  if (v >= 0.65) return "rgba(255,111,72,.58)";
  if (v >= 0.5) return "rgba(246,183,60,.58)";
  if (v >= 0.35) return "rgba(215,242,92,.46)";
  if (v >= 0.25) return "rgba(45,212,191,.42)";
  return "rgba(34,126,86,.5)";
}

function recommendationFor(r: XgResponse, combined: number | null, isDirect: boolean) {
  const notes = [];
  if (r.xg >= 0.18) notes.push("High-quality shot profile. Keep the delivery target and protect the shooting lane.");
  else if (r.xg >= 0.1) notes.push("Useful chance quality. Small gains may come from moving the finish closer to goal.");
  else notes.push("Low shot quality. Try moving the target toward the six-yard box or central channel.");
  if (r.zone === "near-post" || r.zone === "far-post") notes.push(`${r.zone.replace("-", " ")} zones are strong set-piece targets.`);
  if (Number(r.derived.nearest_defender_dist) < 1.8) notes.push("The nearest defender is tight; create separation or add a screen runner.");
  if (isDirect) notes.push("Tune curve, dip and wall position to stress the keeper's reach window.");
  if (combined != null && combined < 0.04) notes.push("Drag the PSxG ball toward a corner to test a cleaner strike.");
  return notes.slice(0, 3).join(" ");
}

function Legend({ color, text }: { color: string; text: string }) {
  return <span><i className="dot" style={{ background: color }} />{text}</span>;
}

function Card({ label, value, note, big = false }: { label: string; value: string; note?: string; big?: boolean }) {
  return <div className={`card ${big ? "big" : ""}`}><div className="k">{label}</div><div className={`v ${big ? "" : "mid"}`}>{value}</div>{note && <div className="note">{note}</div>}</div>;
}

function Metric({ k, v }: { k: string; v: string }) {
  return <div className="m"><span>{k}</span><b>{v}</b></div>;
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="row"><span>{k}</span><b>{v}</b></div>;
}
