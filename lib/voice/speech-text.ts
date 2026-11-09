// Pure: what a reply sounds like when read aloud. Shared by WhatsApp voice notes and the dashboard Listen button.
const MAX_SPEECH_CHARS = 3500

/** Text as it should be spoken: no links, markdown, bullets or emoji clutter. */
export function speechText(text: string): string {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_~`#>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_SPEECH_CHARS)
}

