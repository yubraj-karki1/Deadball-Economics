import { NextResponse } from "next/server";
import { predict, type XgRequest } from "../../../lib/deadball";

export async function POST(request: Request) {
  const body = (await request.json()) as XgRequest;
  return NextResponse.json(predict(body));
}
