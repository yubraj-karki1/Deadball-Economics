"use client";
import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { predict, type GridResponse, type ModelCalibration, type Point, type XgResponse } from "../lib/deadball";
import { ACTIVE_TRAINED_MODEL_KEY, DEFAULT_CALIBRATION, GK_H, GK_V, GOAL_H, GOAL_W, GX, GY, P_L, P_W, PRESETS, VH, VW, X0, X1, defaultStart, initialState } from "../features/lab/constants";
import { directFreeKickVisual, fmt, signed, xgMath } from "../features/lab/calculations";
import { GoalkeeperFigure, PitchMarks, Player, Voronoi, zoneFill } from "../features/lab/pitch-components";
import { recommendationFor } from "../features/lab/recommendations";
import { ReliabilityChart } from "../features/lab/reliability-chart";
import { Card, Legend, Metric, PointInput, Row, Slider } from "../features/lab/ui-components";
import { calcPhysics, footAdjustedCurve, goalPointToSvg, swingPath } from "../features/lab/physics";
import { calibrationOr, makeScenarioId, numberOr, readSavedScenarios, readTrainedModels, writeSavedScenarios, writeTrainedModels } from "../features/lab/storage";
import { modelConfidence, trainCalibrationFromCsv } from "../features/lab/training";
import { scoreShotsCsv, type BatchScoreResult } from "../features/lab/batch-scoring";
import type { DragTarget, GoalDrag, LabState, PresetKey, SavedScenario, TrainedModel, TrainingReport } from "../features/lab/types";
import { clamp, distM, heatColor, isAbortError, pct, toSB } from "../features/lab/utils";

