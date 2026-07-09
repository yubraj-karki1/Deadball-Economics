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
    note: "The app runs on a native TypeScript heuristic xG engine.",
  });
}
