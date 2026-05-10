// v1 placeholder for premium shareable report cards.
// Next phase: generate a visual skincare report image from the stored report.

export function isSkinReportCardCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return (
    lower === 'skin report card' ||
    lower === 'create skin report card' ||
    lower === 'generate skin report card' ||
    lower === 'share skin report' ||
    lower === 'visual skin report'
  )
}

export async function buildSkinReportCardReply() {
  return (
    `✨ *Skin Report Card*\n\n` +
    `Your text Skin Check is ready. The visual report card is the next premium layer.\n\n` +
    `For now, use:\n` +
    `• *skin check* — create a new report\n` +
    `• *skin history* — see past checks\n` +
    `• *compare with last skin check* — compare progress`
  )
}
