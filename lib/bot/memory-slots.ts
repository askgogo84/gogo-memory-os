// One current value per "slot" (24 Oct live): "What do you know about me?" showed three parking spots (B2 14,
// B3 21, B2 9) because each "remember my car is parked at …" added a row. Saving a new value for the same slot
// replaces the older ones, the way a person updates what they know. Pure.
const SLOTS: Array<[string, RegExp]> = [
  ['car_parking', /\b(?:car|vehicle)\b[^.]{0,40}\bpark(?:ed|ing)\b|\bpark(?:ed|ing)\b[^.]{0,40}\b(?:car|vehicle|slot|level|basement|b\d)\b|\bparking (?:spot|slot|space|bay)\b/i],
  ['bike_parking', /\b(?:bike|scooter|scooty|two[- ]wheeler)\b[^.]{0,40}\bpark(?:ed|ing)\b/i],
  ['gym_locker', /\bgym\b[^.]{0,30}\blocker\b|\blocker\b[^.]{0,30}\bgym\b/i],
  ['office_address', /\b(?:my\s+)?office (?:address|is (?:at|in|on))\b/i],
  ['home_address', /\b(?:my\s+)?home address\b|\bi live (?:at|in|on)\b/i],
]

export function memorySlotOf(text: string): string | null {
  const t = String(text || '')
  // A bike line is not a car line, so check the more specific slot first.
  const ordered = [SLOTS[1], ...SLOTS.filter((_, i) => i !== 1)]
  for (const [slot, re] of ordered) if (re.test(t)) return slot
  return null
}
