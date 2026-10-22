// Oct 1 production incident: a nearby veg-burger comparison fell through to
// generic chat and returned US restaurants, unsupported distances and a coupon.
// 3 Oct live Zomato request explicitly chose browser execution, but food
// discovery intercepted it before the browser handler on every surface.
export function isExplicitFoodBrowserRequest(text:string){
  return /^\s*(?:open|browse|visit|navigate to|go to)\s+https?:\/\/\S+\s+(?:in|using)\s+(?:the\s+)?browser\b/i.test(text)
}

export function isFoodComparisonRequest(text:string){
  if(isExplicitFoodBrowserRequest(text))return false
  return /\b(?:find|compare|cheapest|best)\b/i.test(text)
    && /\b(?:burger|pizza|biryani|food|meal|dosa|sandwich|restaurant)s?\b/i.test(text)
    && /\b(?:near|nearest|nearby|delivery|swiggy|zomato|magicpin)\b/i.test(text)
    && !/\b(?:remind|remember|recipe|cook|book a table|reserve)\b/i.test(text)
    // 18 Oct live: "best biryani places near Rajajinagar" is a where-to-eat question, not a delivery price
    // comparison, and asked for a PIN code. Places/spots without an order word go to the normal answer.
    && !(/\b(?:places?|spots?|joints?|outlets?|where to eat|dine|dining|eat out)\b/i.test(text) && !/\b(?:deliver(?:y|s|ed)?|order|swiggy|zomato|magicpin|cheapest|compare|price)\b/i.test(text))
}

// 22 Oct live R25d: "... near Rajajinagar" still asked for a PIN code. A named locality is enough
// for the first provider-page lookup, so common Bengaluru areas resolve to their main post-office PIN.
// Kept deliberately small: only areas whose PIN is certain; anything else still asks.
const BENGALURU_AREA_PINS:Array<{area:string;pin:string;pattern:RegExp}>=[
  {area:'Rajajinagar',pin:'560010',pattern:/\brajaji\s*nagar\b/i},
  {area:'Malleshwaram',pin:'560003',pattern:/\bmalle(?:sh|s)waram\b/i},
  {area:'Jayanagar',pin:'560041',pattern:/\bjaya\s*nagar\b/i},
  {area:'Koramangala',pin:'560034',pattern:/\bkoramangala\b/i},
  {area:'Indiranagar',pin:'560038',pattern:/\bindira\s*nagar\b/i},
  {area:'HSR Layout',pin:'560102',pattern:/\bhsr(?:\s+layout)?\b/i},
  {area:'Whitefield',pin:'560066',pattern:/\bwhite\s*field\b/i},
  {area:'BTM Layout',pin:'560076',pattern:/\bbtm(?:\s+layout)?\b/i},
  {area:'JP Nagar',pin:'560078',pattern:/\bj\.?\s*p\.?\s*nagar\b/i},
  {area:'Basavanagudi',pin:'560004',pattern:/\bbasavanagudi\b/i},
  {area:'Hebbal',pin:'560024',pattern:/\bhebbal\b/i},
  {area:'Yelahanka',pin:'560064',pattern:/\byelahanka\b/i},
  {area:'Electronic City',pin:'560100',pattern:/\b(?:electronics?\s+city|e-?city)\b/i},
  {area:'Marathahalli',pin:'560037',pattern:/\bmar(?:a|)thahalli\b/i},
  {area:'Banashankari',pin:'560050',pattern:/\bbanashankari\b/i},
]

/** A known Bengaluru locality named in the text, resolved to its main post-office PIN, or null. */
export function foodAreaLocation(text:string){
  const hit=BENGALURU_AREA_PINS.find(x=>x.pattern.test(String(text||'')))
  return hit?{pin:hit.pin,country:'India' as const,area:hit.area}:null
}

export function foodLocationReply(text:string):{pin:string;country:'India';area?:string}|null{
  const t=text.trim()
  if(t.length>500||/\b(?:otp|password|verification|bank|card|price|cost|watch|remind|email|mail|train|flight)\b/i.test(t))return null
  const pin=t.match(/(?<![\w-])[1-9]\d{5}(?![\w-])/)
  // A short reply naming a known locality ("Rajajinagar", "I'm in Koramangala, Bangalore") answers the
  // location question too. Longer unrelated chat that merely mentions an area is not a location reply.
  if(!pin)return t.length<=80?foodAreaLocation(t):null
  // Search only the postal area, never send a full street/house address to search.
  return {pin:pin[0],country:'India' as const}
}

export function foodSearchSubject(text:string){
  const food=text.match(/\b(?:burger|pizza|biryani|food|meal|dosa|sandwich|restaurant)s?\b/i)?.[0]||'food'
  const diet=/\b(?:veg|vegetarian)\b/i.test(text)?'vegetarian ':/\bvegan\b/i.test(text)?'vegan ':''
  return `${diet}${food}`
}
