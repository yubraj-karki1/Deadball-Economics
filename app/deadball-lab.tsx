"use client";

import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { GridResponse, Point, XgResponse } from "../lib/deadball";

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
};

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
const distM = (p: Point) => Math.hypot(GX - p[0], GY - p[1]);
const toSB = (p: Point): Point => [+(p[0] * 120 / P_L).toFixed(2), +(p[1] * 80 / P_W).toFixed(2)];
const heatColor = (xg: number) => {
  const t = Math.min(1, xg / 0.35);
  const r = t < 0.5 ? Math.round(80 + 350 * t) : 235;
  const g = t < 0.5 ? 200 : Math.round(200 - 150 * (t - 0.5) * 2);
  return `rgb(${r},${g},70)`;
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
};

function calcPhysics(ball: Point, gk: Point, speed: number, shotDistance: number, craftBonus = 0): PsxgCalc {
  const hd = Math.abs(ball[0] - gk[0]);
  const vd = Math.abs(ball[1] - Math.max(0, gk[1]));
  const speedMs = speed / 3.6;
  const ballTime = speedMs > 0 ? shotDistance / speedMs : 999;
  const hTime = hd / GK_H;
  const vTime = vd / GK_V;
  const reaction = GK_REACTION + craftBonus * 0.45;
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

export default function DeadballLab() {
  const [state, setState] = useState<LabState>(initialState);
  const [scenarioName, setScenarioName] = useState("Near-post corner");
  const [activePreset, setActivePreset] = useState<PresetKey>("nearPost");
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
  const craftBonus = isDirect ? Math.min(0.18, Math.abs(state.curve) / 100 * 0.055 + state.dip / 100 * 0.045 + state.knuckle / 100 * 0.07) : 0;
  const psxg = useMemo(() => calcPhysics(state.ball, state.gkf, state.shotSpeed, distM(modelShot), craftBonus), [state.ball, state.gkf, state.shotSpeed, modelShot, craftBonus]);
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
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
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
        body_part: isDirect && state.body === "Head" ? "Right Foot" : state.body,
        shot_type: isDirect ? "Free Kick" : "",
      };
      const res = await fetch("/api/calculate_xg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      setResult(await res.json() as XgResponse);
    }, 120);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [isDirect, modelShot, state.attackers, state.body, state.defenders, state.gk, state.height, state.spType, state.swing, wallPlayers]);

  useEffect(() => {
    if (!state.showHeat) {
      setHeat([]);
      return;
    }

    const timer = window.setTimeout(async () => {
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
          body_part: state.body,
        }),
      });
      const data = await res.json() as GridResponse;
      setHeat(data.grid.map((c) => ({ x: c.x * P_L / 120, y: c.y * P_W / 80, xg: c.xg })));
    }, 180);

    return () => window.clearTimeout(timer);
  }, [isDirect, state.attackers, state.body, state.defenders, state.gk, state.height, state.showHeat, state.spType, state.swing, wallPlayers]);

  useEffect(() => {
    const up = () => {
      setDrag(null);
      setGoalDrag(null);
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const update = (patch: Partial<LabState>) => setState((s) => ({ ...s, ...patch }));
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
  const shotPath = isDirect ? `M ${state.start[0]} ${state.start[1]} C ${state.start[0] + 7} ${state.start[1] - state.dip / 14} ${98} ${directTarget[1] + state.curve / 22} ${directTarget[0]} ${directTarget[1]}` : swingPath(state.start, state.shot, state.swing);
  const [ballSvgX, ballSvgY] = goalPointToSvg(state.ball);
  const [gkSvgX, gkSvgY] = goalPointToSvg(state.gkf);
  const recommendation = result ? recommendationFor(result, combined, isDirect) : "Move the shot marker or load a preset to generate a tactical read.";

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Deadball Economics <span className="tag">Set-piece xG</span></h1>
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
          <label>Finish / foot<select value={isDirect && state.body === "Head" ? "Right Foot" : state.body} onChange={(e) => update({ body: e.target.value })}><option hidden={isDirect}>Head</option><option>Right Foot</option><option>Left Foot</option></select></label>
          {isDirect && <div className="direct-fk-card open">
            <div className="fk-title">Direct FK craft</div>
            <Slider label="Curve" value={state.curve} min={-100} max={100} onChange={(curve) => update({ curve })} suffix={state.curve === 0 ? " straight" : state.curve < 0 ? " left" : " right"} />
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
          <div className="mini-card"><span>Pitch mode</span><b>105 x 68 m</b></div>
        </aside>

        <section className="panel pitchpanel">
          <div className="panel-head"><span>Live pitch</span><b>Drag to edit</b></div>
          <svg ref={pitchRef} viewBox="55 0 50 68" preserveAspectRatio="xMidYMid meet" className="pitch" onPointerMove={onPitchMove}>
            <PitchMarks />
            {state.showVor && <Voronoi defenders={[...state.defenders, ...wallPlayers]} attackers={state.attackers} gk={state.gk} />}
            {heat.map((c, i) => <rect key={i} x={c.x - 1.1} y={c.y - 1.3} width="2.2" height="2.6" fill={heatColor(c.xg)} opacity="0.5" />)}
            <path d={shotPath} fill="none" stroke="#facc15" strokeWidth="0.48" strokeDasharray="1.2 0.8" />
            {state.attackers.map((a, i) => <Player key={`a${i}`} p={a} color="#2563eb" onPointerDown={() => setDrag({ kind: "atk", index: i })} />)}
            {state.defenders.map((d, i) => <Player key={`d${i}`} p={d} color="#dc2626" onPointerDown={() => setDrag({ kind: "def", index: i })} />)}
            {wallPlayers.map((d, i) => <g key={`w${i}`}><Player p={d} color="#fb923c" /><text x={d[0]} y={d[1] + 0.34} textAnchor="middle" fontSize="0.82" fill="#1f1304" fontWeight="bold">W</text></g>)}
            <Player p={state.gk} color="#facc15" label="GK" onPointerDown={() => setDrag({ kind: "gk" })} />
            <Player p={state.start} color="#facc15" radius={0.8} onPointerDown={() => setDrag({ kind: "start" })} />
            {!isDirect ? <>
              <line x1={state.shot[0]} y1={state.shot[1]} x2={GX} y2={GY} stroke="#ffffffaa" strokeWidth="0.25" strokeDasharray="1.2 0.8" />
              <Player p={state.shot} color="#fff" radius={1.12} onPointerDown={() => setDrag({ kind: "shot" })} />
            </> : <circle cx={directTarget[0]} cy={directTarget[1]} r="0.45" fill="#fff" stroke="#111" strokeWidth="0.2" />}
          </svg>
          <div className="legend"><Legend color="#fff" text="Shot" /><Legend color="#facc15" text="Delivery / GK" /><Legend color="#dc2626" text="Defenders" /><Legend color="#2563eb" text="Attackers" /><Legend color="#fb923c" text="Wall" /></div>
        </section>

        <section className="panel psxgpanel">
          <div className="panel-head"><span>Post-shot xG</span><b>GK biomechanics</b></div>
          <svg ref={goalRef} viewBox="0 0 764 280" className="goalframe" onPointerMove={onGoalMove}>
            <rect x="11" y="11" width="742" height="254" fill="none" stroke="#fff" strokeWidth="8" rx="2" />
            <rect x="16" y="16" width="732" height="244" fill="rgba(0,80,0,.4)" />
            {Array.from({ length: 4 }).map((_, c) => Array.from({ length: 3 }).map((__, r) => {
              const x = (c + 0.5) * GOAL_W / 4;
              const y = GOAL_H - (r + 0.5) * GOAL_H / 3;
              const v = calcPhysics([x, y], state.gkf, state.shotSpeed, distM(modelShot), craftBonus).psxg;
              return <g key={`${c}-${r}`}><rect x={16 + c * 183} y={16 + r * 81.33} width="183" height="81.33" fill={zoneFill(v)} stroke="rgba(255,255,255,.25)" /><text x={16 + c * 183 + 91.5} y={16 + r * 81.33 + 44} textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold">{v.toFixed(2)}</text></g>;
            }))}
            <ellipse cx={gkSvgX} cy={gkSvgY} rx={Math.max(50, (psxg.ballTime - 0.15) * GK_H * 100)} ry={Math.max(50, (psxg.ballTime - 0.15) * GK_V * 100)} fill="rgba(34,197,94,.18)" stroke="rgba(34,197,94,.85)" strokeDasharray="6 4" />
            <g onPointerDown={() => setGoalDrag("gk")} className="grab"><rect x={gkSvgX - 18} y={gkSvgY - 104} width="36" height="90" rx="10" fill="#dc2626" stroke="#fff" /><circle cx={gkSvgX} cy={gkSvgY - 118} r="12" fill="#e8b89a" stroke="#fff" /><text x={gkSvgX} y={gkSvgY - 60} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="bold">GK</text></g>
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
          </div>
          <div className="card small insight"><div className="bk-title">Analyst note</div><div>{recommendation}</div></div>
        </aside>
      </main>

      <footer className="foot">Deadball Economics · Next.js TypeScript build · models approximated natively in TypeScript.</footer>
    </>
  );
}

function Slider({ label, value, min, max, step = 1, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  return <label>{label} <b>{value.toFixed(step < 1 ? 1 : 0)}{suffix}</b><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>;
}

function Player({ p, color, label, radius = 0.95, onPointerDown }: { p: Point; color: string; label?: string; radius?: number; onPointerDown?: () => void }) {
  return <g onPointerDown={onPointerDown} className={onPointerDown ? "grab" : undefined}><circle cx={p[0]} cy={p[1]} r={radius} fill={color} stroke="#fff" strokeWidth="0.22" />{label && <text x={p[0]} y={p[1] + 0.35} textAnchor="middle" fontSize="0.9" fill="#1f2937" fontWeight="bold">{label}</text>}</g>;
}

function PitchMarks() {
  return <><rect x={GX - 16.5} y={GY - 20.16} width="16.5" height="40.32" fill="none" stroke="#ffffff88" strokeWidth="0.3" /><rect x={GX - 5.5} y={GY - 9.16} width="5.5" height="18.32" fill="none" stroke="#ffffff88" strokeWidth="0.3" /><line x1={GX} y1={GY - 3.66} x2={GX} y2={GY + 3.66} stroke="#fff" strokeWidth="1" /><circle cx={GX - 11} cy={GY} r="0.5" fill="#fff" /><line x1={X0} y1="0" x2={X0} y2={P_W} stroke="#ffffff55" strokeWidth="0.3" /></>;
}

function Voronoi({ defenders, attackers, gk }: { defenders: Point[]; attackers: Point[]; gk: Point }) {
  const pts: Array<[Point, string]> = [...defenders.map((p) => [p, "#f87171"] as [Point, string]), ...attackers.map((p) => [p, "#60a5fa"] as [Point, string]), [gk, "#fbbf24"]];
  const cells = [];
  for (let x = X0; x <= X1; x += 1.4) for (let y = 0; y <= 68; y += 1.4) {
    let best = Infinity;
    let col = "#64748b";
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
  if (v >= 0.8) return "rgba(233,30,99,.65)";
  if (v >= 0.65) return "rgba(233,30,99,.5)";
  if (v >= 0.5) return "rgba(255,152,0,.55)";
  if (v >= 0.35) return "rgba(255,193,7,.5)";
  if (v >= 0.25) return "rgba(139,195,74,.5)";
  return "rgba(76,175,80,.55)";
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
