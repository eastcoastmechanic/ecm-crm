import { NextResponse } from "next/server";
import { listOpenPlannerTasks } from "@/lib/planner-connector";
import { resend, RESEND_FROM_EMAIL } from "@/lib/resend";

const OWNER_EMAIL = process.env.OWNER_EMAIL;

// Unlike the old Supabase-backed version, this doesn't track "already
// reminded" -- Planner tasks have no natural field for that, and adding one
// would mean reintroducing exactly the kind of CRM-side task bookkeeping
// this migration was meant to get rid of. Net effect: an overdue task shows
// up in the digest every day until it's completed in Planner, instead of
// once. Ask if you'd rather have the old one-and-done behavior back.
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

  const allOpenTasks = await listOpenPlannerTasks();
  const tasks = allOpenTasks.filter((t) => t.dueDateTime && new Date(t.dueDateTime) <= endOfToday);

  if (tasks.length === 0) {
    return NextResponse.json({ sent: 0, errors: [] });
  }

  const lines = tasks.map((t) => {
    const due = new Date(t.dueDateTime as string);
    const overdue = due.getTime() < Date.now();
    return `- ${t.title}${overdue ? " (overdue)" : ""} — due ${due.toLocaleDateString()}${t.notes ? `: ${t.notes}` : ""}`;
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

  return NextResponse.json({ sent: tasks.length, errors: [] });
}
