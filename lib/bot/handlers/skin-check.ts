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

  const savedReport = await saveSkinCheckReport({
    telegramId: params.telegramId,
    imageUrl: params.mediaUrl,
    rawReport: report,
  })

  const note = compactSkinCheckForSaving(report)
  await addToList(params.telegramId, 'notes', [note])

  return {
    report,
    savedReport,
    reply: `${report}\n\n✅ Saved to *my skin history* and *my notes*.`
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
    return buildSkinReportCardReply()
  }

  return null
}
