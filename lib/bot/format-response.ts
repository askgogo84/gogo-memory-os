import type { Channel } from './resolve-user'

export function formatOutgoingText(channel: Channel, text: string): string {
  const clean = (text || '').trim().replace(/\n{3,}/g, '\n\n')

  if (channel === 'whatsapp') {
    return clean
      .replace(/\*\*/g, '*')
      .slice(0, 3500)
  }

  return clean.slice(0, 4096)
}

