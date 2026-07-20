import { describe, expect, it } from "vitest";
import { predict } from "../../lib/deadball";
import { DEFAULT_CALIBRATION } from "./constants";
import { scoreShotsCsv } from "./batch-scoring";

describe("scoreShotsCsv", () => {
  it("rejects a CSV with no shot_x/shot_y column", () => {
    const result = scoreShotsCsv("foo,bar\n1,2", DEFAULT_CALIBRATION);
    expect("error" in result).toBe(true);
  });

  it("scores a plain shot row identically to calling predict() directly", () => {
    const csv = "shot_x,shot_y,setpiece_type,gk_x,gk_y,body_part\n101.5,31.5,corner-right,104,34,Head";
    const result = scoreShotsCsv(csv, DEFAULT_CALIBRATION);
    if ("error" in result) throw new Error("unexpected error");
    expect(result.scored).toBe(1);
    expect(result.skipped).toBe(0);

    const expected = predict({ setpiece_type: "corner-right", shot_x: 101.5, shot_y: 31.5, gk: [104, 34], body_part: "Head", calibration: DEFAULT_CALIBRATION });
    const lines = result.csv.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("shot_x,shot_y,setpiece_type,gk_x,gk_y,body_part,xg,p_shot,setpiece_value,zone,marking_label,distance_to_goal");
    const cells = lines[1].split(",");
    expect(Number(cells[6])).toBeCloseTo(expected.xg, 4);
    expect(cells[9]).toBe(expected.zone);
  });

  it("parses JSON-encoded defenders/attackers columns into real Points", () => {
    const csv = 'shot_x,shot_y,defenders,attackers\n84,32,"[[100,38]]","[[87,31]]"';
    const result = scoreShotsCsv(csv, DEFAULT_CALIBRATION);
    if ("error" in result) throw new Error("unexpected error");
    const withDefenders = Number(result.csv.trim().split("\n")[1].split(",")[4]);

    const csvNoDefenders = "shot_x,shot_y,defenders,attackers\n84,32,,";
    const noDefResult = scoreShotsCsv(csvNoDefenders, DEFAULT_CALIBRATION);
    if ("error" in noDefResult) throw new Error("unexpected error");
    const withoutDefenders = Number(noDefResult.csv.trim().split("\n")[1].split(",")[4]);

    expect(withDefenders).not.toBe(withoutDefenders);
  });

  it("marks rows with missing/invalid coordinates as skipped and leaves blank output columns", () => {
    const csv = "shot_x,shot_y\n101.5,31.5\n,40\nnot-a-number,40";
    const result = scoreShotsCsv(csv, DEFAULT_CALIBRATION);
    if ("error" in result) throw new Error("unexpected error");
    expect(result.scored).toBe(1);
    expect(result.skipped).toBe(2);

    const lines = result.csv.trim().split("\n");
    expect(lines[2].endsWith(",,,,,,")).toBe(true);
    expect(lines[3].endsWith(",,,,,,")).toBe(true);
  });
});
