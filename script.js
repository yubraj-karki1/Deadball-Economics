/* Deadball Economics - standalone set-piece xG lab (vanilla JS).
   Mirrors DeadballFullPitchLab: a 105x68 m pitch; the trained models expect
   StatsBomb 120x80 coords, so we convert (toSB) only when calling the API. */

// ---- pitch geometry (metres) ----
const P_L = 105, P_W = 68, GX = 105, GY = 34;
const X0 = 55, X1 = 105, Y0 = 0, Y1 = 68, VW = X1 - X0, VH = Y1 - Y0;
const toSB = (p) => [+(p[0] * 120 / P_L).toFixed(2), +(p[1] * 80 / P_W).toFixed(2)];
const distM = (p) => Math.hypot(GX - p[0], GY - p[1]);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pct = (v) => (v == null || Number.isNaN(v) ? "-" : (v * 100).toFixed(1) + "%");

// ---- reference modifiers (for the breakdown panel) ----
const ZONE_MOD = { "near-post": "x2.23", "far-post": "x2.25", "penalty-spot": "x1.11", central: "x0.78", edge: "x0.31", "second-ball": "x0.16" };
const SWING_MOD = { Inswinging: "x1.18", Outswinging: "x0.67", Straight: "x0.70" };
const HEIGHT_MOD = { "Low Pass": "x1.39", "High Pass": "x0.99", "Ground Pass": "x0.78" };
const FINISH_MOD = { Head: "x1.03", "Right Foot": "x1.01", "Left Foot": "x0.89" };
const MARK_MOD = { zonal: "x1.08", mixed: "x0.95", man: "x0.75" };

function defaultStart(t) {
  if (t === "corner-right") return [105, 0.5];
  if (t === "corner-left") return [105, 67.5];
  if (t.startsWith("throwin")) return [88, 0.5];
  return [83, 26];
}
function heatColor(xg) {
  const t = Math.min(1, xg / 0.35);
  const r = t < 0.5 ? Math.round(80 + 350 * t) : 235;
  const g = t < 0.5 ? 200 : Math.round(200 - 150 * (t - 0.5) * 2);
  return `rgb(${r},${g},70)`;
}
function swingPath(s, e, swing) {
  const mx = (s[0] + e[0]) / 2, my = (s[1] + e[1]) / 2;
  const dx = e[0] - s[0], dy = e[1] - s[1], len = Math.hypot(dx, dy) || 1;
  let px = -dy / len, py = dx / len;
  if (px * (GX - mx) + py * (GY - my) < 0) { px = -px; py = -py; }
  const k = swing === "Straight" ? 2 : 13;
  const sign = swing === "Inswinging" ? -1 : 1;
  const cx = clamp(mx + px * k * sign, X0 + 3, X1 - 2);
  const cy = clamp(my + py * k * sign, Y0 + 2, Y1 - 2);
  return `M ${s[0]} ${s[1]} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${e[0]} ${e[1]}`;
}

// ---- state ----
const state = {
  spType: "corner-right",
  shot: [100, 38], gk: [104, 34], start: defaultStart("corner-right"),
  defenders: [[101, 36], [102, 34], [99, 32], [100, 39]],
  attackers: [[100, 38], [99, 36]],
  swing: "Inswinging", height: "High Pass", body: "Head",
  showHeat: false, showVor: false, heat: null,
  result: null,
  // PSxG goal-frame (metres): ball [across 0..7.32, height 0..2.44], gk likewise
  ball: [0.9, 2.0], gkf: [3.66, 0.5], shotSpeed: 85, psxg: null,
  psxgCalc: null, psxgDistance: null,
  curve: 0, dip: 30, knuckle: 0,
  wallSize: 0, wallDistance: 9, wallShift: 0,
};
const PRESETS = {
  nearPost: {
    name: "Near-post corner",
    spType: "corner-right",
    shot: [101.5, 31.5], gk: [104, 34], start: defaultStart("corner-right"),
    defenders: [[101, 32], [102.2, 34], [100.2, 36.2], [98.8, 30.5], [99.5, 38.5]],
    attackers: [[101.5, 31.5], [100.2, 33.5], [99.4, 37]],
    swing: "Inswinging", height: "High Pass", body: "Head",
  },
  farPost: {
    name: "Far-post overload",
    spType: "corner-left",
    shot: [101.8, 39.5], gk: [103.8, 34.2], start: defaultStart("corner-left"),
    defenders: [[102.5, 34], [101.8, 37.5], [99.4, 35.5], [100.4, 41.2]],
    attackers: [[101.8, 39.5], [100.8, 41.4], [99.5, 43.2], [98.8, 36.5]],
    swing: "Outswinging", height: "High Pass", body: "Head",
  },
  directFk: {
    name: "Direct free kick",
    spType: "freekick-direct",
    shot: [84, 32], gk: [104, 34], start: defaultStart("freekick-direct"),
    defenders: [[100, 38]],
    attackers: [[87, 31], [95, 40]],
    swing: "Straight", height: "High Pass", body: "Right Foot",
    ball: [6.7, 1.8], gkf: [3.55, 0.45], shotSpeed: 92,
    curve: 62, dip: 58, knuckle: 12,
    wallSize: 4, wallDistance: 9, wallShift: 0.5,
  },
  longThrow: {
    name: "Long throw",
    spType: "throwin-long",
    shot: [99.4, 36.8], gk: [104, 34], start: [88, 0.5],
    defenders: [[100.4, 34.6], [101.6, 36.5], [99.5, 39.2], [98.6, 33.2]],
    attackers: [[99.4, 36.8], [98.7, 39.8], [97.8, 34.2]],
    swing: "Straight", height: "High Pass", body: "Head",
  },
};
const isDirectFK = () => state.spType === "freekick-direct";
const isFreeKick = () => state.spType.startsWith("freekick");
const isCorner = () => state.spType.startsWith("corner");
const cornerSide = () => state.spType === "corner-right" ? "right" : state.spType === "corner-left" ? "left" : "";
const modelShotPoint = () => isDirectFK() ? state.start : state.shot;
function normalizeForSetPiece() {
  if (isDirectFK() && state.body === "Head") state.body = "Right Foot";
}

function defaultWallSizeFor(t) {
  if (t === "freekick-direct") return 4;
  if (t === "freekick-cross") return 3;
  return 0;
}

function footCurveSign() {
  return state.body === "Left Foot" ? -1 : 1;
}

function effectiveCurve() {
  return isDirectFK() ? state.curve * footCurveSign() : state.curve;
}

function directFkFootLabel() {
  if (!isDirectFK()) return state.body;
  return state.body === "Left Foot" ? "Left foot" : "Right foot";
}

function directFkTargetPoint() {
  const goalWidth = 7.32;
  const targetY = GY - goalWidth / 2 + clamp(state.ball[0], 0, goalWidth);
  return [GX, clamp(targetY, GY - goalWidth / 2, GY + goalWidth / 2)];
}

