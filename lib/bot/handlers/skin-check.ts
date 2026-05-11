import { addToList } from '@/lib/lists'
import { analyzeSkinCheckImage } from '@/lib/bot/services/skin-check-analyzer'
import { saveSkinCheckReport } from '@/lib/bot/services/skin-check-storage'
import {
  buildSkinCompareReply,
  buildSkinHistoryReply,
  isSkinCompareCommand,
  isSkinHistoryCommand,
} from '@/lib/bot/services/skin-check-compare'
import {
  buildSkinReportCardReply,
  isSkinReportCardCommand,
} from '@/lib/bot/services/skin-check-report-card'
import { compactSkinCheckForSaving, isSkinCheckCaption } from '@/lib/services/skin-check-reader'

export { isSkinCheckCaption, isSkinCompareCommand, isSkinHistoryCommand, isSkinReportCardCommand }

export function isSkinGoalReply(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return (
    ['1', '2', '3', '4', '5'].includes(lower) ||
    lower.includes('reduce oiliness') ||
    lower.includes('oiliness') ||
    lower.includes('dark circles') ||
    lower.includes('glow') ||
    lower.includes('pores') ||
    lower.includes('anti-aging') ||
    lower.includes('anti aging')
  )
}

export function buildSkinGoalReply(text: string) {
  const lower = (text || '').toLowerCase().trim()

  if (lower === '1' || lower.includes('oiliness')) {
    return `✨ *Skin goal: Reduce oiliness*\n\nFor the next 2 weeks:\n• Use a gentle gel cleanser morning/evening\n• Pick a lightweight non-greasy moisturiser\n• Use SPF 50 gel or matte finish sunscreen\n• Avoid heavy oils and harsh scrubs\n\nSay *remind me to do skin check after 2 weeks* to track progress.`
  }

  if (lower === '2' || lower.includes('dark circles')) {
    return `✨ *Skin goal: Dark circles*\n\nFor the next 2 weeks:\n• Prioritise sleep consistency and hydration\n• Use sunscreen around the eye area carefully\n• Consider a gentle hydrating eye product\n• Avoid rubbing the under-eye area\n\nSay *remind me to do skin check after 2 weeks* to track progress.`
  }

  if (lower === '3' || lower.includes('glow')) {
    return `✨ *Skin goal: Glow*\n\nFor the next 2 weeks:\n• Keep the routine simple and consistent\n• Add hydration first: serum or light moisturiser\n• Use SPF 50 every morning\n• Avoid adding too many actives at once\n\nSay *remind me to do skin check after 2 weeks* to track progress.`
  }

  if (lower === '4' || lower.includes('pores')) {
    return `✨ *Skin goal: Pores*\n\nFor the next 2 weeks:\n• Focus on gentle cleansing, not scrubbing\n• Use lightweight moisturiser so skin does not overcompensate\n• Sunscreen daily; sun exposure can make texture look more visible\n• Introduce actives slowly if your skin tolerates them\n\nSay *remind me to do skin check after 2 weeks* to track progress.`
  }

  return `✨ *Skin goal: Anti-aging*\n\nFor the next 2 weeks:\n• SPF 50 every morning is the non-negotiable step\n• Keep barrier support strong with moisturiser\n• Avoid harsh exfoliation\n• Add actives slowly only if your skin is calm\n\nSay *remind me to do skin check after 2 weeks* to track progress.`
}

export async function buildSkinCheckFromImage(params: {
  telegramId: number
  mediaUrl: string
  contentType: string
  userCaption?: string
  userName?: string | null
}) {
  const report = await analyzeSkinCheckImage({
    mediaUrl: params.mediaUrl,
    contentType: params.contentType,
    userCaption: params.userCaption,
    userName: params.userName,
  })

  let savedReport: any = null
  let savedHistory = false
  let savedNotes = false

  try {
    savedReport = await saveSkinCheckReport({
      telegramId: params.telegramId,
      imageUrl: params.mediaUrl,
      rawReport: report,
    })
    savedHistory = true
  } catch (error: any) {
    console.error('[skin-check] history save failed:', error?.message || error)
  }

  try {
    const note = compactSkinCheckForSaving(report)
    await addToList(params.telegramId, 'notes', [note])
    savedNotes = true
  } catch (error: any) {
    console.error('[skin-check] note save failed:', error?.message || error)
  }

  const saveStatus = savedHistory && savedNotes
    ? `✅ Saved to *my skin history* and *my notes*.`
    : savedHistory
      ? `✅ Saved to *my skin history*.\nNote save had a temporary issue.`
      : savedNotes
        ? `✅ Saved to *my notes*.\nSkin history save had a temporary issue.`
        : `Report generated. Saving to history had a temporary issue.`

  return {
    report,
    savedReport,
    reply: `${report}\n\n${saveStatus}`
  }
}

export async function buildSkinTextCommandReply(params: {
  telegramId: number
  text: string
}) {
  if (isSkinHistoryCommand(params.text)) {
    return buildSkinHistoryReply(params.telegramId)
  }

  if (isSkinCompareCommand(params.text)) {
    return buildSkinCompareReply(params.telegramId)
  }

  if (isSkinReportCardCommand(params.text)) {
    return buildSkinReportCardReply(params.telegramId)
  }

  if (isSkinGoalReply(params.text)) {
    return buildSkinGoalReply(params.text)
  }

  return null
}
