import type { Point } from "../../lib/deadball";
import { GOAL_W, GX, GY, P_W, X0, X1 } from "./constants";

export function Player({ p, color, label, radius = 0.95, onPointerDown }: { p: Point; color: string; label?: string; radius?: number; onPointerDown?: () => void }) {
  return <g onPointerDown={onPointerDown} className={onPointerDown ? "grab" : undefined}><circle cx={p[0]} cy={p[1]} r={radius} fill={color} stroke="#f7ecd0" strokeWidth="0.22" />{label && <text x={p[0]} y={p[1] + 0.35} textAnchor="middle" fontSize="0.9" fill="#241706" fontWeight="bold">{label}</text>}</g>;
}

export function GoalkeeperFigure({ x, y, targetX, targetY, onPointerDown }: { x: number; y: number; targetX: number; targetY: number; onPointerDown: () => void }) {
  const shoulderY = y - 78;
  const dx = targetX - x;
  const dy = targetY - shoulderY;
  const horizontalReach = Math.max(-28, Math.min(28, dx * 0.16));
  const verticalReach = Math.max(-24, Math.min(24, dy * 0.22));
  const leftHandX = x - 48 + horizontalReach;
  const leftHandY = y - 46 + verticalReach;
  const rightHandX = x + 48 + horizontalReach;
  const rightHandY = y - 46 + verticalReach;

  return (
    <g onPointerDown={onPointerDown} className="grab goalkeeper-figure">
      <line className="gk-arm" x1={x - 14} y1={shoulderY} x2={leftHandX} y2={leftHandY} stroke="#ef5b5b" strokeWidth="11" strokeLinecap="round" />
      <line className="gk-arm" x1={x + 14} y1={shoulderY} x2={rightHandX} y2={rightHandY} stroke="#ef5b5b" strokeWidth="11" strokeLinecap="round" />
      <circle className="gk-hand" cx={leftHandX} cy={leftHandY} r="9" fill="#fff" stroke="#132318" strokeWidth="2" />
      <circle className="gk-hand" cx={rightHandX} cy={rightHandY} r="9" fill="#fff" stroke="#132318" strokeWidth="2" />
      <line x1={x - 8} y1={y - 18} x2={x - 24} y2={y + 6} stroke="#132318" strokeWidth="10" strokeLinecap="round" />
      <line x1={x + 8} y1={y - 18} x2={x + 24} y2={y + 6} stroke="#132318" strokeWidth="10" strokeLinecap="round" />
      <line x1={x - 24} y1={y + 6} x2={x - 38} y2={y + 6} stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <line x1={x + 24} y1={y + 6} x2={x + 38} y2={y + 6} stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <rect x={x - 18} y={y - 104} width="36" height="90" rx="10" fill="#ef5b5b" stroke="#fff" strokeWidth="2" />
      <circle cx={x} cy={y - 118} r="12" fill="#f0bc8f" stroke="#fff" strokeWidth="2" />
      <text x={x} y={y - 60} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="bold">GK</text>
    </g>
  );
}

export function PitchMarks() {
  return <><rect x={GX - 16.5} y={GY - 20.16} width="16.5" height="40.32" fill="none" stroke="#ffffff88" strokeWidth="0.3" /><rect x={GX - 5.5} y={GY - 9.16} width="5.5" height="18.32" fill="none" stroke="#ffffff88" strokeWidth="0.3" /><line x1={GX} y1={GY - 3.66} x2={GX} y2={GY + 3.66} stroke="#fff" strokeWidth="1" /><circle cx={GX - 11} cy={GY} r="0.5" fill="#fff" /><line x1={X0} y1="0" x2={X0} y2={P_W} stroke="#ffffff55" strokeWidth="0.3" /></>;
}

export function Voronoi({ defenders, attackers, gk }: { defenders: Point[]; attackers: Point[]; gk: Point }) {
  const pts: Array<[Point, string]> = [...defenders.map((p) => [p, "#f2897c"] as [Point, string]), ...attackers.map((p) => [p, "#82ddc0"] as [Point, string]), [gk, "#e0b84a"]];
  const cells = [];
  for (let x = X0; x <= X1; x += 1.4) for (let y = 0; y <= 68; y += 1.4) {
    let best = Infinity;
    let col = "#3f5346";
    for (const [p, c] of pts) {
      const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
      if (d < best) {
        best = d;
        col = c;
      }
    }
    cells.push(<rect key={`${x}-${y}`} x={x - 0.7} y={y - 0.7} width="1.45" height="1.45" fill={col} opacity="0.32" />);
  }
  return <>{cells}</>;
}

export function zoneFill(v: number) {
  if (v >= 0.8) return "rgba(239,91,91,.68)";
  if (v >= 0.65) return "rgba(224,138,60,.58)";
  if (v >= 0.5) return "rgba(224,184,74,.58)";
  if (v >= 0.35) return "rgba(79,208,165,.46)";
  if (v >= 0.25) return "rgba(45,150,120,.42)";
  return "rgba(31,61,44,.5)";
}
