const fs = require("fs");
const path = "lib/bot/process-message.ts";

let file = fs.readFileSync(path, "utf8");

// 1) Replace createReminder function to support whatsapp_to
const oldCreateReminder = `async function createReminder(
  telegramId: number,
  chatId: number,
  remindAt: string,
  message: string,
  pattern?: string
) {
  const payload: any = {
    telegram_id: telegramId,
    chat_id: chatId,
    message,
    remind_at: remindAt,
    sent: false,
  }

  if (pattern) {
    payload.recurring_pattern = pattern
    payload.is_recurring = true
  }

  const { error } = await supabaseAdmin.from('reminders').insert(payload)

  if (error) {
    console.error('REMINDER INSERT FAILED:', error, payload)
    throw new Error(\`Reminder insert failed: \${error.message}\`)
  }
}`;

const newCreateReminder = `async function createReminder(
  telegramId: number,
  chatId: number,
  remindAt: string,
  message: string,
  pattern?: string,
  whatsappTo?: string | null
) {
  const payload: any = {
    telegram_id: telegramId,
    chat_id: chatId,
    message,
    remind_at: remindAt,
    sent: false,
  }

  if (whatsappTo) {
    payload.whatsapp_to = whatsappTo
  }

  if (pattern) {
    payload.recurring_pattern = pattern
    payload.is_recurring = true
  }

  const { error } = await supabaseAdmin.from('reminders').insert(payload)

  if (error) {
    console.error('REMINDER INSERT FAILED:', error, payload)
    throw new Error(\`Reminder insert failed: \${error.message}\`)
  }
}`;

if (!file.includes(oldCreateReminder)) {
  console.error("Could not find original createReminder function. No changes made.");
  process.exit(1);
}

file = file.replace(oldCreateReminder, newCreateReminder);

// 2) Fix normal reminder creation
file = file.replace(
`await createReminder(
      resolvedUser.telegramId,
      resolvedUser.telegramId,
      eagerReminder.remindAtIso,
      eagerReminder.message,
      eagerReminder.kind === 'recurring' ? eagerReminder.pattern : undefined
    )`,
`await createReminder(
      resolvedUser.telegramId,
      resolvedUser.telegramId,
      eagerReminder.remindAtIso,
      eagerReminder.message,
      eagerReminder.kind === 'recurring' ? eagerReminder.pattern : undefined,
      params.channel === 'whatsapp' ? resolvedUser.whatsappId : null
    )`
);

// 3) Fix sports follow-up reminder creation
file = file.replace(
`await createReminder(
        resolvedUser.telegramId,
        resolvedUser.telegramId,
        remindAt.toISOString(),
        reminderMessage
      )`,
`await createReminder(
        resolvedUser.telegramId,
        resolvedUser.telegramId,
        remindAt.toISOString(),
        reminderMessage,
        undefined,
        params.channel === 'whatsapp' ? resolvedUser.whatsappId : null
      )`
);

// 4) Fix Claude-parsed reminder creation
file = file.replace(
`await createReminder(
      resolvedUser.telegramId,
      resolvedUser.telegramId,
      parsed.remindAt,
      parsed.message,
      parsed.pattern
    )`,
`await createReminder(
      resolvedUser.telegramId,
      resolvedUser.telegramId,
      parsed.remindAt,
      parsed.message,
      parsed.pattern,
      params.channel === 'whatsapp' ? resolvedUser.whatsappId : null
    )`
);

fs.writeFileSync(path, file);
console.log("✅ Fixed WhatsApp reminder delivery in lib/bot/process-message.ts");
