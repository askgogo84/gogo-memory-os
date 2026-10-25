type DailyBriefRenderInput = {
  firstName: string
  briefing: string
  localDate: string
  unsubscribeUrl: string
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function stripMd(value: string) {
  return value.replace(/\*/g, '').trim()
}

function dateLabel(localDate: string) {
  const d = new Date(`${localDate}T12:00:00+05:30`)
  if (Number.isNaN(d.getTime())) return localDate
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    month: 'short',
    day: 'numeric',
  }).format(d)
}

function longDate(localDate: string) {
  const d = new Date(`${localDate}T12:00:00+05:30`)
  if (Number.isNaN(d.getTime())) return localDate
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
}

function sectionLines(briefing: string, heading: string) {
  const blocks = briefing.split(/\n\n+/)
  const block = blocks.find((b) => stripMd(b.split('\n')[0] || '').toLowerCase().includes(heading.toLowerCase()))
  if (!block) return []
  return block.split('\n').slice(1).map((x) => stripMd(x)).filter(Boolean)
}

function countBullets(lines: string[]) {
  return lines.filter((line) => /^•\s*/.test(line)).length
}

function buildSubject(briefing: string, localDate: string) {
  const date = dateLabel(localDate)
  const flights = sectionLines(briefing, "today's flight")
  if (flights.length) {
    const route = flights[0]?.replace(/^•\s*/, '').split(' · ')[0]?.trim()
    return route ? `${route} today · ${date}` : `Travel day · ${date}`
  }

  const calendar = sectionLines(briefing, 'calendar')
  const reminders = sectionLines(briefing, 'reminders')
  const eventCount = countBullets(calendar)
  const reminderCount = countBullets(reminders)

  if (!eventCount && !reminderCount) return `A calm day ahead · ${date}`
  if (eventCount === 1 && reminderCount === 0) return `One thing on your calendar · ${date}`
  if (eventCount === 0 && reminderCount === 1) return `One reminder today · ${date}`

  const bits: string[] = []
  if (eventCount) bits.push(`${eventCount} event${eventCount === 1 ? '' : 's'}`)
  if (reminderCount) bits.push(`${reminderCount} reminder${reminderCount === 1 ? '' : 's'}`)
  return `${bits.join(' · ')} · ${date}`
}

function renderBlock(block: string) {
  const lines = block.split('\n').map(stripMd).filter(Boolean)
  if (!lines.length) return ''
  const heading = lines[0]
  const body = lines.slice(1)

  const bodyHtml = body.length
    ? `<div style="margin-top:10px;color:#5d493d;font-size:14px;line-height:1.65">${body.map((line) => {
        if (/^•\s*/.test(line)) {
          return `<div style="margin:5px 0;padding-left:2px">${escapeHtml(line)}</div>`
        }
        return `<div style="margin:5px 0">${escapeHtml(line)}</div>`
      }).join('')}</div>`
    : ''

  return `<section style="margin-top:14px;border:1px solid rgba(77,46,27,.10);background:#fffaf5;border-radius:18px;padding:16px 17px">
    <div style="font-size:13px;font-weight:700;color:#3b2518">${escapeHtml(heading)}</div>
    ${bodyHtml}
  </section>`
}

export function renderDailyBriefEmail(input: DailyBriefRenderInput) {
  const subject = buildSubject(input.briefing, input.localDate)
  const blocks = input.briefing.split(/\n\n+/).filter(Boolean)
  const contentBlocks = blocks.filter((block, index) => index > 0 || !/Today for/i.test(block))
  const date = longDate(input.localDate)

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f5eee6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#3b2518">
    <div style="padding:28px 12px">
      <div style="max-width:640px;margin:0 auto;background:#fffdf9;border:1px solid rgba(77,46,27,.10);border-radius:26px;overflow:hidden;box-shadow:0 20px 60px rgba(61,35,18,.07)">
        <div style="padding:28px 28px 22px;background:linear-gradient(135deg,#f7e8d9,#f4efe8)">
          <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:#bf6b2f">AskGogo Daily Brief</div>
          <h1 style="margin:8px 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.15;color:#3b2518">Good morning, ${escapeHtml(input.firstName)}.</h1>
          <div style="font-size:13px;color:#8a7568">${escapeHtml(date)} · your day, made lighter</div>
        </div>
        <div style="padding:12px 24px 26px">
          ${contentBlocks.map(renderBlock).join('')}
          <div style="margin-top:18px;padding:16px 17px;border-radius:18px;background:#2c211b;color:#fff">
            <div style="font-size:13px;font-weight:700">Want Gogo to help you act on this?</div>
            <div style="margin-top:5px;font-size:12px;line-height:1.55;color:#e8ddd5">Open AskGogo and say “plan my day” to turn the important parts into reminders.</div>
            <a href="https://app.askgogo.in/dashboard/today" style="display:inline-block;margin-top:12px;padding:10px 14px;border-radius:999px;background:#f28a2b;color:#fff;text-decoration:none;font-size:12px;font-weight:700">Open Today</a>
          </div>
          <div style="margin-top:22px;padding-top:14px;border-top:1px solid rgba(77,46,27,.09);font-size:10.5px;line-height:1.55;color:#9a877c">
            You asked AskGogo to email your Daily Brief. <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#7b5b49">Turn off Daily Brief emails</a> · <a href="https://app.askgogo.in/dashboard/you" style="color:#7b5b49">Preferences</a>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`

  const text = [
    'AskGogo Daily Brief',
    date,
    '',
    `Good morning, ${input.firstName}.`,
    '',
    input.briefing.replace(/\*/g, ''),
    '',
    'Open Today: https://app.askgogo.in/dashboard/today',
    `Turn off Daily Brief emails: ${input.unsubscribeUrl}`,
  ].join('\n')

  return { subject, html, text }
}
