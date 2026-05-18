/**
 * Speaker Profile Service
 * Saves and retrieves speaker names for meetings
 * Allows re-labelling "Speaker A/B/C" with real names
 */

import { supabaseAdmin } from '@/lib/supabase-admin'

export interface SpeakerProfile {
  label: string        // "Speaker A", "Speaker B" etc
  name: string         // "Gogo", "Mathew Varkey"
  meetingCount: number // how many meetings this person has been in
}

// ── Save speaker mapping for a meeting ───────────────────────────────────────

export async function saveSpeakerMapping(
  telegramId: number,
  names: string[],       // in order: ["Gogo", "Mathew", "Srinivas"]
  rawTranscript: string  // Speaker A/B/C transcript
): Promise<string> {
  // Build label→name map
  const labels = ['A', 'B', 'C', 'D', 'E', 'F']
  const mapping: Record<string, string> = {}
  names.forEach((name, i) => {
    if (labels[i]) mapping[`Speaker ${labels[i]}`] = name.trim()
  })

  // Replace Speaker A/B/C with real names in transcript
  let namedTranscript = rawTranscript
  for (const [label, name] of Object.entries(mapping)) {
    namedTranscript = namedTranscript.replace(new RegExp(label.replace(' ', '\\s+') + ':', 'gi'), `*${name}:*`)
  }

  // Save speaker profiles to memories table for persistence
  await supabaseAdmin.from('memories').insert({
    telegram_id: telegramId,
    content: 'SPEAKER_PROFILES:' + JSON.stringify({ mapping, updated_at: new Date().toISOString() }),
  })

  return namedTranscript
}

// ── Get previously saved speaker names ───────────────────────────────────────

export async function getSavedSpeakers(telegramId: number): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('memories')
    .select('content')
    .eq('telegram_id', telegramId)
    .like('content', 'SPEAKER_PROFILES:%')
    .order('id', { ascending: false })
    .limit(1)

  if (!data?.length) return []

  try {
    const parsed = JSON.parse(data[0].content.replace('SPEAKER_PROFILES:', ''))
    return Object.values(parsed.mapping) as string[]
  } catch { return [] }
}

// ── Re-label a transcript with real names ─────────────────────────────────────

export function relabelTranscript(transcript: string, names: string[]): string {
  const labels = ['A', 'B', 'C', 'D', 'E', 'F']
  let result = transcript
  names.forEach((name, i) => {
    if (labels[i] && name.trim()) {
      result = result.replace(
        new RegExp(`Speaker\\s+${labels[i]}:`, 'gi'),
        `*${name.trim()}:*`
      )
    }
  })
  return result
}

// ── Parse user's name reply ───────────────────────────────────────────────────

export function parseNameReply(text: string): string[] {
  // Handles: "Gogo, Mathew, Srinivas" or "Gogo and Mathew" or "1. Gogo 2. Mathew"
  return text
    .replace(/^\d+[.)]\s*/gm, '') // remove numbered list prefixes
    .split(/[,\n&]|\band\b/i)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length < 50)
    .slice(0, 6)
}

// ── Check if text looks like a name reply ────────────────────────────────────

export function isNameReply(text: string): boolean {
  const clean = text.trim()
  // Short, no question marks, looks like names
  if (clean.length > 200) return false
  if (clean.includes('?')) return false
  const parts = parseNameReply(clean)
  // At least 1 name, each part looks like a name (starts with capital, no long sentences)
  return parts.length >= 1 && parts.every(p => /^[A-Z\u0900-\u097F]/.test(p) && p.split(' ').length <= 4)
}
