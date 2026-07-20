import { describe, expect, it } from "vitest";
import { predict, zoneOf, type XgRequest } from "./deadball";

describe("zoneOf", () => {
  it("splits near-post vs far-post at the box mouth", () => {
    expect(zoneOf(114, 39)).toBe("near-post");
    expect(zoneOf(114, 40)).toBe("far-post");
  });

  it("flags the penalty-spot band inside the six/eighteen gap", () => {
    expect(zoneOf(106, 40)).toBe("penalty-spot");
    expect(zoneOf(106, 30)).toBe("central");
  });

  it("falls back through central, edge, and second-ball bands", () => {
    expect(zoneOf(102, 40)).toBe("central");
    expect(zoneOf(96, 40)).toBe("edge");
    expect(zoneOf(50, 40)).toBe("second-ball");
  });
});

describe("predict", () => {
  const cornerBase: XgRequest = {
    setpiece_type: "corner-right",
    shot_x: 101.5,
    shot_y: 31.5,
    gk: [104, 34],
    defenders: [[101, 32], [102.2, 34], [100.2, 36.2], [98.8, 30.5], [99.5, 38.5]],
    attackers: [[101.5, 31.5], [100.2, 33.5], [99.4, 37]],
    delivery_technique: "Inswinging",
    delivery_height: "High Pass",
    body_part: "Head",
  };

  it("scores a near-post header corner", () => {
    const r = predict({ ...cornerBase, shot_x: 115, shot_y: 32 });
    expect(r.zone).toBe("near-post");
    expect(r.model_used).toBe("ts_corner_heuristic");
    expect(r.features_used).toBe(30);
    expect(r.xg).toBeCloseTo(0.4245, 4);
    expect(r.setpiece_value).toBeCloseTo(r.xg * r.p_shot, 4);
  });

  it("scores a shot from deep in the second-ball zone lower than a near-post header", () => {
    const near = predict(cornerBase);
    const deep = predict({ ...cornerBase, shot_x: 88, shot_y: 40, defenders: [], attackers: [], gk: null });
    expect(deep.zone).toBe("second-ball");
    expect(deep.xg).toBeLessThan(near.xg);
  });

  it("clamps xg within the model's floor/ceiling for every zone", () => {
    for (const [shot_x, shot_y] of [[119, 40], [119, 79], [88, 0], [60, 40]] as const) {
      const r = predict({ ...cornerBase, shot_x, shot_y });
      expect(r.xg).toBeGreaterThanOrEqual(0.006);
      expect(r.xg).toBeLessThanOrEqual(0.62);
    }
  });

  it("penalizes a tight nearest defender relative to a covered shot with no immediate marker", () => {
    const tight = predict({ ...cornerBase, defenders: [[101.6, 31.6]] });
    const loose = predict({ ...cornerBase, defenders: [[95, 20]] });
    expect(tight.xg).toBeLessThan(loose.xg);
  });

  const directFkBase: XgRequest = {
    setpiece_type: "freekick-direct",
    shot_type: "Free Kick",
    shot_x: 84,
    shot_y: 32,
    gk: [104, 34],
    defenders: [[100, 38]],
    attackers: [[87, 31], [95, 40]],
    body_part: "Right Foot",
    shot_speed: 92,
    shot_curve: 62,
    shot_dip: 58,
    shot_knuckle: 12,
    shot_target_y: 34,
  };

  it("scores a direct free kick with p_shot forced to 1 and the wall feature count", () => {
    const r = predict(directFkBase);
    expect(r.p_shot).toBe(1);
    expect(r.setpiece_value).toBe(r.xg);
    expect(r.features_used).toBe(34);
    expect(r.xg).toBeCloseTo(0.0283, 4);
  });

  it("lowers xg as wall obstruction grows for an otherwise identical direct free kick", () => {
    const noWall = predict({ ...directFkBase, defenders: [] });
    const wall = predict({
      ...directFkBase,
      defenders: [[92, 30], [92, 32], [92, 34], [92, 36]],
    });
    expect(wall.derived.wall_obstruction).toBeGreaterThan(0);
    expect(wall.xg).toBeLessThan(noWall.xg);
  });

  it("raises xg with more curve/dip craft for an otherwise identical direct free kick", () => {
    const flat = predict({ ...directFkBase, shot_curve: 0, shot_dip: 0, shot_knuckle: 0 });
    const crafted = predict({ ...directFkBase, shot_curve: 90, shot_dip: 90, shot_knuckle: 90 });
    expect(crafted.xg).toBeGreaterThan(flat.xg);
  });

  it("applies a fixed penalty for crossed (non-direct) free kicks relative to a corner from the same spot", () => {
    const crossedFk = predict({ ...cornerBase, setpiece_type: "freekick-cross" });
    const corner = predict(cornerBase);
    expect(crossedFk.xg).toBeLessThan(corner.xg);
  });

  it("scores throw-ins lower than an equivalent corner, with long throws scoring above short ones", () => {
    const corner = predict(cornerBase);
    const shortThrow = predict({ ...cornerBase, setpiece_type: "throwin-short" });
    const longThrow = predict({ ...cornerBase, setpiece_type: "throwin-long" });
    expect(shortThrow.xg).toBeLessThan(corner.xg);
    expect(longThrow.xg).toBeGreaterThan(shortThrow.xg);
  });
});
