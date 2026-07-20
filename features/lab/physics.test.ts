import { describe, expect, it } from "vitest";
import { calcPhysics } from "./physics";
import { DEFAULT_CALIBRATION, GOAL_H, GOAL_W } from "./constants";
import type { Point } from "../../lib/deadball";

describe("calcPhysics", () => {
  const centerBall: Point = [GOAL_W / 2, 1.1];
  const centeredGk: Point = [GOAL_W / 2, 0.3];
  const farGk: Point = [0.4, 0.2];

  it("gives a well-covered central shot a lower psxg than the same shot against a wrong-footed keeper", () => {
    const covered = calcPhysics(centerBall, centeredGk, 85, 18);
    const uncovered = calcPhysics(centerBall, farGk, 85, 18);
    expect(uncovered.psxg).toBeGreaterThan(covered.psxg);
  });

  it("locks in the psxg and diff label for a fixed corner-placed shot", () => {
    const r = calcPhysics([1, 2.2], [3.66, 0.5], 88, 20);
    expect(r.psxg).toBeCloseTo(0.5173, 4);
    expect(r.diff).toBe("Medium");
  });

  it("treats faster shots as harder to save than slower ones at the same placement", () => {
    const slow = calcPhysics([1, 2.2], [3.66, 0.5], 60, 20);
    const fast = calcPhysics([1, 2.2], [3.66, 0.5], 110, 20);
    expect(fast.psxg).toBeGreaterThanOrEqual(slow.psxg);
    expect(fast.ballTime).toBeLessThan(slow.ballTime);
  });

  it("heavily discounts a shot placed almost exactly at the keeper", () => {
    const pointBlank = calcPhysics(centeredGk, centeredGk, 85, 18);
    expect(pointBlank.psxg).toBeLessThanOrEqual(0.2);
  });

  it("adds a height bonus for shots placed above 2m and a post bonus near either post", () => {
    const midHeight = calcPhysics([GOAL_W / 2, 1.0], farGk, 85, 18);
    const highBall = calcPhysics([GOAL_W / 2, 2.2], farGk, 85, 18);
    expect(highBall.psxg).toBeGreaterThanOrEqual(midHeight.psxg);

    const central = calcPhysics([GOAL_W / 2, 1.0], centeredGk, 85, 18);
    const postSide = calcPhysics([0.2, 1.0], centeredGk, 85, 18);
    expect(postSide.psxg).toBeGreaterThanOrEqual(central.psxg);
  });

  it("raises psxg with a craft bonus and scales reaction time via calibration.gkReaction", () => {
    const noCraft = calcPhysics(centerBall, farGk, 85, 18, 0);
    const withCraft = calcPhysics(centerBall, farGk, 85, 18, 0.1);
    expect(withCraft.psxg).toBeGreaterThan(noCraft.psxg);

    const slowerReaction = calcPhysics(centerBall, farGk, 85, 18, 0, {
      ...DEFAULT_CALIBRATION,
      gkReaction: 2,
    });
    expect(slowerReaction.reaction).toBeGreaterThan(noCraft.reaction);
  });

  it("keeps psxg within the documented [0.01, 0.99] bounds", () => {
    for (const [ball, gk, speed, dist] of [
      [[0.05, 0.05], [GOAL_W - 0.1, 1.4], 130, 40],
      [[GOAL_W - 0.05, 2.3], [0.5, 0], 30, 6],
    ] as const) {
      const r = calcPhysics(ball as Point, gk as Point, speed, dist);
      expect(r.psxg).toBeGreaterThanOrEqual(0.01);
      expect(r.psxg).toBeLessThanOrEqual(0.99);
    }
  });
});