function curveLabel(v = state.curve) {
  if (isDirectFK()) {
    const bend = effectiveCurve();
    const side = bend < 0 ? "left" : bend > 0 ? "right" : "straight";
    if (side === "straight") return "0 straight";
    return `${Math.abs(v)} ${state.body === "Left Foot" ? "LF" : "RF"} -> ${side}`;
  }
  if (v < 0) return `${Math.abs(v)} left`;
  if (v > 0) return `${v} right`;
  return "0 straight";
}

function directFkPath(s) {
  const e = directFkTargetPoint();
  const dx = e[0] - s.start[0], dy = e[1] - s.start[1];
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len;
  const curve = effectiveCurve() / 100;
  const dipPull = -Math.min(4.5, state.dip / 28);
  const curveOffset = curve * 8.2;
  const c1 = [
    s.start[0] + dx * 0.32 + px * curveOffset * 0.45,
    s.start[1] + dy * 0.32 + py * curveOffset * 0.45 + dipPull,
  ];
  const c2 = [
    s.start[0] + dx * 0.72 + px * curveOffset,
    s.start[1] + dy * 0.72 + py * curveOffset + dipPull * 0.35,
  ];
  return `M ${s.start[0]} ${s.start[1]} C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${e[0]} ${e[1]}`;
}

function fkCraftBonus() {
  if (!isDirectFK()) return 0;
  const curve = Math.abs(state.curve) / 100;
  const dip = state.dip / 100;
  const knuckle = state.knuckle / 100;
  return Math.min(0.18, curve * 0.055 + dip * 0.045 + knuckle * 0.07);
}

function fkPhysicsOpts() {
  const craft = fkCraftBonus();
  return {
    reactionPenalty: isDirectFK() ? craft * 0.45 : 0,
    psxgBonus: isDirectFK() ? craft : 0,
  };
}

function wallShiftLabel(v = state.wallShift) {
  if (Math.abs(v) < 0.01) return "center";
  return `${Math.abs(v).toFixed(1)} m ${v < 0 ? "left" : "right"}`;
}

function wallPlayers() {
  if (!isFreeKick() || state.wallSize <= 0) return [];
  const start = state.start;
  const dx = GX - start[0], dy = GY - start[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const cx = start[0] + ux * state.wallDistance + nx * state.wallShift;
  const cy = start[1] + uy * state.wallDistance + ny * state.wallShift;
  const spacing = 0.82;
  const n = Math.round(state.wallSize);
  return Array.from({ length: n }, (_, i) => {
    const offset = (i - (n - 1) / 2) * spacing;
    return [
      clamp(+(cx + nx * offset).toFixed(2), X0, X1),
      clamp(+(cy + ny * offset).toFixed(2), Y0, Y1),
    ];
  });
}

function defendersForModel() {
  return [...state.defenders, ...wallPlayers()];
}

// ---- DOM refs ----
const $ = (id) => document.getElementById(id);
const pitch = $("pitch");
const goalframe = $("goalframe");

// ==================== PITCH RENDER ====================
function renderPitch() {
  const s = state;
  let svg = "";
  svg += `<defs>
    <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="0.45" stdDeviation="0.45" flood-color="#0f2a1b" flood-opacity="0.36"/>
    </filter>
  </defs>`;

  if (s.showVor) {
    const pts = [...defendersForModel().map((p) => [p, "#f87171"]), ...s.attackers.map((p) => [p, "#60a5fa"]), [s.gk, "#fbbf24"]];
    const STEP = 1.4;
    for (let x = X0; x <= X1; x += STEP) for (let y = Y0; y <= Y1; y += STEP) {
      let best = Infinity, col = "#64748b";
      for (const [p, c] of pts) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < best) { best = d; col = c; } }
      svg += `<rect x="${(x - STEP / 2).toFixed(2)}" y="${(y - STEP / 2).toFixed(2)}" width="${(STEP + 0.05).toFixed(2)}" height="${(STEP + 0.05).toFixed(2)}" fill="${col}" opacity="0.32"/>`;
    }
  }
  if (s.showHeat && s.heat) {
    for (const c of s.heat) svg += `<rect x="${c.x - 1.1}" y="${c.y - 1.3}" width="2.2" height="2.6" fill="${heatColor(c.xg)}" opacity="0.5"/>`;
  }

  // markings (metres)
  svg += `<rect x="${GX - 16.5}" y="${GY - 20.16}" width="16.5" height="40.32" fill="none" stroke="#ffffff88" stroke-width="0.3"/>`;
  svg += `<rect x="${GX - 5.5}" y="${GY - 9.16}" width="5.5" height="18.32" fill="none" stroke="#ffffff88" stroke-width="0.3"/>`;
  svg += `<line x1="${GX}" y1="${GY - 3.66}" x2="${GX}" y2="${GY + 3.66}" stroke="#fff" stroke-width="1"/>`;
  svg += `<circle cx="${GX - 11}" cy="${GY}" r="0.5" fill="#fff"/>`;
  svg += `<line x1="${X0}" y1="0" x2="${X0}" y2="${P_W}" stroke="#ffffff55" stroke-width="0.3"/>`;

  // delivery/shot path
  svg += isDirectFK()
    ? `<path d="${directFkPath(s)}" fill="none" stroke="#facc15" stroke-width="0.48" stroke-dasharray="1.2 0.8" opacity="0.98"/>`
    : `<path d="${swingPath(s.start, s.shot, s.swing)}" fill="none" stroke="#facc15" stroke-width="0.42" stroke-dasharray="1.2 0.8" opacity="0.98"/>`;

  // players
  s.attackers.forEach((a, i) => { svg += `<circle data-drag="atk" data-idx="${i}" cx="${a[0]}" cy="${a[1]}" r="0.95" fill="#2563eb" stroke="#fff" stroke-width="0.22" filter="url(#softShadow)" style="cursor:grab"/>`; });
  s.defenders.forEach((d, i) => { svg += `<circle data-drag="def" data-idx="${i}" cx="${d[0]}" cy="${d[1]}" r="0.95" fill="#dc2626" stroke="#fff" stroke-width="0.22" filter="url(#softShadow)" style="cursor:grab"/>`; });
  wallPlayers().forEach((d, i) => {
    svg += `<circle cx="${d[0]}" cy="${d[1]}" r="0.9" fill="#fb923c" stroke="#fff" stroke-width="0.22" filter="url(#softShadow)"/>`;
    svg += `<text x="${d[0]}" y="${d[1] + 0.32}" text-anchor="middle" font-size="0.82" fill="#1f1304" font-weight="bold" pointer-events="none">W</text>`;
    if (i === 0) svg += `<text x="${d[0] - 1.2}" y="${d[1] - 1.5}" text-anchor="end" font-size="1.05" fill="#fed7aa" font-weight="bold" pointer-events="none">wall</text>`;
  });

  svg += `<circle data-drag="gk" cx="${s.gk[0]}" cy="${s.gk[1]}" r="1.08" fill="#facc15" stroke="#1f2937" stroke-width="0.25" filter="url(#softShadow)" style="cursor:grab"/>`;
  svg += `<text x="${s.gk[0]}" y="${s.gk[1] + 0.35}" text-anchor="middle" font-size="0.9" fill="#1f2937" font-weight="bold" pointer-events="none">GK</text>`;

  const lbl = isCorner() ? "corner" : s.spType.startsWith("throwin") ? "throw-in" : "FK spot";
  const anchor = s.start[1] < 34 ? "start" : "end";
  const tx = s.start[0] + (s.start[1] < 34 ? 1.5 : -1.5), ty = s.start[1] + (s.start[1] < 34 ? 2.4 : -1.2);
  svg += `<circle data-drag="start" cx="${s.start[0]}" cy="${s.start[1]}" r="0.8" fill="#facc15" stroke="#7c2d12" stroke-width="0.25" filter="url(#softShadow)" style="cursor:${isCorner() ? "default" : "grab"}"/>`;
  svg += `<text x="${tx}" y="${ty}" text-anchor="${anchor}" font-size="1.3" font-weight="bold" fill="#fde047" pointer-events="none">${lbl}</text>`;

  if (!isDirectFK()) {
    svg += `<line x1="${s.shot[0]}" y1="${s.shot[1]}" x2="${GX}" y2="${GY}" stroke="#ffffffaa" stroke-width="0.25" stroke-dasharray="1.2 0.8"/>`;
    svg += `<circle data-drag="shot" cx="${s.shot[0]}" cy="${s.shot[1]}" r="1.12" fill="#fff" stroke="#111" stroke-width="0.28" filter="url(#softShadow)" style="cursor:grab"/>`;
  } else {
    const [txGoal, tyGoal] = directFkTargetPoint();
    svg += `<circle cx="${txGoal}" cy="${tyGoal}" r="0.45" fill="#fff" stroke="#111" stroke-width="0.2" opacity="0.95"/>`;
  }

  pitch.innerHTML = svg;
}

