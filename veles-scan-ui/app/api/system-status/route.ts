import { NextResponse } from "next/server";
import { getSystemWorkersSnapshot } from "@/lib/repositories";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getSystemWorkersSnapshot();
  return NextResponse.json(data);
}
