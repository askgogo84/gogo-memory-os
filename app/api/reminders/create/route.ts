import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/bot/resolve-user";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { normalizeTimezone, parseLocalDateTime } from "@/lib/timezone";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const phone = String(body.phone || "").trim();
    const reminderText = String(body.reminder_text || body.text || "").trim();
    const date = String(body.date || "").trim();
    const time = String(body.time || "").trim();

    if (!phone || !reminderText || !date || !time) {
      return NextResponse.json(
        { success: false, error: "phone, reminder_text, date and time are required" },
        { status: 400 }
      );
    }

    // Use the same user resolution as the rest of the bot so the row carries a
    // valid telegram_id (NOT NULL) and is deliverable by /api/cron/reminders,
    // which reads message / remind_at / sent — not the legacy due_at_* columns.
    const resolved = await resolveUser({ channel: "whatsapp", externalUserId: phone, userName: "Friend" });
    const timezone = normalizeTimezone(body.timezone || resolved.timezone);

    if (body.timezone && timezone !== resolved.timezone) {
      const { error: tzError } = await supabaseAdmin
        .from("users")
        .update({ timezone })
        .eq("telegram_id", resolved.telegramId);
      if (tzError) console.error("REMINDER_CREATE_TZ_UPDATE_FAILED:", tzError.message);
    }

    const parsed = parseLocalDateTime({ date, time, timezone });

    if (parsed.dueAtUtc.getTime() <= Date.now()) {
      return NextResponse.json(
        { success: false, error: "Reminder time is in the past" },
        { status: 400 }
      );
    }

    const reminderResult = await supabaseAdmin
      .from("reminders")
      .insert({
        telegram_id: resolved.telegramId,
        chat_id: resolved.telegramId,
        whatsapp_to: resolved.whatsappId || phone,
        message: reminderText,
        remind_at: parsed.dueAtUtcISO,
        sent: false,
        timezone,
      })
      .select("*")
      .single();

    if (reminderResult.error) throw reminderResult.error;

    return NextResponse.json({
      success: true,
      reminder: reminderResult.data,
      reply: [
        "Done - I will remind you.",
        "",
        `Task: ${reminderText}`,
        `Time: ${parsed.displayText}`,
        `Timezone: ${timezone}`,
        "",
        "- AskGogo"
      ].join("\n")
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create reminder";
    console.error("REMINDER_CREATE_FAILED:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
