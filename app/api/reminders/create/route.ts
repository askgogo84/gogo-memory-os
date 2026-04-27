import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeTimezone, parseLocalDateTime } from "@/lib/timezone";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

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

    const existingUserResult = await supabase
      .from("users")
      .select("id, timezone")
      .eq("phone", phone)
      .maybeSingle();

    const existingUser = existingUserResult.data;
    const timezone = normalizeTimezone(body.timezone || existingUser?.timezone);

    let userId = existingUser?.id;

    if (!userId) {
      const newUserResult = await supabase
        .from("users")
        .insert({ phone, timezone })
        .select("id")
        .single();

      if (newUserResult.error) throw newUserResult.error;
      userId = newUserResult.data.id;
    } else if (timezone !== existingUser?.timezone) {
      await supabase.from("users").update({ timezone }).eq("id", userId);
    }

    const parsed = parseLocalDateTime({ date, time, timezone });

    if (parsed.dueAtUtc.getTime() <= Date.now()) {
      return NextResponse.json(
        { success: false, error: "Reminder time is in the past" },
        { status: 400 }
      );
    }

    const reminderResult = await supabase
      .from("reminders")
      .insert({
        user_id: userId,
        phone,
        reminder_text: reminderText,
        timezone,
        due_at_utc: parsed.dueAtUtcISO,
        due_at_local: parsed.dueAtLocalISO,
        status: "pending",
        source: "whatsapp"
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
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
