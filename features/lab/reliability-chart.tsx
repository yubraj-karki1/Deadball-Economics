import type { ReliabilityBucket } from "./types";
import { Legend, Row } from "./ui-components";
import { pct } from "./utils";

const W = 300;
const H = 200;
const PAD_L = 30;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 22;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;
const TICKS = [0, 0.25, 0.5, 0.75, 1];

export function ReliabilityChart({ buckets }: { buckets: ReliabilityBucket[] }) {
  if (!buckets.length) return null;

  const maxSeen = Math.max(0.04, ...buckets.map((b) => Math.max(b.avgPredicted, b.avgActual)));
  const domainMax = Math.min(1, maxSeen * 1.2);
  const maxCount = Math.max(...buckets.map((b) => b.count));
  const x = (v: number) => PAD_L + (v / domainMax) * PLOT_W;
  const y = (v: number) => PAD_T + PLOT_H - (v / domainMax) * PLOT_H;
  const radius = (count: number) => 3 + 3 * Math.sqrt(count / maxCount);

  return (
    <div className="reliability-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Predicted versus actual goal rate by test-set bucket">
        {TICKS.map((t) => {
          const v = t * domainMax;
          return (
            <g key={t}>
              <line x1={PAD_L} y1={y(v)} x2={W - PAD_R} y2={y(v)} stroke="rgba(224,184,74,0.12)" strokeWidth="1" />
              <text x={PAD_L - 5} y={y(v) + 3} textAnchor="end" fontSize="7" fill="#9db4a4">{Math.round(v * 100)}</text>
              <text x={x(v)} y={H - 6} textAnchor="middle" fontSize="7" fill="#9db4a4">{Math.round(v * 100)}</text>
            </g>
          );
        })}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + PLOT_H} stroke="#3f5346" strokeWidth="1" />
        <line x1={PAD_L} y1={PAD_T + PLOT_H} x2={W - PAD_R} y2={PAD_T + PLOT_H} stroke="#3f5346" strokeWidth="1" />
        <line x1={x(0)} y1={y(0)} x2={x(domainMax)} y2={y(domainMax)} stroke="#4fd0a5" strokeWidth="1.4" strokeDasharray="3 2" opacity="0.75" />
        {buckets.map((b, i) => (
          <circle key={i} cx={x(b.avgPredicted)} cy={y(b.avgActual)} r={radius(b.count)} fill="#e0b84a" stroke="#10241a" strokeWidth="1.4">
            <title>{`Predicted ${pct(b.avgPredicted)} vs actual ${pct(b.avgActual)} · n=${b.count} (p ${(b.minP * 100).toFixed(1)}-${(b.maxP * 100).toFixed(1)}%)`}</title>
          </circle>
        ))}
      </svg>
      <div className="legend">
        <Legend color="#e0b84a" text="Test-set buckets" />
        <Legend color="#4fd0a5" text="Perfect calibration" />
      </div>
      <div className="training-stats">
        {buckets.map((b, i) => (
          <Row key={i} k={`p ${(b.minP * 100).toFixed(1)}-${(b.maxP * 100).toFixed(1)}%`} v={`pred ${pct(b.avgPredicted)} / actual ${pct(b.avgActual)} (n=${b.count})`} />
        ))}
      </div>
    </div>
  );
}
