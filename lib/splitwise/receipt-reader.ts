import OpenAI from 'openai'
import { downloadTwilioMediaAsDataUrl } from '@/lib/services/image-note-reader'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export type ReceiptItem = {
  name: string
  quantity?: number | null
  amount: number
}

export type ReceiptScanResult = {
  merchant: string
  date?: string | null
  subtotal?: number | null
  tax?: number | null
  service_charge?: number | null
  discount?: number | null
  total: number
  currency: string
  items: ReceiptItem[]
  confidence: 'high' | 'medium' | 'low'
  notes?: string[]
}

function extractJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Receipt JSON not found')
    return JSON.parse(match[0])
  }
}

function numberOrNull(value: any) {
  const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function sanitizeReceipt(raw: any): ReceiptScanResult {
  const items = Array.isArray(raw.items)
    ? raw.items
        .map((item: any) => ({
          name: String(item.name || 'Item').trim().slice(0, 80),
          quantity: numberOrNull(item.quantity),
          amount: numberOrNull(item.amount) || 0,
        }))
        .filter((item: ReceiptItem) => item.amount > 0)
        .slice(0, 30)
    : []

  const total = numberOrNull(raw.total)
  if (!total || total <= 0) throw new Error('Could not detect receipt total')

  return {
    merchant: String(raw.merchant || 'Receipt').trim().slice(0, 80),
    date: raw.date ? String(raw.date).trim().slice(0, 40) : null,
    subtotal: numberOrNull(raw.subtotal),
    tax: numberOrNull(raw.tax),
    service_charge: numberOrNull(raw.service_charge),
    discount: numberOrNull(raw.discount),
    total,
    currency: String(raw.currency || 'INR').trim().slice(0, 8),
    items,
    confidence: ['high', 'medium', 'low'].includes(String(raw.confidence)) ? raw.confidence : 'medium',
    notes: Array.isArray(raw.notes) ? raw.notes.map((n: any) => String(n).trim()).filter(Boolean).slice(0, 4) : [],
  }
}

export function isSplitReceiptCaption(text: string | null | undefined) {
  const lower = String(text || '').toLowerCase().trim().replace(/\s+/g, ' ')
  if (!lower) return false
  return (
    lower.includes('split receipt') ||
    lower.includes('split bill') ||
    lower.includes('scan receipt') ||
    lower.includes('receipt split') ||
    lower.includes('bill split') ||
    lower.includes('add receipt') ||
    lower.includes('add bill')
  )
}

export function extractReceiptGroupName(text: string | null | undefined) {
  const input = String(text || '').trim()
  const match = input.match(/(?:for|in|to)\s+(.+)$/i)
  if (match?.[1]) {
    return match[1]
      .replace(/split receipt|split bill|scan receipt|receipt split|bill split|add receipt|add bill/gi, '')
      .trim()
  }

  return input
    .replace(/split receipt|split bill|scan receipt|receipt split|bill split|add receipt|add bill/gi, '')
    .trim() || undefined
}

export async function scanReceiptFromImage(params: {
  mediaUrl: string
  contentType: string
  userCaption?: string
}) {
  if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY')

  const dataUrl = await downloadTwilioMediaAsDataUrl({ mediaUrl: params.mediaUrl, contentType: params.contentType })

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    response_format: { type: 'json_object' },
    max_tokens: 1500,
    messages: [
      {
        role: 'system',
        content:
          'You are AskGogo Split Receipt Scanner. Extract bill/receipt details from an image. Return ONLY valid JSON. Do not guess unreadable items. If unclear, use confidence low and add notes. Amounts must be numbers only.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `Caption: ${params.userCaption || 'No caption'}\n\n` +
              'Read this receipt/bill and return JSON exactly like this shape:\n' +
              '{"merchant":"Restaurant name","date":"visible date or null","subtotal":1234,"tax":50,"service_charge":0,"discount":0,"total":1284,"currency":"INR","confidence":"high","items":[{"name":"Paneer tikka","quantity":1,"amount":350}],"notes":["any uncertainty"]}\n\n' +
              'Rules:\n' +
              '- total must be the final payable amount if visible.\n' +
              '- Use INR unless another currency is clearly visible.\n' +
              '- Do not invent item names.\n' +
              '- If only total is readable, return empty items and confidence medium/low.',
          },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        ],
      },
    ],
  })

  const text = response.choices?.[0]?.message?.content?.trim() || ''
  return sanitizeReceipt(extractJson(text))
}

export function buildReceiptSummary(receipt: ReceiptScanResult) {
  const items = receipt.items.slice(0, 8).map((item) => `• ${item.name}: ₹${item.amount}`).join('\n')
  return (
    `🧾 *Receipt scanned*\n\n` +
    `Merchant: *${receipt.merchant}*\n` +
    `${receipt.date ? `Date: ${receipt.date}\n` : ''}` +
    `Total: *₹${receipt.total}*\n` +
    `Confidence: ${receipt.confidence}\n` +
    `${items ? `\n*Items detected*\n${items}\n` : ''}` +
    `${receipt.notes?.length ? `\n*Notes*\n${receipt.notes.map((n) => `• ${n}`).join('\n')}\n` : ''}`
  ).trim()
}