// ==================== RESULT CARDS ====================
function renderCards() {
  const r = state.result;
  if (!r || r.error) {
    $("xg").textContent = "-"; $("value").textContent = "-"; $("combined").textContent = "-";
    $("pshot").textContent = "P(shot) = -";
    $("recommendation").textContent = "Move the shot marker or load a preset to generate a tactical read.";
    if (r && r.error) $("bkChain").innerHTML = `<div class="err">${r.error}</div>`;
    return;
  }
  $("xg").textContent = pct(r.xg);
  $("value").textContent = pct(r.setpiece_value);
  $("pshot").textContent = `P(shot) = ${pct(r.p_shot)}${isDirectFK() ? " (direct FK = the shot)" : ""}`;
  $("zone").textContent = r.zone || "-";
  $("dist").textContent = (r.distance_to_goal != null ? r.distance_to_goal.toFixed(1) : distM(modelShotPoint()).toFixed(1)) + " m";
  $("mark").textContent = r.marking_label || "-";
  const d = r.derived || {};
  $("inbox").textContent = `${d.defenders_in_box ?? "-"} / ${d.attackers_in_box ?? "-"}`;
  $("wallRow").style.display = isFreeKick() ? "flex" : "none";
  $("wall").textContent = isDirectFK() ? `${d.wall_size ?? state.wallSize} inferred` : `${state.wallSize} configured`;

  // breakdown modifiers (corners only, like the course)
  let mods = "";
  if (isCorner()) {
    mods += `<span>Zone - ${r.zone}</span><b>${ZONE_MOD[r.zone] ?? "-"}</b>`;
    mods += `<span>Swing - ${state.swing}</span><b>${SWING_MOD[state.swing] ?? "-"}</b>`;
    mods += `<span>Height - ${state.height}</span><b>${HEIGHT_MOD[state.height] ?? "-"}</b>`;
    mods += `<span>Finish - ${state.body}</span><b>${FINISH_MOD[state.body] ?? "-"}</b>`;
    mods += `<span>Marking - ${r.marking_label || "-"}</span><b>${MARK_MOD[r.marking_label] ?? "-"}</b>`;
  } else if (isDirectFK()) {
    mods += `<span>Foot</span><b>${directFkFootLabel()}</b>`;
    mods += `<span>Curve</span><b>${curveLabel(state.curve)}</b>`;
    mods += `<span>Dip</span><b>${state.dip}</b>`;
    mods += `<span>Knuckle</span><b>${state.knuckle}</b>`;
    mods += `<span>Power</span><b>${state.shotSpeed} km/h</b>`;
    mods += `<span>Wall</span><b>${state.wallSize} players at ${state.wallDistance.toFixed(1)} m</b>`;
  } else if (isFreeKick()) {
    mods += `<span>Wall screen</span><b>${state.wallSize} players at ${state.wallDistance.toFixed(1)} m</b>`;
    mods += `<span>Delivery</span><b>${state.swing}, ${state.height}</b>`;
  }
  $("bkMods").innerHTML = mods;

  const combined = state.psxg != null ? r.xg * state.psxg : null;
  $("combined").textContent = pct(combined);
  $("psxgNote").textContent = `PSxG = ${pct(state.psxg)} (physics)`;
  renderPsxgFormula();
  let chain = `<div>Shot xG (model) = <b>${pct(r.xg)}</b></div>`;
  chain += `<div>x P(shot) ${pct(r.p_shot)} = value <b>${pct(r.setpiece_value)}</b></div>`;
  if (combined != null) chain += `<div>x PSxG ${pct(state.psxg)} = combined <b>${pct(combined)}</b></div>`;
  if (isDirectFK()) chain += `<div>Direct FK craft adjusts PSxG only: <b>+${(fkCraftBonus() * 100).toFixed(1)} pts</b></div>`;
  $("bkChain").innerHTML = chain;
  $("recommendation").textContent = recommendationFor(r, combined);
}

function recommendationFor(r, combined) {
  const d = r.derived || {};
  const notes = [];
  if (r.xg >= 0.18) notes.push("High-quality shot profile. Keep the delivery target and protect the shooting lane.");
  else if (r.xg >= 0.10) notes.push("Useful chance quality. Small gains may come from moving the finish closer to goal or opening the keeper's line.");
  else notes.push("Low shot quality. Try moving the target toward the six-yard box or central channel.");

  if (r.zone === "near-post" || r.zone === "far-post") notes.push(`${r.zone.replace("-", " ")} zones are strong set-piece targets in this model.`);
  if (Number(d.nearest_defender_dist) < 1.8) notes.push("The nearest defender is tight; create separation or add a screen runner.");
  if (Number(d.attackers_in_box) <= 1) notes.push("Add another attacker in the box to make the freeze-frame less isolated.");
  if (r.marking_label === "man") notes.push("Man marking is inferred, so blockers and curved runs are worth testing.");
  if (isDirectFK() && Math.abs(state.curve) < 25) notes.push("Add curve to test a shot that moves away from the keeper late.");
  if (isDirectFK() && state.dip < 35 && state.ball[1] > 1.4) notes.push("More dip helps a high free kick clear the wall and still drop under the bar.");
  if (combined != null && combined < 0.04) notes.push("The finish placement is doing little extra work; drag the PSxG ball toward a corner to test a cleaner strike.");
  return notes.slice(0, 3).join(" ");
}

