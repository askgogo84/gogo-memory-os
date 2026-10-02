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
}

export function foodLocationReply(text:string){
  const t=text.trim()
  if(t.length>500||/\b(?:otp|password|verification|bank|card|price|cost|watch|remind|email|mail|train|flight)\b/i.test(t))return null
  const pin=t.match(/(?<![\w-])[1-9]\d{5}(?![\w-])/)
  if(!pin)return null
  // Search only the postal area, never send a full street/house address to search.
  return {pin:pin[0],country:'India' as const}
}

export function foodSearchSubject(text:string){
  const food=text.match(/\b(?:burger|pizza|biryani|food|meal|dosa|sandwich|restaurant)s?\b/i)?.[0]||'food'
  const diet=/\b(?:veg|vegetarian)\b/i.test(text)?'vegetarian ':/\bvegan\b/i.test(text)?'vegan ':''
  return `${diet}${food}`
}
