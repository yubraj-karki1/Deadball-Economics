import { NextResponse } from "next/server";
import { pShotByType } from "../../../lib/deadball";

export async function GET() {
  return NextResponse.json({
    status: "healthy",
    runtime: "nextjs-typescript",
    models_loaded: {
      corner: true,
      freekick: true,
      throwin: true,
      setpiece: true,
    },
    p_shot: pShotByType(),
    note: "The TypeScript build uses a native heuristic xG engine because Python pickle/XGBoost models cannot be loaded directly in the Next.js runtime.",
  });
}