// ==================== API ====================
function basePayload() {
  normalizeForSetPiece();
  return {
    setpiece_type: state.spType,
    gk: toSB(state.gk),
    defenders: defendersForModel().map(toSB),
    attackers: state.attackers.map(toSB),
    delivery_technique: isDirectFK() ? "" : state.swing,
    delivery_height: isDirectFK() ? "" : state.height,
    corner_side: cornerSide(),
    body_part: state.body,
    shot_type: isDirectFK() ? "Free Kick" : "",
  };
}
let xgTimer = null;
function fetchXG() {
  clearTimeout(xgTimer);
  xgTimer = setTimeout(async () => {
    try {
      const [sx, sy] = toSB(modelShotPoint());
      const res = await fetch("/calculate_xg", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...basePayload(), shot_x: sx, shot_y: sy }),
      });
      state.result = await res.json();
    } catch (e) { state.result = { error: String(e) }; }
    renderCards();
  }, 140);
}
let gridTimer = null;
function fetchGrid() {
  if (!state.showHeat) { state.heat = null; renderPitch(); return; }
  clearTimeout(gridTimer);
  gridTimer = setTimeout(async () => {
    try {
      const res = await fetch("/calculate_xg_grid", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(basePayload()),
      });
      const dd = await res.json();
      state.heat = (dd.grid || []).map((c) => ({ x: c.x * P_L / 120, y: c.y * P_W / 80, xg: c.xg }));
    } catch { state.heat = null; }
    renderPitch();
  }, 200);
}

// ==================== PSxG: GK biomechanics (port of GoalFrameLab) ====================
const GOAL_W = 7.32, GOAL_H = 2.44, GF_SCALE = 100, PADDING = 16;
const GF_W = GOAL_W * GF_SCALE, GF_H = GOAL_H * GF_SCALE;
const TOTAL_W = GF_W + PADDING * 2, TOTAL_H = GF_H + PADDING + 20;
const ZCOLS = 4, ZROWS = 3, ZW = GOAL_W / ZCOLS, ZH = GOAL_H / ZROWS;
const GROUND_Y = PADDING + GF_H;
// GK constants (from predict_server.py)
const GK_REACTION = 0.15, GK_H = 4.0, GK_V = 2.5;

const gfToSvg = (x, y) => [PADDING + x * GF_SCALE, PADDING + (GOAL_H - y) * GF_SCALE];
const gfToGoal = (sx, sy) => [
  clamp((sx - PADDING) / GF_SCALE, 0.01, GOAL_W - 0.01),
  clamp(GOAL_H - (sy - PADDING) / GF_SCALE, 0.01, GOAL_H - 0.01),
];

// Exact port of calculatePhysicsLocally (mirrors predict_server.py)
function calcPhysics(ballX, ballY, gkX, gkY, shotSpeed, shotDistance, opts = {}) {
  const gkYc = Math.max(0, gkY);
  const hd = Math.abs(ballX - gkX), vd = Math.abs(ballY - gkYc);
  const diveDist = Math.hypot(hd, vd);
  const speedMs = shotSpeed / 3.6;
  const ballTime = speedMs > 0 ? shotDistance / speedMs : 999;
  const hTime = hd / GK_H, vTime = vd / GK_V;
  const reaction = GK_REACTION + (opts.reactionPenalty || 0);
  const diveTime = reaction + Math.max(hTime, vTime);
  const margin = diveTime - ballTime;
  let psxg;
  if (margin > 0.3) psxg = 0.95;
  else if (margin > 0.15) psxg = 0.75 + (margin - 0.15) * 1.33;
  else if (margin > 0.05) psxg = 0.55 + (margin - 0.05) * 2.0;
  else if (margin > -0.05) psxg = 0.15 + (margin + 0.05) * 4.0;
  else if (margin > -0.15) psxg = 0.08 + (margin + 0.15) * 0.70;
  else if (margin > -0.3) psxg = 0.03 + (margin + 0.3) * 0.33;
  else psxg = 0.03;
  const basePsxg = psxg;
  let highBonus = 0, wideBonus = 0, closeKeeperPenalty = 0, craftBonus = 0;
  if (ballY > 2.0) {
    const before = psxg;
    psxg = Math.min(0.99, psxg + 0.12);
    highBonus = psxg - before;
  }
  if (ballX < 0.5 || ballX > GOAL_W - 0.5) {
    const before = psxg;
    psxg = Math.min(0.99, psxg + 0.10);
    wideBonus = psxg - before;
  }
  if (diveDist < 0.5) {
    const before = psxg;
    psxg = Math.max(0.03, psxg * 0.2);
    closeKeeperPenalty = before - psxg;
  }
  if (opts.psxgBonus) {
    const before = psxg;
    psxg = Math.min(0.99, psxg + opts.psxgBonus);
    craftBonus = psxg - before;
  }
  psxg = Math.max(0.01, Math.min(0.99, psxg));
  let diff;
  if (margin > 0.2) diff = "Very Hard";
  else if (margin > 0.05) diff = "Hard";
  else if (margin > -0.05) diff = "Medium";
  else if (margin > -0.15) diff = "Moderate";
  else diff = "Easy";
  return {
    psxg, diveDist, ballTime, diveTime, margin, diff, speedMs,
    hd, vd, hTime, vTime, reaction, basePsxg,
    highBonus, wideBonus, closeKeeperPenalty, craftBonus,
  };
}

function renderPsxgFormula(p = state.psxgCalc, dist = state.psxgDistance) {
  const box = $("psxgFormulaLive");
  if (!box || !p || dist == null) return;
  const result = state.result && !state.result.error ? state.result : null;
  const combined = result && state.psxg != null ? result.xg * state.psxg : null;
  const marginSign = p.margin > 0 ? "+" : "";
  const highText = p.highBonus ? `+${pct(p.highBonus)}` : "+0.0%";
  const wideText = p.wideBonus ? `+${pct(p.wideBonus)}` : "+0.0%";
  const closeText = p.closeKeeperPenalty ? `-${pct(p.closeKeeperPenalty)}` : "-0.0%";
  const craftText = p.craftBonus ? `+${pct(p.craftBonus)}` : "+0.0%";
  box.innerHTML = `
    <span>Shot distance</span><b>${dist.toFixed(2)} m</b>
    <span>Shot speed</span><b>${state.shotSpeed.toFixed(0)} km/h / 3.6 = ${p.speedMs.toFixed(2)} m/s</b>
    <span>Ball time</span><b>${dist.toFixed(2)} / ${p.speedMs.toFixed(2)} = ${p.ballTime.toFixed(3)} s</b>
    <span>GK dx / dy</span><b>${p.hd.toFixed(2)} m / ${p.vd.toFixed(2)} m</b>
    <span>GK dive</span><b>sqrt(${p.hd.toFixed(2)}^2 + ${p.vd.toFixed(2)}^2) = ${p.diveDist.toFixed(2)} m</b>
    <span>GK reach</span><b>${p.reaction.toFixed(3)} + max(${p.hTime.toFixed(3)}, ${p.vTime.toFixed(3)}) = ${p.diveTime.toFixed(3)} s</b>
    <span>Time margin</span><b>${p.diveTime.toFixed(3)} - ${p.ballTime.toFixed(3)} = ${marginSign}${p.margin.toFixed(3)} s</b>
    <span>Base PSxG from margin</span><b>${pct(p.basePsxg)}</b>
    <span>High / wide target bonus</span><b>${highText} / ${wideText}</b>
    <span>Close keeper penalty</span><b>${closeText}</b>
    <span>Direct FK craft bonus</span><b>${craftText}</b>
    <span>Final PSxG</span><b>${pct(p.psxg)}</b>
    ${combined != null ? `<span>Combined</span><b>${pct(result.xg)} x ${pct(state.psxg)} = ${pct(combined)}</b>` : ""}
  `;
}
function zoneFill(v) {
  if (v >= 0.80) return "rgba(233,30,99,0.65)";
  if (v >= 0.65) return "rgba(233,30,99,0.50)";
  if (v >= 0.50) return "rgba(255,152,0,0.55)";
  if (v >= 0.35) return "rgba(255,193,7,0.50)";
  if (v >= 0.25) return "rgba(139,195,74,0.50)";
  return "rgba(76,175,80,0.55)";
}
function zoneName(x, y) {
  const col = x < GOAL_W / 3 ? "L" : x < (2 * GOAL_W) / 3 ? "C" : "R";
  const row = y < GOAL_H / 3 ? "LOW" : y < (2 * GOAL_H) / 3 ? "MID" : "TOP";
  return `${row} ${col}`;
}

