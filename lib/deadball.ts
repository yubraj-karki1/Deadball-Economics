export type Point = [number, number];

export type ModelCalibration = {
  distanceWeight?: number;
  angleWeight?: number;
  wallPenalty?: number;
  craftBonus?: number;
  gkReaction?: number;
};

export type XgRequest = {
  setpiece_type?: string;
  shot_x: number;
  shot_y: number;
  gk?: Point | null;
  defenders?: Point[];
  attackers?: Point[];
  delivery_technique?: string;
  delivery_height?: string;
  delivery_length?: number;
  corner_side?: string;
  throw_distance?: number;
  body_part?: string;
  shot_technique?: string;
  shot_type?: string;
  shot_speed?: number;
  shot_curve?: number;
  shot_dip?: number;
  shot_knuckle?: number;
  shot_target_y?: number;
  calibration?: ModelCalibration;
  minute?: number;
};

export type XgResponse = {
  xg: number;
  p_shot: number;
  setpiece_value: number;
  model_used: string;
  setpiece_type: "corner" | "freekick" | "throwin";
  zone: string;
  marking_label: string;
  distance_to_goal: number;
  features_used: number;
  derived: Record<string, number | string>;
};

export type GridResponse = {
  grid: Array<{ x: number; y: number; xg: number }>;
  xs: number[];
  ys: number[];
};

const P_SHOT = {
  corner: 10348 / 26325,
  freekick: 14312 / 77344,
  throwin: 11395 / 114126,
};

const SETPIECE_TO_MODEL: Record<string, keyof typeof P_SHOT> = {
  corner: "corner",
  "corner-right": "corner",
  "corner-left": "corner",
  freekick: "freekick",
  "freekick-direct": "freekick",
  "freekick-cross": "freekick",
  throwin: "throwin",
  "throw-in": "throwin",
  "throwin-long": "throwin",
  "throwin-short": "throwin",
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));
const round4 = (v: number) => Math.round(v * 10000) / 10000;
const round2 = (v: number) => Math.round(v * 100) / 100;
const scale = (v: unknown, fallback = 1) => Number.isFinite(Number(v)) ? clamp(Number(v), 0.25, 2) : fallback;

export function pShotByType() {
  return P_SHOT;
}

export function modelKind(type = "corner"): keyof typeof P_SHOT {
  return SETPIECE_TO_MODEL[type] ?? "corner";
}

export function zoneOf(x: number, y: number): string {
  if (x >= 114 && y < 40) return "near-post";
  if (x >= 114) return "far-post";
  if (x >= 106) return 36 <= y && y <= 44 ? "penalty-spot" : "central";
  if (x >= 102) return "central";
  if (x >= 96) return "edge";
  return "second-ball";
}

function isDirectFreekick(req: Partial<XgRequest>, base?: string) {
  const sp = req.setpiece_type ?? "";
  return (base === "freekick" || sp === "freekick" || sp === "freekick-direct") && (
    sp === "freekick-direct" || req.shot_type === "Free Kick"
  );
}

function freeze(shot: Point, gk?: Point | null, defenders: Point[] = [], attackers: Point[] = []) {
  const out = {
    gk_x: 0,
    gk_y: 0,
    gk_dist_from_line: 0,
    gk_off_center: 0,
    nearest_defender_dist: 0,
    defenders_in_box: 0,
    defenders_in_6yard: 0,
    attackers_in_box: 0,
    n_freeze: 0,
  };

  if (gk) {
    out.n_freeze += 1;
    out.gk_x = gk[0];
    out.gk_y = gk[1];
    out.gk_dist_from_line = 120 - gk[0];
    out.gk_off_center = Math.abs(gk[1] - 40);
  }

  for (const [x, y] of defenders) {
    out.n_freeze += 1;
    if (102 <= x && x <= 120 && 18 <= y && y <= 62) out.defenders_in_box += 1;
    if (x >= 114 && 30 <= y && y <= 50) out.defenders_in_6yard += 1;
  }

  for (const [x, y] of attackers) {
    out.n_freeze += 1;
    if (102 <= x && x <= 120 && 18 <= y && y <= 62) out.attackers_in_box += 1;
  }

  if (defenders.length) {
    out.nearest_defender_dist = round2(Math.min(...defenders.map(([x, y]) => dist(shot[0], shot[1], x, y))));
  }

  return out;
}