export default function DeadballLab({ view = "lab" }: { view?: "lab" | "retrain" | "calculations" }) {
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
  const [showCoords, setShowCoords] = useState(false);
  const [batchReport, setBatchReport] = useState<BatchScoreResult | null>(null);
  const pitchRef = useRef<SVGSVGElement | null>(null);
  const goalRef = useRef<SVGSVGElement | null>(null);

  const isDirect = state.spType === "freekick-direct";
  const isFreeKick = state.spType.startsWith("freekick");
  const isCorner = state.spType.startsWith("corner");
  const modelShot = isDirect ? state.start : state.shot;
  const directFoot = isDirect && state.body === "Left Foot" ? "Left Foot" : "Right Foot";
  const effectiveCurve = footAdjustedCurve(state.curve, directFoot);
  const directTargetSbY = +((GY - GOAL_W / 2 + state.ball[0]) * 80 / P_W).toFixed(2);
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
    const activeModelId = window.localStorage.getItem(ACTIVE_TRAINED_MODEL_KEY) ?? "";
    const activeModel = models.find((model) => model.id === activeModelId);
    setTrainedModels(models);
    setSelectedModelId(activeModel?.id ?? models[0]?.id ?? "");
    if (activeModel) {
      setState((current) => ({ ...current, calibration: activeModel.calibration }));
      setModelName(activeModel.name);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
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
          shot_target_y: isDirect ? directTargetSbY : undefined,
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
  }, [directTargetSbY, effectiveCurve, isDirect, modelShot, state.attackers, state.body, state.calibration, state.defenders, state.dip, state.gk, state.height, state.knuckle, state.shotSpeed, state.spType, state.swing, wallPlayers]);

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
            shot_target_y: isDirect ? directTargetSbY : undefined,
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
  }, [directTargetSbY, effectiveCurve, isDirect, state.attackers, state.body, state.calibration, state.defenders, state.dip, state.gk, state.height, state.knuckle, state.shotSpeed, state.showHeat, state.spType, state.swing, wallPlayers]);

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
    window.localStorage.setItem(ACTIVE_TRAINED_MODEL_KEY, model.id);
  };
  const deleteTrainedModel = () => {
    const next = trainedModels.filter((item) => item.id !== selectedModelId);
    if (window.localStorage.getItem(ACTIVE_TRAINED_MODEL_KEY) === selectedModelId) {
      window.localStorage.removeItem(ACTIVE_TRAINED_MODEL_KEY);
    }
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
  const scoreCsvFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const result = scoreShotsCsv(await file.text(), state.calibration);
    setBatchReport(result);
    if ("error" in result) return;

    const blob = new Blob([result.csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${file.name.replace(/\.csv$/i, "") || "shots"}-scored.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  };
  const downloadBatchTemplate = () => {
    const template = [
      "shot_x,shot_y,setpiece_type,gk_x,gk_y,body_part,delivery_technique,delivery_height,defenders,attackers",
      '101.5,31.5,corner-right,104,34,Head,Inswinging,High Pass,"[[101,32],[102.2,34]]","[[101.5,31.5]]"',
      '84,32,freekick-direct,104,34,Right Foot,,,"[[100,38]]","[[87,31]]"',
    ].join("\n");
    const blob = new Blob([template], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "deadball-batch-scoring-template.csv";
    link.click();
    window.URL.revokeObjectURL(url);
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
    window.localStorage.removeItem(ACTIVE_TRAINED_MODEL_KEY);
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
      shot_target_y: isDirect ? directTargetSbY : undefined,
      calibration: DEFAULT_CALIBRATION,
    });
  }, [directFoot, directTargetSbY, effectiveCurve, isDirect, modelShot, state.attackers, state.body, state.defenders, state.dip, state.gk, state.height, state.knuckle, state.shotSpeed, state.spType, state.swing, wallPlayers]);
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
      shot_target_y: isDirect ? directTargetSbY : undefined,
      calibration: selectedTrainedModel.calibration,
    });
  }, [directFoot, directTargetSbY, effectiveCurve, isDirect, modelShot, selectedTrainedModel, state.attackers, state.body, state.defenders, state.dip, state.gk, state.height, state.knuckle, state.shotSpeed, state.spType, state.swing, wallPlayers]);
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
          <p className="sub">{view === "retrain" ? "Train, validate, compare, and manage custom set-piece models." : view === "calculations" ? "Inspect the live xG, PSxG, and combined probability calculations." : "A tactical set-piece lab rebuilt as a Next.js and React TypeScript app."}</p>
        </div>
        <div className="top-actions">
          <span className="model-pill">36,055 source shots</span>
          {view !== "lab" && <a className="health" href="/">Back to lab</a>}
          <a className="health" href="/api/health" target="_blank">API health</a>
        </div>
      </header>

      <section className="scenario-strip">
        {(Object.keys(PRESETS) as PresetKey[]).map((key) => view !== "retrain" ? (
          <button key={key} className={`preset ${activePreset === key ? "on" : ""}`} onClick={() => applyPreset(key)}>{PRESETS[key].name}</button>
        ) : (
          <a key={key} className="preset scenario-link" href="/">{PRESETS[key].name}</a>
        ))}
        <a className={`preset scenario-link ${view === "retrain" ? "on" : ""}`} href="/retrain">Retrain model</a>
        <a className={`preset scenario-link ${view === "calculations" ? "on" : ""}`} href="/calculations">xG &amp; PSxG calculations</a>
      </section>

      <main className={`grid ${view === "retrain" ? "retrain-view" : view === "calculations" ? "calculation-view" : ""}`}>
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
          <div className="tool-row">
            <button className={`btn toggle ${showCoords ? "on" : ""}`} style={{ gridColumn: "1 / -1" }} onClick={() => setShowCoords((v) => !v)}>Coordinates {showCoords ? "▲" : "▼"}</button>
          </div>
          {showCoords && <div className="coords-card">
            <div className="fk-title">Precise coordinates (pitch: {X0}-{X1}m x, 0-68m y)</div>
            {!isDirect && <PointInput label="Shot" value={state.shot} xMin={X0} xMax={X1} yMin={0} yMax={68} onChange={(shot) => { setScenarioName("Custom setup"); update({ shot }); }} />}
            {!isCorner && <PointInput label={isDirect ? "Kick spot" : "Delivery start"} value={state.start} xMin={X0} xMax={X1} yMin={0} yMax={68} onChange={(start) => { setScenarioName("Custom setup"); update({ start }); }} />}
            <PointInput label="Goalkeeper (pitch)" value={state.gk} xMin={X0} xMax={X1} yMin={0} yMax={68} onChange={(gk) => { setScenarioName("Custom setup"); update({ gk }); }} />
            {state.defenders.map((d, i) => (
              <PointInput key={`def-${i}`} label={`Defender ${i + 1}`} value={d} xMin={X0} xMax={X1} yMin={0} yMax={68} onChange={(p) => { setScenarioName("Custom setup"); update({ defenders: state.defenders.map((x, j) => (j === i ? p : x)) }); }} />
            ))}
            {state.attackers.map((a, i) => (
              <PointInput key={`atk-${i}`} label={`Attacker ${i + 1}`} value={a} xMin={X0} xMax={X1} yMin={0} yMax={68} onChange={(p) => { setScenarioName("Custom setup"); update({ attackers: state.attackers.map((x, j) => (j === i ? p : x)) }); }} />
            ))}
            <PointInput label="Ball (goal frame, m)" value={state.ball} xMin={0.01} xMax={GOAL_W - 0.01} yMin={0.01} yMax={GOAL_H - 0.01} step={0.05} digits={2} onChange={(ball) => update({ ball })} />
            <PointInput label="Keeper (goal frame, m)" value={state.gkf} xMin={0.5} xMax={GOAL_W - 0.5} yMin={0} yMax={1.5} step={0.05} digits={2} onChange={(gkf) => update({ gkf })} />
          </div>}
          {view === "retrain" && <div className="training-card open">
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
            <div className="fk-title">Batch score shots</div>
            <label>Shots CSV (scored with the active calibration)
              <input type="file" accept=".csv,text/csv" onChange={scoreCsvFile} />
            </label>
            <div className="tool-row">
              <button className="btn" style={{ gridColumn: "1 / -1" }} onClick={downloadBatchTemplate}>Batch CSV template</button>
            </div>
            {batchReport && "error" in batchReport && <Row k="Batch scoring" v={batchReport.error} />}
            {batchReport && !("error" in batchReport) && <Row k="Batch scoring" v={`${batchReport.scored} scored, ${batchReport.skipped} skipped -> file downloaded`} />}
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
              {selectedTrainedModel?.reliability && selectedTrainedModel.reliability.length > 0 && <>
                <div className="fk-title">Reliability (selected model, test set)</div>
                <ReliabilityChart buckets={selectedTrainedModel.reliability} />
              </>}
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
                {trainingReport.reliability.length > 0 && <>
                  <div className="fk-title">Reliability (just-trained model, test set)</div>
                  <ReliabilityChart buckets={trainingReport.reliability} />
                </>}
              </>}
            </div>
          </div>}
          <div className="mini-card"><span>Pitch mode</span><b>105 x 68 m</b></div>
        </aside>

        <section className="panel pitchpanel">
          <div className="panel-head"><span>{view === "calculations" ? "Expected goals" : "Live pitch"}</span><b>{view === "calculations" ? "xG model" : "Drag to edit"}</b></div>
          {view === "calculations" && <div className="calculation-hero"><span>Current shot xG</span><b>{pct(result?.xg)}</b><small>{result?.zone ?? "Calculating"} · {fmt(result?.distance_to_goal ?? distM(modelShot), 1)} m</small></div>}
          <svg ref={pitchRef} viewBox="55 0 50 68" preserveAspectRatio="xMidYMid meet" className="pitch" onPointerMove={onPitchMove}>
            <PitchMarks />
            {state.showVor && <Voronoi defenders={[...state.defenders, ...wallPlayers]} attackers={state.attackers} gk={state.gk} />}
            {heat.map((c, i) => <rect key={i} x={c.x - 1.1} y={c.y - 1.3} width="2.2" height="2.6" fill={heatColor(c.xg)} opacity="0.5" />)}
            {directVisual && state.dip > 0 && <path d={directVisual.dipPath} fill="none" stroke="#f7ecd0" strokeWidth={0.16 + state.dip / 230} strokeDasharray="0.8 1" opacity={0.15 + state.dip / 170} />}
            <path d={shotPath} fill="none" stroke="#e0b84a" strokeWidth="0.48" strokeDasharray="1.2 0.8" />
            {directVisual && state.dip > 0 && directVisual.heightMarks.map((mark, i) => <circle key={`dip${i}`} cx={mark.x} cy={mark.y} r={mark.radius} fill="#f7ecd0" opacity={mark.opacity} />)}
            {state.attackers.map((a, i) => <Player key={`a${i}`} p={a} color="#4fd0a5" onPointerDown={() => setDrag({ kind: "atk", index: i })} />)}
            {state.defenders.map((d, i) => <Player key={`d${i}`} p={d} color="#ef5b5b" onPointerDown={() => setDrag({ kind: "def", index: i })} />)}
            {wallPlayers.map((d, i) => <g key={`w${i}`}><Player p={d} color="#e08a3c" /><text x={d[0]} y={d[1] + 0.34} textAnchor="middle" fontSize="0.82" fill="#241706" fontWeight="bold">W</text></g>)}
            <Player p={state.gk} color="#e0b84a" label="GK" onPointerDown={() => setDrag({ kind: "gk" })} />
            <Player p={state.start} color="#e0b84a" radius={0.8} onPointerDown={() => setDrag({ kind: "start" })} />
            {!isDirect ? <>
              <line x1={state.shot[0]} y1={state.shot[1]} x2={GX} y2={GY} stroke="#ffffffaa" strokeWidth="0.25" strokeDasharray="1.2 0.8" />
              <Player p={state.shot} color="#fff" radius={1.12} onPointerDown={() => setDrag({ kind: "shot" })} />
            </> : <circle cx={directTarget[0]} cy={directTarget[1]} r="0.45" fill="#fff" stroke="#111" strokeWidth="0.2" />}
          </svg>
          <div className="legend"><Legend color="#f7ecd0" text="Shot" /><Legend color="#e0b84a" text="Delivery / GK" /><Legend color="#ef5b5b" text="Defenders" /><Legend color="#4fd0a5" text="Attackers" /><Legend color="#e08a3c" text="Wall" /></div>
          {view === "calculations" && <div className="pitch-math-grid">
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
          </div>}
        </section>

        <section className="panel psxgpanel">
          <div className="panel-head"><span>Post-shot xG</span><b>GK biomechanics</b></div>
          {view === "calculations" && <div className="calculation-hero psxg-hero"><span>Current PSxG</span><b>{pct(psxg.psxg)}</b><small>{psxg.diff} · {fmt(psxg.margin)} s margin</small></div>}
          <svg ref={goalRef} viewBox="0 0 764 280" className="goalframe" onPointerMove={onGoalMove}>
            <rect x="11" y="11" width="742" height="254" fill="none" stroke="#fff" strokeWidth="8" rx="2" />
            <rect x="16" y="16" width="732" height="244" fill="rgba(18,92,51,.42)" />
            {Array.from({ length: 4 }).map((_, c) => Array.from({ length: 3 }).map((__, r) => {
              const x = (c + 0.5) * GOAL_W / 4;
              const y = GOAL_H - (r + 0.5) * GOAL_H / 3;
              const v = calcPhysics([x, y], state.gkf, state.shotSpeed, distM(modelShot), craftBonus, state.calibration).psxg;
              return <g key={`${c}-${r}`}><rect x={16 + c * 183} y={16 + r * 81.33} width="183" height="81.33" fill={zoneFill(v)} stroke="rgba(255,255,255,.25)" /><text x={16 + c * 183 + 91.5} y={16 + r * 81.33 + 44} textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold">{v.toFixed(2)}</text></g>;
            }))}
            <ellipse cx={gkSvgX} cy={gkSvgY} rx={Math.max(44, (psxg.ballTime - 0.15) * GK_H * 85)} ry={Math.max(44, (psxg.ballTime - 0.15) * GK_V * 85)} fill="rgba(79,208,165,.16)" stroke="rgba(79,208,165,.9)" strokeDasharray="6 4" />
            <GoalkeeperFigure x={gkSvgX} y={gkSvgY} targetX={ballSvgX} targetY={ballSvgY} onPointerDown={() => setGoalDrag("gk")} />
            <g onPointerDown={() => setGoalDrag("ball")} className="grab"><circle cx={ballSvgX} cy={ballSvgY} r="16" fill="#fff" stroke="#333" strokeWidth="2" /><text x={ballSvgX} y={ballSvgY + 29} textAnchor="middle" fill="#fff" fontSize="12" fontWeight="bold">BALL</text></g>
          </svg>
          <Slider label="Shot speed" value={state.shotSpeed} min={40} max={140} onChange={(shotSpeed) => update({ shotSpeed })} suffix=" km/h" />
          <div className="metrics">
            <Metric k="xG" v={pct(result?.xg)} />
            <Metric k="Ball time" v={`${psxg.ballTime.toFixed(3)}s`} />
            <Metric k="GK reach" v={`${psxg.diveTime.toFixed(3)}s`} />
            <Metric k="Margin" v={`${psxg.margin > 0 ? "+" : ""}${psxg.margin.toFixed(3)}s`} />
            <Metric k="GK dive" v={`${psxg.diveDist.toFixed(2)}m`} />
            <Metric k="Difficulty" v={psxg.diff} />
            <Metric k="PSxG" v={pct(psxg.psxg)} />
          </div>
          {view === "calculations" && <div className="formula-live">
            <span>Shot distance</span><b>{distM(modelShot).toFixed(2)} m</b>
            <span>Ball time</span><b>{distM(modelShot).toFixed(2)} / {psxg.speedMs.toFixed(2)} = {psxg.ballTime.toFixed(3)} s</b>
            <span>GK dx / dy</span><b>{psxg.hd.toFixed(2)} m / {psxg.vd.toFixed(2)} m</b>
            <span>GK reach</span><b>{psxg.reaction.toFixed(3)} + max({psxg.hTime.toFixed(3)}, {psxg.vTime.toFixed(3)}) = {psxg.diveTime.toFixed(3)} s</b>
          </div>}
          {view === "calculations" && <div className="calculation-card math-card psxg-calculation">
            <div className="bk-title">PSxG calculation</div>
            <div className="equation">PSxG = clamp(f(GK reach - ball time), 0.01, 0.99)</div>
            <Row k="Ball time" v={`${fmt(distM(modelShot), 2)} / ${fmt(psxg.speedMs, 2)} = ${fmt(psxg.ballTime)} s`} />
            <Row k="Reach time" v={`${fmt(psxg.reaction)} + max(${fmt(psxg.hTime)}, ${fmt(psxg.vTime)}) = ${fmt(psxg.diveTime)} s`} />
            <Row k="Time margin" v={`${signed(psxg.margin)} s -> ${pct(psxg.psxg)}`} />
          </div>}
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
            {isDirect && <Row k="Wall coverage" v={`${(Number(result?.derived.wall_obstruction ?? 0) * 100 / 3.25).toFixed(0)}%`} />}
            {isDirect && <Row k="Craft" v={`${Number(result?.derived.direct_craft_logit ?? 0).toFixed(3)} logit`} />}
            {isDirect && <Row k="Dip effect" v={`${Number(result?.derived.direct_dip_logit ?? 0).toFixed(3)} logit`} />}
            {isDirect && <Row k="Knuckle effect" v={`${Number(result?.derived.direct_knuckle_logit ?? 0).toFixed(3)} logit`} />}
          </div>
          <div className="card small insight"><div className="bk-title">Analyst note</div><div>{recommendation}</div></div>
        </aside>
      </main>

    </>
  );
}
