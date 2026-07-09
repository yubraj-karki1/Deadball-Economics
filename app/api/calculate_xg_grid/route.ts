import { NextResponse } from "next/server";
import { predictGrid, type XgRequest } from "../../../lib/deadball";

export async function POST(request: Request) {
  const body = (await request.json()) as Omit<XgRequest, "shot_x" | "shot_y">;
  return NextResponse.json(predictGrid(body));
}