function marking(defenders: Point[] = [], attackers: Point[] = []) {
  const bd = defenders.filter(([x, y]) => 102 <= x && x <= 120 && 18 <= y && y <= 62);
  const ba = attackers.filter(([x, y]) => 102 <= x && x <= 120 && 18 <= y && y <= 62);
  if (bd.length < 3 || ba.length < 1) {
    return { marking_label: "", man_ratio: 0, def_x_std: 0, def_y_std: 0 };
  }

  let paired = 0;
  for (const d of bd) {
    const nearest = ba.reduce((best, a) => {
      const d0 = dist(d[0], d[1], a[0], a[1]);
      return d0 < best[0] ? [d0, a[0]] as const : best;
    }, [Infinity, 0] as const);
    if (nearest[0] <= 2.5 && d[0] >= nearest[1] - 0.5) paired += 1;
  }

  const ratio = paired / bd.length;
  const xs = bd.map(([x]) => x);
  const ys = bd.map(([, y]) => y);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const xstd = Math.sqrt(xs.reduce((s, v) => s + (v - mx) ** 2, 0) / xs.length);
  const ystd = Math.sqrt(ys.reduce((s, v) => s + (v - my) ** 2, 0) / ys.length);

  return {
    marking_label: ratio >= 0.6 ? "man" : ratio <= 0.3 ? "zonal" : "mixed",
    man_ratio: round4(ratio),
    def_x_std: round2(xstd),
    def_y_std: round2(ystd),
  };
}

function wallProfile(shot: Point, defenders: Point[] = [], targetY = 40) {
  const [bx, by] = shot;
  const vx = 120 - bx;
  const vy = targetY - by;
  const length = Math.hypot(vx, vy) || 1;
  const ux = vx / length;
  const uy = vy / length;
  let size = 0;
  let obstruction = 0;

  for (const [px, py] of defenders) {
    const t = (px - bx) * ux + (py - by) * uy;
    // A regulation wall sits roughly 9.15 m from the ball. Restricting the
    // candidates prevents defenders near the goal from being counted as wall.
    if (t < 4 || t > Math.min(16, length - 0.5)) continue;
    const lateral = Math.abs((px - bx) * -uy + (py - by) * ux);
    if (lateral > 6) continue;
    size += 1;
    // Smooth coverage avoids abrupt xG drops when a player crosses a hard line.
    // Central blockers contribute most; players shifted away taper to zero.
    obstruction += clamp(1 - lateral / 2.4, 0, 1);
  }

  return { size, obstruction: Math.min(obstruction, 3.25) };
}

function directCraft(req: Partial<XgRequest>) {
  const curve = clamp(Math.abs(Number(req.shot_curve ?? 0)) / 100, 0, 1);
  const dip = clamp(Number(req.shot_dip ?? 0) / 100, 0, 1);
  const knuckle = clamp(Number(req.shot_knuckle ?? 0) / 100, 0, 1);
  const speed = clamp((Number(req.shot_speed ?? 85) - 40) / 100, 0, 1);
  const curveLogit = curve * 0.14;
  const dipLogit = dip * 0.32;
  const knuckleLogit = knuckle * 0.18;
  const speedLogit = speed * 0.08;
  const logit = curveLogit + dipLogit + knuckleLogit + speedLogit;

  return {
    shot_speed: round2(Number(req.shot_speed ?? 0)),
    shot_curve: round2(Number(req.shot_curve ?? 0)),
    shot_dip: round2(Number(req.shot_dip ?? 0)),
    shot_knuckle: round2(Number(req.shot_knuckle ?? 0)),
    direct_curve_logit: round4(curveLogit),
    direct_dip_logit: round4(dipLogit),
    direct_knuckle_logit: round4(knuckleLogit),
    direct_speed_logit: round4(speedLogit),
    direct_craft_logit: round4(logit),
  };
}