function computePsxg() {
  const dist = distM(modelShotPoint()); // shot distance = ball's position on the pitch
  const p = calcPhysics(state.ball[0], state.ball[1], state.gkf[0], state.gkf[1], state.shotSpeed, dist, fkPhysicsOpts());
  state.psxg = p.psxg;
  state.psxgCalc = p;
  state.psxgDistance = dist;
  $("distVal").textContent = dist.toFixed(1);
  $("mBall").textContent = p.ballTime.toFixed(3) + "s";
  $("mReach").textContent = p.diveTime.toFixed(3) + "s";
  $("mMargin").textContent = (p.margin > 0 ? "+" : "") + p.margin.toFixed(3) + "s";
  $("mMargin").style.color = p.margin < 0 ? "#f87171" : "#4ade80";
  $("mDive").textContent = p.diveDist.toFixed(2) + "m";
  $("mDiff").textContent = p.diff;
  $("mPsxg").textContent = pct(p.psxg);
  renderPsxgFormula(p, dist);
  return p.psxg;
}

// port of GoalkeeperMarker: keeper stands on the ground, arms/gloves reach cy
function gkFigure(cx, cy, groundY) {
  const footY = groundY, shoulderY = groundY - 150, headY = groundY - 170;
  const handRestY = groundY - 95, gloveY = Math.min(cy, handRestY), gdx = 33;
  const armL = `M ${cx - 19},${shoulderY} Q ${cx - 46},${gloveY - 6} ${cx - gdx},${gloveY}`;
  const armR = `M ${cx + 19},${shoulderY} Q ${cx + 46},${gloveY - 6} ${cx + gdx},${gloveY}`;
  const glove = (gx) => `<ellipse cx="${gx}" cy="${gloveY + 2}" rx="8" ry="9" fill="rgba(120,120,132,.95)"/><ellipse cx="${gx}" cy="${gloveY + 2}" rx="6.5" ry="7.5" fill="#fff"/>`;
  return `<g>
    <rect x="${cx - 36}" y="${groundY - 188}" width="72" height="196" fill="transparent"/>
    <path d="M ${cx - 8},${footY - 72} L ${cx - 10},${footY - 8}" fill="none" stroke="rgba(200,40,40,.95)" stroke-width="12" stroke-linecap="round"/>
    <path d="M ${cx + 8},${footY - 72} L ${cx + 10},${footY - 8}" fill="none" stroke="rgba(200,40,40,.95)" stroke-width="12" stroke-linecap="round"/>
    <ellipse cx="${cx - 14}" cy="${footY - 5}" rx="14" ry="6.5" fill="rgba(22,22,28,.95)" stroke="#fff" stroke-width="1.5"/>
    <ellipse cx="${cx + 14}" cy="${footY - 5}" rx="14" ry="6.5" fill="rgba(22,22,28,.95)" stroke="#fff" stroke-width="1.5"/>
    <path d="M ${cx - 18},${footY - 100} L ${cx + 18},${footY - 100} L ${cx + 18},${footY - 72} L ${cx - 18},${footY - 72} Z" fill="rgba(28,28,40,.97)" stroke="#fff" stroke-width="1.5"/>
    <path d="${armL}" fill="none" stroke="rgba(214,52,52,.97)" stroke-width="11" stroke-linecap="round"/>
    <path d="${armR}" fill="none" stroke="rgba(214,52,52,.97)" stroke-width="11" stroke-linecap="round"/>
    <path d="M ${cx - 24},${shoulderY - 4} Q ${cx},${shoulderY - 12} ${cx + 24},${shoulderY - 4} L ${cx + 18},${footY - 100} L ${cx - 18},${footY - 100} Z" fill="rgba(214,52,52,.97)" stroke="#fff" stroke-width="2"/>
    ${glove(cx - gdx)}${glove(cx + gdx)}
    <rect x="${cx - 5}" y="${headY + 4}" width="10" height="14" fill="rgba(238,198,172,.98)"/>
    <circle cx="${cx}" cy="${headY}" r="13" fill="rgba(238,198,172,.98)" stroke="#fff" stroke-width="1.5"/>
    <text x="${cx}" y="${footY - 122}" text-anchor="middle" fill="#fff" font-size="11" font-weight="bold" pointer-events="none">GK</text>
  </g>`;
}

