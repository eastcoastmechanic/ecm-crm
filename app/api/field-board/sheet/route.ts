import { NextResponse } from "next/server";
import { fieldBoardAuthorized, fieldBoardSecretStatus, getFieldBoardSheet } from "@/lib/field-board";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!fieldBoardAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized", ...fieldBoardSecretStatus() }, { status: 401 });
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
