import { predict, type ModelCalibration, type Point, type XgRequest } from "../../lib/deadball";
import { csvCell, parseCsv } from "./csv";

export type BatchScoreResult = { csv: string; scored: number; skipped: number } | { error: string };

function numOrUndef(raw: string | undefined) {
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parsePointArray(raw: string | undefined): Point[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is Point => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v)));
  } catch {
    return [];
  }
}

const OUTPUT_COLUMNS = ["xg", "p_shot", "setpiece_value", "zone", "marking_label", "distance_to_goal"] as const;

export function scoreShotsCsv(text: string, calibration: Required<ModelCalibration>): BatchScoreResult {
  const rows = parseCsv(text);
  if (rows.length === 0) return { error: "No data rows found. Expect a header row plus at least one shot." };
  if (!("shot_x" in rows[0]) && !("x" in rows[0]) && !("location_x" in rows[0])) {
    return { error: "CSV needs a shot_x (or x / location_x) column, and matching shot_y." };
  }

  const headers = Object.keys(rows[0]);
  const outLines = [[...headers, ...OUTPUT_COLUMNS].join(",")];
  let scored = 0;
  let skipped = 0;

  for (const row of rows) {
    const rawShotX = row.shot_x || row.x || row.location_x;
    const rawShotY = row.shot_y || row.y || row.location_y;
    const shotX = rawShotX ? Number(rawShotX) : NaN;
    const shotY = rawShotY ? Number(rawShotY) : NaN;
    const base = headers.map((h) => csvCell(row[h]));

    if (!Number.isFinite(shotX) || !Number.isFinite(shotY)) {
      skipped += 1;
      outLines.push([...base, "", "", "", "", "", ""].join(","));
      continue;
    }

    const gkX = Number(row.gk_x);
    const gkY = Number(row.gk_y);
    const request: XgRequest = {
      setpiece_type: row.setpiece_type || undefined,
      shot_x: shotX,
      shot_y: shotY,
      gk: Number.isFinite(gkX) && Number.isFinite(gkY) ? [gkX, gkY] : null,
      defenders: parsePointArray(row.defenders),
      attackers: parsePointArray(row.attackers),
      delivery_technique: row.delivery_technique || undefined,
      delivery_height: row.delivery_height || undefined,
      body_part: row.body_part || undefined,
      shot_type: row.shot_type || undefined,
      shot_speed: numOrUndef(row.shot_speed),
      shot_curve: numOrUndef(row.shot_curve),
      shot_dip: numOrUndef(row.shot_dip),
      shot_knuckle: numOrUndef(row.shot_knuckle),
      shot_target_y: numOrUndef(row.shot_target_y),
      calibration,
    };

    const result = predict(request);
    scored += 1;
    outLines.push([...base, result.xg, result.p_shot, result.setpiece_value, csvCell(result.zone), csvCell(result.marking_label), result.distance_to_goal].join(","));
  }

  return { csv: outLines.join("\n"), scored, skipped };
}