function renderGoalframe() {
  goalframe.setAttribute("viewBox", `0 0 ${TOTAL_W} ${TOTAL_H}`);
  const [gkSvgX, gkSvgY] = gfToSvg(state.gkf[0], state.gkf[1]);
  const [ballSvgX, ballSvgY] = gfToSvg(state.ball[0], state.ball[1]);
  const ballCol = clamp(Math.floor(state.ball[0] / ZW), 0, ZCOLS - 1);
  const ballRow = clamp(Math.floor(state.ball[1] / ZH), 0, ZROWS - 1); // 0 = bottom
  const dist = distM(modelShotPoint()); // shot distance is driven by the ball on the pitch
  const cur = calcPhysics(state.ball[0], state.ball[1], state.gkf[0], state.gkf[1], state.shotSpeed, dist, fkPhysicsOpts());

  let svg = "";
  // frame + net
  svg += `<rect x="${PADDING - 5}" y="${PADDING - 5}" width="${GF_W + 10}" height="${GF_H + 10}" fill="none" stroke="#fff" stroke-width="8" rx="2"/>`;
  svg += `<rect x="${PADDING}" y="${PADDING}" width="${GF_W}" height="${GF_H}" fill="rgba(0,80,0,0.4)"/>`;
  for (let i = 0; i < 30; i++) { const x = PADDING + i * (GF_W / 29); svg += `<line x1="${x}" y1="${PADDING}" x2="${x}" y2="${PADDING + GF_H}" stroke="rgba(255,255,255,.06)" stroke-width="1"/>`; }
  for (let i = 0; i < 10; i++) { const y = PADDING + i * (GF_H / 9); svg += `<line x1="${PADDING}" y1="${y}" x2="${PADDING + GF_W}" y2="${y}" stroke="rgba(255,255,255,.06)" stroke-width="1"/>`; }

  // 12-zone PSxG grid (computed client-side at each zone centre)
  for (let svgR = 0; svgR < ZROWS; svgR++) for (let c = 0; c < ZCOLS; c++) {
    const xc = (c + 0.5) * ZW, yc = GOAL_H - (svgR + 0.5) * ZH;
    const v = calcPhysics(xc, yc, state.gkf[0], state.gkf[1], state.shotSpeed, dist, fkPhysicsOpts()).psxg;
    const zx = PADDING + c * ZW * GF_SCALE, zy = PADDING + svgR * ZH * GF_SCALE;
    const zw = ZW * GF_SCALE, zh = ZH * GF_SCALE;
    const active = c === ballCol && svgR === ZROWS - 1 - ballRow;
    svg += `<rect x="${zx}" y="${zy}" width="${zw}" height="${zh}" fill="${zoneFill(v)}" stroke="${active ? "yellow" : "rgba(255,255,255,.25)"}" stroke-width="${active ? 4 : 1}"/>`;
    svg += `<text x="${zx + zw / 2}" y="${zy + zh / 2 + 2}" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="18" font-weight="bold" pointer-events="none">${v.toFixed(2)}</text>`;
  }

  // anisotropic GK reach ellipse
  const reachWindow = Math.max(0, cur.ballTime - 0.15);
  const rx = Math.max(0.5, reachWindow * GK_H) * GF_SCALE, ry = Math.max(0.5, reachWindow * GK_V) * GF_SCALE;
  svg += `<g pointer-events="none"><ellipse cx="${gkSvgX}" cy="${gkSvgY}" rx="${rx}" ry="${ry}" fill="rgba(34,197,94,.18)" stroke="rgba(34,197,94,.85)" stroke-width="1.5" stroke-dasharray="6 4"/>`;
  svg += `<text x="${gkSvgX}" y="${gkSvgY - ry - 6}" text-anchor="middle" fill="rgba(34,197,94,.95)" font-size="11" font-weight="bold">GK reach in ${cur.ballTime.toFixed(2)}s</text></g>`;

  // GK figure (grabbable) + ball
  svg += `<g data-gf="gk" style="cursor:grab">${gkFigure(gkSvgX, gkSvgY, GROUND_Y)}</g>`;
  svg += `<g data-gf="ball" style="cursor:grab"><circle cx="${ballSvgX}" cy="${ballSvgY}" r="16" fill="#fff" stroke="#333" stroke-width="2"/><circle cx="${ballSvgX}" cy="${ballSvgY}" r="12" fill="none" stroke="rgba(0,0,0,.15)" stroke-width="1"/><text x="${ballSvgX}" y="${ballSvgY + 28}" text-anchor="middle" fill="#fff" font-size="12" font-weight="bold" pointer-events="none">BALL</text></g>`;

  // ground label + HUD badge
  svg += `<text x="${TOTAL_W / 2}" y="${PADDING + GF_H + 15}" text-anchor="middle" fill="rgba(255,255,255,.35)" font-size="12" letter-spacing="3">GROUND LEVEL</text>`;
  const hudX = PADDING + GF_W - 178, hudY = PADDING + 8;
  svg += `<rect x="${hudX}" y="${hudY}" width="164" height="46" rx="7" fill="rgba(5,12,22,.78)" stroke="rgba(255,255,255,.18)" stroke-width="1"/>`;
  svg += `<text x="${hudX + 12}" y="${hudY + 20}" fill="#fff" font-size="15" font-weight="bold">PSxG ${(cur.psxg * 100).toFixed(1)}%</text>`;
  const craftText = isDirectFK() ? ` / craft +${(fkCraftBonus() * 100).toFixed(1)}%` : "";
  svg += `<text x="${hudX + 12}" y="${hudY + 36}" fill="rgba(255,255,255,.72)" font-size="11">${zoneName(state.ball[0], state.ball[1])} / ${cur.diff}${craftText}</text>`;

  goalframe.innerHTML = svg;
}

// ==================== DRAG (pitch) ====================
let drag = null;
function pitchPointFromEvent(e) {
  const r = pitch.getBoundingClientRect();
  return [
    clamp(+(X0 + ((e.clientX - r.left) / r.width) * VW).toFixed(1), X0, X1),
    clamp(+(Y0 + ((e.clientY - r.top) / r.height) * VH).toFixed(1), Y0, Y1),
  ];
}
pitch.addEventListener("pointerdown", (e) => {
  const t = e.target.closest("[data-drag]"); if (!t) return;
  e.preventDefault();
  drag = { kind: t.getAttribute("data-drag"), idx: t.hasAttribute("data-idx") ? +t.getAttribute("data-idx") : undefined };
});

// ==================== DRAG (goal-frame) ====================
let gfDrag = null;
goalframe.addEventListener("pointerdown", (e) => {
  const t = e.target.closest("[data-gf]"); if (!t) return;
  e.preventDefault(); gfDrag = t.getAttribute("data-gf");
});
function gfPointFromEvent(e) {
  const r = goalframe.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * TOTAL_W, ((e.clientY - r.top) / r.height) * TOTAL_H];
}

window.addEventListener("pointermove", (e) => {
  if (drag) {
    let p = pitchPointFromEvent(e);
    const { kind, idx } = drag;
    if (kind === "shot") state.shot = p;
    else if (kind === "gk") state.gk = p;
    else if (kind === "start") { if (state.spType.startsWith("throwin")) p = [p[0], p[1] < 34 ? 0.5 : 67.5]; if (!isCorner()) state.start = p; }
    else if (kind === "def") state.defenders[idx] = p;
    else if (kind === "atk") state.attackers[idx] = p;
    renderPitch();
    fetchXG(); if (state.showHeat) fetchGrid();
    // the pitch drives the PSxG shot distance: moving the ball re-runs the reach race
    if (kind === "shot" || (kind === "start" && isDirectFK())) { renderGoalframe(); computePsxg(); renderCards(); }
  } else if (gfDrag) {
    const [sx, sy] = gfPointFromEvent(e);
    const [mx, my] = gfToGoal(sx, sy);
    if (gfDrag === "ball") state.ball = [mx, my];
    else state.gkf = [clamp(mx, 0.5, GOAL_W - 0.5), clamp(my, 0, 1.5)];
    renderPitch(); renderGoalframe(); computePsxg(); renderCards();
  }
});
window.addEventListener("pointerup", () => { drag = null; gfDrag = null; });

