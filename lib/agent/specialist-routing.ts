export function shouldPreferSpecialistTravel(text: string) {
  const raw = String(text || '').trim()
  if (!/\b(flight|flights|airfare|fare|fares|hotel|hotels|travel)\b/i.test(raw)) return false
  if (!/\b(find|search|compare|options|available|availability|current fare|current fares|live sources?|best available|cheapest|price|prices)\b/i.test(raw)) return false

  // A pure research request belongs to the specialist travel engine so the real
  // provider/public-web result is the user-facing answer. Explicit cross-feature
  // outcomes still belong to the persistent multi-tool planner.
  const crossFeature = /\b(remind\s+me|set\s+(?:a\s+)?reminder|add\s+.*\bcalendar\b|create\s+.*\blist\b|add\s+.*\blist\b|save\s+(?:this|it|the\s+results?)|create\s+.*\btask\b|add\s+.*\btask\b|then\s+(?:remind|save|add|create|email|send)|email\s+me|send\s+me)\b/i.test(raw)
  return !crossFeature
}
