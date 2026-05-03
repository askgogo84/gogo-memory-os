import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type CountResult = {
  table: string;
  label: string;
  count: number | null;
  available: boolean;
  error?: string;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const candidates = [
  { key: "users", label: "Users", tables: ["users", "profiles", "whatsapp_users", "app_users", "customers"] },
  { key: "messages", label: "Messages", tables: ["messages", "whatsapp_messages", "chat_messages", "user_messages"] },
  { key: "reminders", label: "Reminders", tables: ["reminders", "tasks", "user_reminders"] },
  { key: "notes", label: "Notes", tables: ["notes", "memories", "user_notes"] },
  { key: "expenses", label: "Expenses", tables: ["expenses", "user_expenses"] },
  { key: "referrals", label: "Referrals", tables: ["referrals", "user_referrals"] },
  { key: "contacts", label: "Contacts", tables: ["contacts", "user_contacts"] },
  { key: "payments", label: "Payments", tables: ["payments", "subscriptions", "razorpay_payments"] },
];

function getClient() {
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

async function countTable(client: ReturnType<typeof createClient>, table: string) {
  const { count, error } = await client
    .from(table)
    .select("*", { count: "exact", head: true });

  if (error) {
    return { table, count: null, available: false, error: error.message };
  }

  return { table, count: count ?? 0, available: true };
}

async function findFirstAvailableCount(
  client: ReturnType<typeof createClient>,
  label: string,
  tables: string[]
): Promise<CountResult> {
  let lastError = "Table not found";

  for (const table of tables) {
    const result = await countTable(client, table);
    if (result.available) {
      return {
        table,
        label,
        count: result.count,
        available: true,
      };
    }
    lastError = result.error || lastError;
  }

  return {
    table: tables[0],
    label,
    count: null,
    available: false,
    error: lastError,
  };
}

async function getLatestRows(client: ReturnType<typeof createClient>, table: string) {
  const possibleOrderColumns = ["created_at", "createdAt", "updated_at", "id"];

  for (const column of possibleOrderColumns) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .order(column, { ascending: false })
      .limit(10);

    if (!error) return data ?? [];
  }

  const { data } = await client.from(table).select("*").limit(10);
  return data ?? [];
}

export async function GET() {
  const client = getClient();

  if (!client) {
    return NextResponse.json(
      {
        error:
          "Supabase env vars missing. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.",
      },
      { status: 500 }
    );
  }

  const counts = await Promise.all(
    candidates.map((item) => findFirstAvailableCount(client, item.label, item.tables))
  );

  const usersCount = counts.find((item) => item.label === "Users");
  const messagesCount = counts.find((item) => item.label === "Messages");

  let latestUsers: unknown[] = [];
  if (usersCount?.available) {
    latestUsers = await getLatestRows(client, usersCount.table);
  }

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: {
      totalUsers: usersCount?.count ?? 0,
      totalMessages: messagesCount?.count ?? 0,
      detectedUserTable: usersCount?.available ? usersCount.table : null,
    },
    counts,
    latestUsers,
  });
}