// ==================== CONTROLS ====================
function syncControls() {
  normalizeForSetPiece();
  $("spType").value = state.spType;
  $("swing").value = state.swing;
  $("height").value = state.height;
  $("body").value = state.body;
  $("speed").value = state.shotSpeed;
  $("speedVal").textContent = state.shotSpeed;
  $("power").value = state.shotSpeed;
  $("powerVal").textContent = state.shotSpeed;
  $("curve").value = state.curve;
  $("curveVal").textContent = curveLabel(state.curve);
  $("dip").value = state.dip;
  $("dipVal").textContent = state.dip;
  $("knuckle").value = state.knuckle;
  $("knuckleVal").textContent = state.knuckle;
  $("wallSize").value = state.wallSize;
  $("wallSizeVal").textContent = state.wallSize;
  $("wallDist").value = state.wallDistance;
  $("wallDistVal").textContent = state.wallDistance.toFixed(1);
  $("wallShift").value = state.wallShift;
  $("wallShiftVal").textContent = wallShiftLabel(state.wallShift);
  syncFinishOptions();
  syncDeliveryVisibility();
}

function syncFinishOptions() {
  const body = $("body");
  [...body.options].forEach((opt) => {
    opt.disabled = isDirectFK() && opt.value === "Head";
    opt.hidden = isDirectFK() && opt.value === "Head";
  });
}

function setActivePreset(key) {
  document.querySelectorAll(".preset").forEach((btn) => btn.classList.toggle("on", btn.dataset.preset === key));
}

function applyPreset(key) {
  const p = PRESETS[key];
  if (!p) return;
  state.spType = p.spType;
  state.shot = [...p.shot];
  state.gk = [...p.gk];
  state.start = [...p.start];
  state.defenders = p.defenders.map((x) => [...x]);
  state.attackers = p.attackers.map((x) => [...x]);
  state.swing = p.swing;
  state.height = p.height;
  state.body = p.body;
  if (p.ball) state.ball = [...p.ball];
  if (p.gkf) state.gkf = [...p.gkf];
  if (p.shotSpeed) state.shotSpeed = p.shotSpeed;
  state.curve = p.curve ?? 0;
  state.dip = p.dip ?? 30;
  state.knuckle = p.knuckle ?? 0;
  state.wallSize = p.wallSize ?? defaultWallSizeFor(p.spType);
  state.wallDistance = p.wallDistance ?? 9;
  state.wallShift = p.wallShift ?? 0;
  normalizeForSetPiece();
  $("scenarioName").textContent = p.name;
  setActivePreset(key);
  syncControls();
  renderPitch();
  renderGoalframe();
  computePsxg();
  fetchXG();
  if (state.showHeat) fetchGrid();
}

function syncDeliveryVisibility() {
  const show = !isDirectFK();
  document.querySelectorAll(".delivery").forEach((el) => { el.style.display = show ? "flex" : "none"; });
  $("directFkControls").classList.toggle("open", isDirectFK());
  $("wallControls").classList.toggle("open", isFreeKick());
}
$("spType").addEventListener("change", (e) => {
  state.spType = e.target.value;
  state.start = defaultStart(state.spType);
  state.wallSize = defaultWallSizeFor(state.spType);
  state.wallDistance = 9;
  state.wallShift = 0;
  normalizeForSetPiece();
  $("scenarioName").textContent = "Custom setup";
  setActivePreset("");
  syncControls();
  renderPitch();
  renderGoalframe();
  computePsxg();
  fetchXG(); if (state.showHeat) fetchGrid();
});
$("swing").addEventListener("change", (e) => { state.swing = e.target.value; $("scenarioName").textContent = "Custom setup"; setActivePreset(""); renderPitch(); fetchXG(); if (state.showHeat) fetchGrid(); });
$("height").addEventListener("change", (e) => { state.height = e.target.value; $("scenarioName").textContent = "Custom setup"; setActivePreset(""); fetchXG(); if (state.showHeat) fetchGrid(); });
$("body").addEventListener("change", (e) => {
  state.body = e.target.value;
  normalizeForSetPiece();
  syncControls();
  $("scenarioName").textContent = "Custom setup";
  setActivePreset("");
  renderPitch(); renderGoalframe(); computePsxg(); renderCards();
  fetchXG(); if (state.showHeat) fetchGrid();
});
$("addDef").addEventListener("click", () => { state.defenders.push([96, 34]); renderPitch(); fetchXG(); if (state.showHeat) fetchGrid(); });
$("delDef").addEventListener("click", () => { state.defenders.pop(); renderPitch(); fetchXG(); if (state.showHeat) fetchGrid(); });
$("addAtk").addEventListener("click", () => { state.attackers.push([98, 38]); renderPitch(); fetchXG(); if (state.showHeat) fetchGrid(); });
$("delAtk").addEventListener("click", () => { state.attackers.pop(); renderPitch(); fetchXG(); if (state.showHeat) fetchGrid(); });
$("heatBtn").addEventListener("click", (e) => { state.showHeat = !state.showHeat; e.target.classList.toggle("on", state.showHeat); fetchGrid(); });
$("vorBtn").addEventListener("click", (e) => { state.showVor = !state.showVor; e.target.classList.toggle("on", state.showVor); renderPitch(); });
$("speed").addEventListener("input", (e) => {
  state.shotSpeed = +e.target.value;
  $("speedVal").textContent = e.target.value;
  $("power").value = state.shotSpeed;
  $("powerVal").textContent = state.shotSpeed;
  renderGoalframe(); computePsxg(); renderCards();
});
$("power").addEventListener("input", (e) => {
  state.shotSpeed = +e.target.value;
  $("powerVal").textContent = e.target.value;
  $("speed").value = state.shotSpeed;
  $("speedVal").textContent = state.shotSpeed;
  renderGoalframe(); computePsxg(); renderCards();
});
$("curve").addEventListener("input", (e) => {
  state.curve = +e.target.value;
  $("curveVal").textContent = curveLabel(state.curve);
  renderPitch(); renderGoalframe(); computePsxg(); renderCards();
});
$("dip").addEventListener("input", (e) => {
  state.dip = +e.target.value;
  $("dipVal").textContent = state.dip;
  renderPitch(); renderGoalframe(); computePsxg(); renderCards();
});
$("knuckle").addEventListener("input", (e) => {
  state.knuckle = +e.target.value;
  $("knuckleVal").textContent = state.knuckle;
  renderGoalframe(); computePsxg(); renderCards();
});
$("wallSize").addEventListener("input", (e) => {
  state.wallSize = +e.target.value;
  $("wallSizeVal").textContent = state.wallSize;
  renderPitch(); fetchXG(); if (state.showHeat) fetchGrid();
});
$("wallDist").addEventListener("input", (e) => {
  state.wallDistance = +e.target.value;
  $("wallDistVal").textContent = state.wallDistance.toFixed(1);
  renderPitch(); fetchXG(); if (state.showHeat) fetchGrid();
});
$("wallShift").addEventListener("input", (e) => {
  state.wallShift = +e.target.value;
  $("wallShiftVal").textContent = wallShiftLabel(state.wallShift);
  renderPitch(); fetchXG(); if (state.showHeat) fetchGrid();
});
document.querySelectorAll(".preset").forEach((btn) => btn.addEventListener("click", () => applyPreset(btn.dataset.preset)));

