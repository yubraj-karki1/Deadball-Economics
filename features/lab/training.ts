import type { ModelCalibration, Point } from "../../lib/deadball";
import { DEFAULT_CALIBRATION, GOAL_H, GOAL_W, P_L, P_W } from "./constants";
import { fmt } from "./calculations";
import { calcPhysics } from "./physics";
import { makeScenarioId } from "./storage";
import type { DataQuality, FeatureImportance, ModelConfidence, PsxgTraining, SkipReason, TrainedModel, TrainingMetrics, TrainingReport, TrainingRow } from "./types";
import { distM, pct } from "./utils";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));

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

export function modelConfidence(train: TrainingMetrics, test: TrainingMetrics, quality: DataQuality): ModelConfidence {
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

export function trainCalibrationFromCsv(text: string, name: string): TrainingReport {
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
