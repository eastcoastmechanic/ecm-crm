import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resend, RESEND_FROM_EMAIL } from "@/lib/resend";

const OWNER_EMAIL = process.env.OWNER_EMAIL;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!OWNER_EMAIL) {
    return NextResponse.json({ sent: 0, errors: ["OWNER_EMAIL not configured"] });
  }

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("id, title, notes, due_at")
    .is("completed_at", null)
    .is("reminder_sent_at", null)
    .lte("due_at", endOfToday.toISOString())
    .not("due_at", "is", null);

  if (error) return NextResponse.json({ sent: 0, errors: [error.message] });

  if (!tasks || tasks.length === 0) {
    return NextResponse.json({ sent: 0, errors: [] });
  }

  const lines = tasks.map((t) => {
    const due = new Date(t.due_at as string);
    const overdue = due.getTime() < Date.now();
    return `- ${t.title}${overdue ? " (overdue)" : ""} — due ${due.toLocaleDateString()}${
      t.notes ? `: ${t.notes}` : ""
    }`;
  });

  const { error: sendError } = await resend.emails.send({
    from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
    to: OWNER_EMAIL,
    subject: `Task reminder: ${tasks.length} due today or overdue`,
    text: `Tasks due today or overdue:\n\n${lines.join("\n")}`,
  });

  if (sendError) {
    return NextResponse.json({ sent: 0, errors: [sendError.message] });
  }

  await supabase
    .from("tasks")
    .update({ reminder_sent_at: new Date().toISOString() })
    .in(
      "id",
      tasks.map((t) => t.id)
    );

  return NextResponse.json({ sent: tasks.length, errors: [] });
}
