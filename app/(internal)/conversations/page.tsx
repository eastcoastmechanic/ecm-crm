import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { headingClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

export const dynamic = "force-dynamic";

const channelLabel: Record<string, string> = {
  sms: "Text",
  voice: "Phone call",
  web: "Website chat",
};

export default async function ConversationsPage() {
  const { data: conversations, error } = await supabase
    .from("ai_conversations")
    .select("id, channel, phone_number, status, updated_at, customers(name)")
    .order("updated_at", { ascending: false })
    .limit(100);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>AI Conversations</h1>
        <p className={subTextClass}>
          Every SMS, call, and website chat thread the AI receptionist has handled.
        </p>
      </div>

      {error && <p className={itemSubClass}>Error loading conversations: {error.message}</p>}

      <div className="flex flex-col divide-y divide-white/8">
        {(conversations ?? []).length === 0 && (
          <p className={subTextClass}>No conversations yet.</p>
        )}
        {(conversations ?? []).map((conv) => {
          const customers = conv.customers as unknown as { name: string | null }[] | null;
          return (
            <Link
              key={conv.id}
              href={`/conversations/${conv.id}`}
              className="flex items-center justify-between gap-4 py-3 hover:bg-white/3"
            >
              <div>
                <div className={itemTitleClass}>
                  {customers?.[0]?.name ?? conv.phone_number ?? "Unknown"}
                  <span className="ml-2 rounded bg-white/8 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-g300">
                    {channelLabel[conv.channel] ?? conv.channel}
                  </span>
                </div>
                <div className={itemSubClass}>{new Date(conv.updated_at).toLocaleString()}</div>
              </div>
              <div className={itemSubClass}>{conv.status}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
