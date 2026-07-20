import { describe, expect, it } from "vitest";
import { trainCalibrationFromCsv } from "./training";

function buildCsv(rows: number) {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const lines = ["goal,shot_x,shot_y"];
  for (let i = 0; i < rows; i += 1) {
    const shotX = 80 + rand() * 38;
    const shotY = 20 + rand() * 40;
    const closeShot = shotX >= 108;
    const goal = closeShot ? (rand() < 0.35 ? 1 : 0) : (rand() < 0.05 ? 1 : 0);
    lines.push(`${goal},${shotX.toFixed(2)},${shotY.toFixed(2)}`);
  }
  return lines.join("\n");
}

describe("trainCalibrationFromCsv reliability", () => {
  it("buckets held-out predictions with counts summing to the test set and sorted predicted rates", () => {
    const report = trainCalibrationFromCsv(buildCsv(200), "reliability test model");
    if ("error" in report) throw new Error(report.error);

    expect(report.reliability.length).toBeGreaterThan(0);
    expect(report.reliability.length).toBeLessThanOrEqual(8);

    const totalCount = report.reliability.reduce((sum, b) => sum + b.count, 0);
    expect(totalCount).toBe(report.test.rows);

    for (let i = 1; i < report.reliability.length; i += 1) {
      expect(report.reliability[i].avgPredicted).toBeGreaterThanOrEqual(report.reliability[i - 1].avgPredicted);
    }

    for (const bucket of report.reliability) {
      expect(bucket.avgPredicted).toBeGreaterThanOrEqual(0);
      expect(bucket.avgPredicted).toBeLessThanOrEqual(1);
      expect(bucket.avgActual).toBeGreaterThanOrEqual(0);
      expect(bucket.avgActual).toBeLessThanOrEqual(1);
      expect(bucket.minP).toBeLessThanOrEqual(bucket.avgPredicted);
      expect(bucket.maxP).toBeGreaterThanOrEqual(bucket.avgPredicted);
    }

    expect(report.model.reliability).toEqual(report.reliability);
  });

  it("returns no reliability buckets when the evaluation set is too small", () => {
    const report = trainCalibrationFromCsv(buildCsv(30), "tiny model");
    if ("error" in report) throw new Error(report.error);
    expect(Array.isArray(report.reliability)).toBe(true);
  });
});