function heuristicXg(kind: keyof typeof P_SHOT, req: XgRequest, derived: ReturnType<typeof freeze>, mark: ReturnType<typeof marking>, wall: { size: number; obstruction: number }) {
  const x = Number(req.shot_x);
  const y = Number(req.shot_y);
  const distance = dist(x, y, 120, 40);
  const centrality = Math.abs(y - 40);
  const zone = zoneOf(x, y);
  const body = req.body_part ?? "";
  const delivery = req.delivery_technique ?? "";
  const height = req.delivery_height ?? "";
  const calibration = req.calibration ?? {};
  const distanceWeight = scale(calibration.distanceWeight);
  const angleWeight = scale(calibration.angleWeight);
  const wallPenalty = scale(calibration.wallPenalty);
  const craftBonus = scale(calibration.craftBonus);

  let logit = -2.45;
  logit += clamp((18 - distance) / 7.5, -2.1, 1.8) * distanceWeight;
  logit += clamp((7 - centrality) / 14, -0.8, 0.6) * angleWeight;
  logit += (x - 104) * 0.035;
  logit += derived.nearest_defender_dist ? clamp((derived.nearest_defender_dist - 1.5) * 0.14, -0.35, 0.35) : 0.08;
  logit -= Math.max(0, derived.defenders_in_6yard - 1) * 0.08;
  logit += Math.min(derived.attackers_in_box, 5) * 0.035;
  logit -= derived.gk_dist_from_line > 0 ? clamp((derived.gk_dist_from_line - 1.5) * 0.04, -0.12, 0.18) : 0;

  if (zone === "near-post" || zone === "far-post") logit += 0.32;
  if (zone === "penalty-spot") logit += 0.18;
  if (zone === "edge") logit -= 0.38;
  if (zone === "second-ball") logit -= 0.75;
  if (body === "Head") logit += kind === "corner" ? 0.08 : -0.04;
  if (body.includes("Foot")) logit += 0.04;
  if (delivery === "Inswinging") logit += 0.12;
  if (delivery === "Outswinging") logit -= 0.08;
  if (height === "Low Pass") logit += 0.1;
  if (height === "Ground Pass") logit -= 0.1;
  if (mark.marking_label === "man") logit -= 0.18;
  if (mark.marking_label === "zonal") logit += 0.08;

  if (kind === "freekick") {
    if (isDirectFreekick(req, kind)) {
      logit = -2.9
        + clamp((29 - distance) / 9.5, -1.25, 1.15) * distanceWeight
        - centrality * 0.018 * angleWeight
        - wall.obstruction * 0.085 * wallPenalty
        + directCraft(req).direct_craft_logit * craftBonus;
    } else {
      logit -= 0.16;
    }
  }

  if (kind === "throwin") {
    logit -= 0.1;
    if ((req.setpiece_type ?? "").includes("long")) logit += 0.14;
  }

  return clamp(sigmoid(logit), 0.006, 0.62);
}

export function predict(req: XgRequest): XgResponse {
  const kind = modelKind(req.setpiece_type);
  const base = kind;
  const shot: Point = [Number(req.shot_x), Number(req.shot_y)];
  const defenders = req.defenders ?? [];
  const attackers = req.attackers ?? [];
  const derived = freeze(shot, req.gk, defenders, attackers);
  const mark = marking(defenders, attackers);
  const direct = isDirectFreekick(req, base);
  const wall = direct ? wallProfile(shot, defenders, Number(req.shot_target_y ?? 40)) : { size: 0, obstruction: 0 };
  const craft = direct ? directCraft(req) : null;
  const xg = heuristicXg(kind, req, derived, mark, wall);
  const pShot = direct ? 1 : P_SHOT[kind];

  return {
    xg: round4(xg),
    p_shot: round4(pShot),
    setpiece_value: round4(xg * pShot),
    model_used: `ts_${kind}_heuristic`,
    setpiece_type: base,
    zone: zoneOf(shot[0], shot[1]),
    marking_label: mark.marking_label,
    distance_to_goal: round2(dist(shot[0], shot[1], 120, 40)),
    features_used: direct ? 34 : 30,
    derived: {
      ...derived,
      man_ratio: mark.man_ratio,
      wall_size: wall.size,
      wall_obstruction: round4(wall.obstruction),
      calibration_distance_weight: round2(scale(req.calibration?.distanceWeight)),
      calibration_angle_weight: round2(scale(req.calibration?.angleWeight)),
      calibration_wall_penalty: round2(scale(req.calibration?.wallPenalty)),
      calibration_craft_bonus: round2(scale(req.calibration?.craftBonus)),
      ...(craft ?? {}),
    },
  };
}

export function predictGrid(req: Omit<XgRequest, "shot_x" | "shot_y">): GridResponse {
  const xs = Array.from({ length: 13 }, (_, i) => round2(88 + i * 2.5));
  const ys = Array.from({ length: 23 }, (_, i) => round2(14 + i * 3));
  const grid = xs.flatMap((x) => ys.map((y) => ({ x, y, xg: predict({ ...req, shot_x: x, shot_y: y }).xg })));

  return { grid, xs, ys };
}
