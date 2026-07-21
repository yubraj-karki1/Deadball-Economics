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

const iconProps = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconSave() {
  return (
    <svg {...iconProps}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </svg>
  );
}

export function IconTrash() {
  return (
    <svg {...iconProps}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function IconDownload() {
  return (
    <svg {...iconProps}>
      <path d="M12 3v12" />
      <path d="M6 11l6 6 6-6" />
      <path d="M4 21h16" />
    </svg>
  );
}

export function IconCheck() {
  return (
    <svg {...iconProps}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function IconX() {
  return (
    <svg {...iconProps}>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

export function IconPrinter() {
  return (
    <svg {...iconProps}>
      <path d="M6 9V3h12v6" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v8H6z" />
    </svg>
  );
}