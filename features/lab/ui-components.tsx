import type { Point } from "../../lib/deadball";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function PointInput({ label, value, xMin, xMax, yMin, yMax, step = 0.1, digits = 1, onChange }: { label: string; value: Point; xMin: number; xMax: number; yMin: number; yMax: number; step?: number; digits?: number; onChange: (p: Point) => void }) {
  return (
    <div className="point-input">
      <span>{label}</span>
      <div className="point-input-row">
        <label>X<input type="number" step={step} value={+value[0].toFixed(digits)} onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange([clamp(n, xMin, xMax), value[1]]);
        }} /></label>
        <label>Y<input type="number" step={step} value={+value[1].toFixed(digits)} onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange([value[0], clamp(n, yMin, yMax)]);
        }} /></label>
      </div>
    </div>
  );
}

export function Slider({ label, value, min, max, step = 1, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return <label>{label} <b>{value.toFixed(digits)}{suffix}</b><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>;
}

export function Legend({ color, text }: { color: string; text: string }) {
  return <span><i className="dot" style={{ background: color }} />{text}</span>;
}

export function Card({ label, value, note, big = false }: { label: string; value: string; note?: string; big?: boolean }) {
  return <div className={`card ${big ? "big" : ""}`}><div className="k">{label}</div><div className={`v ${big ? "" : "mid"}`}>{value}</div>{note && <div className="note">{note}</div>}</div>;
}

export function Metric({ k, v }: { k: string; v: string }) {
  return <div className="m"><span>{k}</span><b>{v}</b></div>;
}

export function Row({ k, v }: { k: string; v: string }) {
  return <div className="row"><span>{k}</span><b>{v}</b></div>;
}

