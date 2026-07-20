import type { ModelCalibration, Point } from "../../lib/deadball";

export type PresetKey = "nearPost" | "farPost" | "directFk" | "longThrow";
export type DragTarget = { kind: "shot" | "gk" | "start" | "def" | "atk"; index?: number } | null;
export type GoalDrag = "ball" | "gk" | null;

export type LabState = {
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

export type SavedScenario = { id: string; name: string; state: LabState; createdAt: number; updatedAt: number };
export type TrainingRow = { goal: number; features: number[] };
export type SkipReason = "missingGoal" | "missingShotX" | "missingShotY" | "invalidNumber";
export type TrainingMetrics = { rows: number; goals: number; goalRate: number; loss: number; brier: number; accuracy: number; auc: number };
export type DataQuality = { total: number; valid: number; skipped: number; missingGoal: number; missingShotX: number; missingShotY: number; invalidNumber: number };
export type FeatureImportance = { name: string; label: string; weight: number; share: number; direction: string };
export type ModelConfidence = { label: "Low" | "Medium" | "High"; score: number; reasons: string[] };
export type PsxgTraining = { rows: number; predicted: number; actual: number; suggestedGkReaction: number };
export type ReliabilityBucket = { count: number; avgPredicted: number; avgActual: number; minP: number; maxP: number };

export type TrainedModel = {
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
  reliability?: ReliabilityBucket[];
  notes?: string;
  createdAt: number;
};

export type TrainingReport = { rows: number; skipped: number; quality: DataQuality; train: TrainingMetrics; test: TrainingMetrics; confidence: ModelConfidence; warnings: string[]; reliability: ReliabilityBucket[]; model: TrainedModel } | { error: string };

export type PsxgCalc = {
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
