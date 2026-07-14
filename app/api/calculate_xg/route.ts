import { NextResponse } from "next/server";
import { predict, type XgRequest } from "../../../lib/deadball";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as XgRequest;
    if (!Number.isFinite(Number(body.shot_x)) || !Number.isFinite(Number(body.shot_y))) {
      return NextResponse.json({ error: "shot_x and shot_y must be finite numbers." }, { status: 400 });
    }
    return NextResponse.json(predict(body));
  } catch {
    return NextResponse.json({ error: "Invalid xG calculation request." }, { status: 400 });
  }
}
