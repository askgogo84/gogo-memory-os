// India-first place resolution for searches. AskGogo's customers are in India, so a locality such
// as "HSR Layout" means HSR Layout, Bengaluru, and a search should stay in India and prefer Indian
// booking sites. Pure: no I/O.
//
// Live run 10 Oct: "salon near HSR Layout" found nothing because HSR Layout was not known to be in
// Bengaluru, so every result had to literally contain "hsr layout".

type City = { name: string; aliases: string[]; localities: string[] }

const CITIES: City[] = [
  { name: 'Bengaluru', aliases: ['bengaluru', 'bangalore', 'blr'], localities: [
    'hsr layout', 'hsr', 'indiranagar', 'koramangala', 'whitefield', 'jayanagar', 'jp nagar', 'j p nagar', 'btm layout', 'btm',
    'marathahalli', 'electronic city', 'hebbal', 'yelahanka', 'mg road', 'brigade road', 'church street', 'malleshwaram',
    'rajajinagar', 'basavanagudi', 'banashankari', 'bellandur', 'sarjapur', 'sarjapur road', 'hennur', 'kalyan nagar',
    'rt nagar', 'frazer town', 'ulsoor', 'domlur', 'old airport road', 'cunningham road', 'lavelle road', 'richmond town',
    'sadashivanagar', 'yeshwanthpur', 'vijayanagar', 'kr puram', 'bannerghatta road', 'hosur road', 'kanakapura road',
    'mahadevapura', 'brookefield', 'hsr sector', 'agara', 'haralur', 'kundalahalli', 'itpl', 'manyata tech park', 'nagawara',
  ] },
  { name: 'Mumbai', aliases: ['mumbai', 'bombay'], localities: [
    'andheri', 'bandra', 'juhu', 'powai', 'lower parel', 'worli', 'colaba', 'dadar', 'goregaon', 'malad', 'borivali',
    'khar', 'santacruz', 'vile parle', 'chembur', 'bkc', 'bandra kurla complex', 'fort', 'kandivali', 'thane',
  ] },
  { name: 'Delhi NCR', aliases: ['delhi', 'new delhi', 'ncr', 'gurgaon', 'gurugram', 'noida'], localities: [
    'connaught place', 'cp', 'hauz khas', 'saket', 'vasant kunj', 'greater kailash', 'gk', 'lajpat nagar', 'karol bagh',
    'dwarka', 'rajouri garden', 'khan market', 'defence colony', 'cyber hub', 'golf course road', 'sector 29', 'dlf',
  ] },
  { name: 'Hyderabad', aliases: ['hyderabad', 'secunderabad'], localities: [
    'banjara hills', 'jubilee hills', 'hitech city', 'hi-tech city', 'gachibowli', 'madhapur', 'kondapur', 'kukatpally', 'begumpet',
  ] },
  { name: 'Chennai', aliases: ['chennai', 'madras'], localities: [
    't nagar', 'anna nagar', 'adyar', 'velachery', 'nungambakkam', 'besant nagar', 'mylapore', 'omr', 'ecr',
  ] },
  { name: 'Pune', aliases: ['pune'], localities: ['koregaon park', 'kalyani nagar', 'baner', 'viman nagar', 'hinjewadi', 'aundh', 'kothrud', 'wakad'] },
  { name: 'Kolkata', aliases: ['kolkata', 'calcutta'], localities: ['park street', 'salt lake', 'new town', 'ballygunge', 'alipore'] },
  { name: 'Goa', aliases: ['goa'], localities: ['panaji', 'panjim', 'calangute', 'baga', 'anjuna', 'candolim', 'vagator', 'assagao'] },
]

export const FOREIGN_PLACE = /\b(dubai|sharjah|abu dhabi|uae|qatar|doha|singapore|london|new york|california|texas|kaunas|lithuania|toronto|sydney|melbourne|usa|united states|uk|united kingdom|canada|australia)\b/i

export type IndiaPlace = {
  /** The place as the person named it, if any (e.g. "HSR Layout"). */
  locality: string
  /** The city it belongs to (e.g. "Bengaluru"), or '' when unknown. */
  city: string
  /** Words a result may contain to count as this place. Empty means India-wide. */
  aliases: string[]
  /** Appended to search queries: locality, city and India. */
  querySuffix: string
}

function words(value: string) {
  return ` ${String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
}

/** Resolve a named place (or none) to an Indian locality and city. `homeCity` is used when no city is named. */
export function resolveIndiaPlace(named: string, homeCity?: string | null): IndiaPlace {
  const locality = String(named || '').replace(/\s+/g, ' ').trim()
  const hay = words(locality)
  let city: City | undefined = CITIES.find((c) => c.aliases.some((a) => hay.includes(` ${a} `)))
  if (!city) city = CITIES.find((c) => c.localities.some((l) => hay.includes(` ${l} `)))
  if (!city && homeCity) city = CITIES.find((c) => c.aliases.some((a) => words(homeCity).includes(` ${a} `)))
  const cityName = city?.name || (homeCity ? String(homeCity).trim() : '')
  const isCityItself = Boolean(city && city.aliases.some((a) => hay.trim() === a))
  const aliases = city
    ? Array.from(new Set([...(locality && !isCityItself ? [locality.toLowerCase()] : []), ...city.aliases]))
    : locality ? [locality.toLowerCase()] : []
  const querySuffix = [isCityItself ? '' : locality, cityName, 'India'].filter(Boolean).join(' ')
  return { locality, city: cityName, aliases, querySuffix }
}

/**
 * True when a result can belong to this place: never a foreign place unless it also names ours;
 * when the city is known, the result must name the locality or the city; when nothing is known,
 * anything in India passes.
 */
export function resultInPlace(text: string, place: IndiaPlace): boolean {
  const hay = String(text || '').toLowerCase()
  const named = place.aliases.some((a) => hay.includes(a))
  if (FOREIGN_PLACE.test(hay) && !named) return false
  if (!place.city) return true
  return named
}