// ==================== VALIDATE MATCH DATA ====================
function valRow(label, m) {
  if (!m) return "";
  const cal = m.calibration == null ? "&mdash;" : m.calibration.toFixed(3);
  return `<tr><td>${label}</td><td>${m.n}</td><td>${m.goals}</td><td>${pct(m.actual_rate)}</td><td>${pct(m.pred_rate)}</td><td>${cal}</td><td>${m.brier}</td><td>${m.log_loss}</td><td>${m.auc == null ? "&mdash;" : m.auc}</td></tr>`;
}
// ---- per-shot navigator: place each uploaded shot on the pitch + goal-frame ----
let valShots = [], valIdx = 0;
const SW_OPTS = ["Inswinging", "Outswinging", "Straight"];
const HT_OPTS = ["High Pass", "Low Pass", "Ground Pass"];
const BD_OPTS = ["Head", "Right Foot", "Left Foot"];
function mapSpType(s) {
  if (s.sp === "corner") return s.side === "left" ? "corner-left" : "corner-right";
  if (s.sp === "freekick") return s.shot_type === "Free Kick" ? "freekick-direct" : "freekick-cross";
  return "throwin-long";
}
function showShot(i) {
  if (!valShots.length) return;
  valIdx = (i + valShots.length) % valShots.length;
  const s = valShots[valIdx];
  // place on the pitch (convert StatsBomb 120x80 -> real metres 105x68)
  state.spType = mapSpType(s);
  state.start = defaultStart(state.spType);
  if (s.loc_x != null && s.loc_y != null) state.shot = [+(s.loc_x * 105 / 120).toFixed(1), +(s.loc_y * 68 / 80).toFixed(1)];
  if (s.gk_x != null && s.gk_y != null) state.gk = [+(s.gk_x * 105 / 120).toFixed(1), +(s.gk_y * 68 / 80).toFixed(1)];
  // real freeze-frame box players (StatsBomb coords -> metres); [] if the CSV has none
  let players = { d: [], a: [] };
  try { if (s.players) players = JSON.parse(s.players); } catch { players = { d: [], a: [] }; }
  const toMet = (p) => [+(p[0] * 105 / 120).toFixed(1), +(p[1] * 68 / 80).toFixed(1)];
  state.defenders = (players.d || []).map(toMet);
  state.attackers = (players.a || []).map(toMet);
  if (SW_OPTS.includes(s.tech)) state.swing = s.tech;
  if (HT_OPTS.includes(s.height)) state.height = s.height;
  if (BD_OPTS.includes(s.body)) state.body = s.body;
  state.wallSize = state.spType === "freekick-direct" ? Math.round(+s.wall_size || defaultWallSizeFor(state.spType)) : defaultWallSizeFor(state.spType);
  state.wallDistance = 9;
  state.wallShift = 0;
  normalizeForSetPiece();
  $("spType").value = state.spType; $("swing").value = state.swing;
  $("height").value = state.height; $("body").value = state.body;
  syncControls();
  renderPitch();
  // the goal-frame shot distance follows the ball we just placed on the pitch
  const dm = distM(state.shot);
  renderGoalframe(); computePsxg();
  // populate the cards from the model's validation prediction for this shot
  state.result = {
    xg: s.xg, p_shot: s.p_shot,
    setpiece_value: s.p_shot != null ? +(s.xg * s.p_shot).toFixed(4) : null,
    zone: s.zone, marking_label: s.mark, distance_to_goal: +dm.toFixed(2),
    derived: { defenders_in_box: s.def_box, attackers_in_box: s.atk_box, wall_size: s.wall_size ?? "" },
  };
  renderCards();
  renderShotNav();
}
function renderShotNav() {
  const s = valShots[valIdx]; if (!s) return;
  $("shotIdx").textContent = `Shot ${valIdx + 1} / ${valShots.length}`;
  const goal = s.is_goal ? `<b style="color:#4ade80">GOAL</b>` : `<span style="color:#93a2bd">no goal</span>`;
  const desc = [s.sp, s.zone, s.tech, s.height, s.body].filter(Boolean).join(" &middot; ");
  $("shotReadout").innerHTML =
    `<span class="ro-desc">${desc}</span>` +
    `<span>in box <b style="color:#dc2626">${s.def_box ?? 0}</b> def / <b style="color:#2563eb">${s.atk_box ?? 0}</b> atk - marking <b>${s.mark || "&mdash;"}</b></span>` +
    `<span>model xG <b>${pct(s.xg)}</b></span>` +
    `<span>PSxG <b>${pct(state.psxg)}</b></span>` +
    `<span>StatsBomb xG <b>${s.sb_xg != null ? s.sb_xg.toFixed(2) : "&mdash;"}</b></span>` +
    `<span>actual: ${goal}</span>`;
}
function renderValidation(d, name) {
  $("shotNav").hidden = true; valShots = [];
  if (d.error) { $("valOut").innerHTML = `<div class="err">${d.error}</div>`; return; }
  let h = `<div class="val-meta"><b>${name}</b> &mdash; ${d.n} shots scored${d.skipped ? `, ${d.skipped} skipped` : ""}</div>`;
  h += `<table class="val-table"><thead><tr><th>Set piece</th><th>Shots</th><th>Goals</th><th>Actual</th><th>Pred xG</th><th>Calib</th><th>Brier</th><th>LogLoss</th><th>AUC</th></tr></thead><tbody>`;
  h += valRow("All", d.overall);
  ["corner", "freekick", "throwin"].forEach((k) => { if (d.by_type[k]) h += valRow(k, d.by_type[k]); });
  h += `</tbody></table>`;
  h += `<p class="val-note">Calibration = mean predicted xG &divide; actual goal rate (<b>1.00 = perfect</b>). ROC-AUC ~0.77&ndash;0.80 matches the training holdout. If this is the women's sample, none of it was used to train the model.</p>`;
  $("valOut").innerHTML = h;
  // per-shot navigator
  valShots = Array.isArray(d.shots) ? d.shots : [];
  if (valShots.length) {
    $("shotNav").hidden = false;
    if (d.shots_total > valShots.length) $("shotReadout").dataset.capped = `${valShots.length} of ${d.shots_total}`;
    showShot(0);
  }
}
async function runValidate(text, name) {
  $("valStatus").textContent = `Scoring ${name}...`;
  $("valOut").innerHTML = "";
  try {
    const res = await fetch("/validate", { method: "POST", headers: { "Content-Type": "text/csv" }, body: text });
    renderValidation(await res.json(), name);
  } catch (e) { $("valOut").innerHTML = `<div class="err">${e}</div>`; }
  $("valStatus").textContent = "";
}
$("valBtn").addEventListener("click", () => $("valFile").click());
$("valFile").addEventListener("change", async (e) => { const f = e.target.files[0]; if (f) runValidate(await f.text(), f.name); });
$("shotPrev").addEventListener("click", () => showShot(valIdx - 1));
$("shotNext").addEventListener("click", () => showShot(valIdx + 1));
$("openValidate").addEventListener("click", () => document.querySelector(".validate").classList.add("open"));
$("closeValidate").addEventListener("click", () => document.querySelector(".validate").classList.remove("open"));
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelector(".validate").classList.remove("open");
});

// ==================== INIT ====================
applyPreset("nearPost");

