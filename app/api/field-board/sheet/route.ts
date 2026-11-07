import { NextResponse } from "next/server";
import { getFieldBoardSheet } from "@/lib/field-board";
import { fieldBoardCaller } from "@/lib/bot-keys";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await fieldBoardCaller(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sheet = await getFieldBoardSheet();
    return NextResponse.json(sheet);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Field sheet failed" },
      { status: 500 }
    );
  }
}
