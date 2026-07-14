import type { XgResponse } from "../../lib/deadball";

export function recommendationFor(r: XgResponse, combined: number | null, isDirect: boolean) {
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

