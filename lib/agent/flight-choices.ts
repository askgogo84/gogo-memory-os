// The flight questions Gogo asks one at a time, and the tap options that go with each.
// No imports: this file is read by both the travel brief (which writes the question) and the WhatsApp
// sender (which turns the question into buttons). A tap comes back as ordinary text ("Round trip",
// "2 adults", "Business", "Morning"), so the same understanding used for typed replies reads it.
export type FlightChoiceKind = 'trip' | 'travellers' | 'cabin' | 'time'

export type FlightChoice =
  | { kind: 'trip' | 'travellers' | 'cabin'; question: string; options: { title: string }[] }
  | { kind: 'time'; question: string; options: { title: string; description: string }[] }

export const FLIGHT_CHOICES: Record<FlightChoiceKind, FlightChoice> = {
  trip: { kind: 'trip', question: 'One-way or round trip?', options: [{ title: 'One way' }, { title: 'Round trip' }] },
  travellers: { kind: 'travellers', question: 'How many people are travelling? Tap a number or type it, for example 4 adults, 1 child.', options: [{ title: '1 adult' }, { title: '2 adults' }, { title: '3 adults' }] },
  cabin: { kind: 'cabin', question: 'Which cabin: economy, premium economy, business or first class? Tap one or type it.', options: [{ title: 'Economy' }, { title: 'Premium economy' }, { title: 'Business' }] },
  time: { kind: 'time', question: 'Departure time: morning, afternoon, evening, night or any time?', options: [
    { title: 'Morning', description: '5 am to 12 pm' },
    { title: 'Afternoon', description: '12 pm to 5 pm' },
    { title: 'Evening', description: '5 pm to 9 pm' },
    { title: 'Night', description: '9 pm to 5 am' },
    { title: 'Any time', description: 'Show every departure' },
  ] },
}

/**
 * If this reply is one of Gogo's single flight questions, return it with a one-line body for a tap message.
 * The question sentence is Gogo's own fixed wording, so nothing the person wrote can trigger this.
 */
export function flightChoiceFromText(text: string): { choice: FlightChoice; body: string } | null {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  for (const choice of Object.values(FLIGHT_CHOICES)) {
    const at = lines.indexOf(choice.question)
    if (at < 0) continue
    // The line before the question carries the route and date; "Or say go ..." after it is for typed replies.
    const head = at > 0 ? lines[at - 1] : ''
    const body = [head, choice.question].filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 900)
    return { choice, body }
  }
  return null
}
