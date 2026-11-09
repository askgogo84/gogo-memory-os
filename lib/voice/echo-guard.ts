// Echo guard (8 Nov) for any surface that both speaks and listens (desktop/TV satellite, a future dashboard voice mode).
// The reported fault: Gogo hears its own reply through the speaker and answers it as a new command, so it repeats.
// Three rules, all pure and testable, to be used by the surface's audio loop:
//   1. While Gogo is speaking, and for a short tail after, the microphone's transcripts are not commands.
//   2. A transcript that closely matches what Gogo just said is its own voice, whenever it arrives.
//   3. One utterance → at most one request: the same final transcript within a short window is ignored.
// Barge-in stays possible: the person can stop playback with an explicit control or wake word, which the surface
// handles before calling acceptTranscript.

export type EchoGuardState = {
  speakingUntil: number          // ms epoch; > now while TTS is playing
  lastSpoken: { text: string; at: number } | null
  lastAccepted: { text: string; at: number } | null
}

export const ECHO_TAIL_MS = 700        // room reverb + device output latency after playback ends
export const ECHO_MEMORY_MS = 20_000   // how long Gogo's last reply is compared against what the mic hears
export const DUPLICATE_WINDOW_MS = 4_000

export function newEchoGuard(): EchoGuardState { return { speakingUntil: 0, lastSpoken: null, lastAccepted: null } }

/** Call when playback starts with the text being spoken and its expected duration. Pure. */
export function startedSpeaking(s: EchoGuardState, text: string, durationMs: number, now = Date.now()): EchoGuardState {
  return { ...s, speakingUntil: now + Math.max(0, durationMs), lastSpoken: { text, at: now } }
}
/** Call when playback ends or is stopped (stop, barge-in). Keeps the tail. Pure. */
export function stoppedSpeaking(s: EchoGuardState, now = Date.now()): EchoGuardState { return { ...s, speakingUntil: Math.min(s.speakingUntil, now) } }

const words = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)

/** Share of the heard words that also appear, in order, in what Gogo said (longest common subsequence / heard). Pure. */
export function overlap(heard: string, spoken: string): number {
  const a = words(heard), b = words(spoken)
  if (!a.length || !b.length) return 0
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  return dp[a.length][b.length] / a.length
}

export type TranscriptDecision = { accept: true; state: EchoGuardState } | { accept: false; reason: 'speaking' | 'echo' | 'duplicate' | 'empty'; state: EchoGuardState }

/** Decide whether a final transcript from the microphone is a new request. Pure. */
export function acceptTranscript(s: EchoGuardState, transcript: string, now = Date.now()): TranscriptDecision {
  const text = transcript.trim()
  if (words(text).length === 0) return { accept: false, reason: 'empty', state: s }
  if (now < s.speakingUntil + ECHO_TAIL_MS) return { accept: false, reason: 'speaking', state: s }
  if (s.lastSpoken && now - s.lastSpoken.at < ECHO_MEMORY_MS && words(text).length >= 2 && overlap(text, s.lastSpoken.text) >= 0.6) return { accept: false, reason: 'echo', state: s }
  if (s.lastAccepted && now - s.lastAccepted.at < DUPLICATE_WINDOW_MS && words(s.lastAccepted.text).join(' ') === words(text).join(' ')) return { accept: false, reason: 'duplicate', state: s }
  return { accept: true, state: { ...s, lastAccepted: { text, at: now } } }
}

/** The getUserMedia constraints every listening surface should ask for. */
export const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } } as const
