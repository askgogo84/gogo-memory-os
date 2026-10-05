// 2 Oct live Instamart journey: its cloud page stayed blank while the same URL
// rendered locally. These script hosts were observed in the public page DOM.
// Keep the list explicit; page-supplied URLs must not expand browser authority.
const SWIGGY_PAGE_DEPENDENCIES = [
  'media-assets.swiggy.com',
  'instamart-media-assets.swiggy.com',
  'b67f7794189c.edge.sdk.awswaf.com',
  // Cloud HTML response on 2 Oct is an AWS WAF interstitial, not the storefront.
  // Its own script must load normally; no challenge solving or token fabrication.
  'b67f7794189c.f957f42c.ap-south-1.token.awswaf.com',
]
const ZEPTO_PAGE_DEPENDENCIES = [
  '277df17f54ea.f4d9c26b.ap-south-1.token.awswaf.com',
  // 2 Oct live control: stylesheet and application scripts load from this CDN.
  'cdn.zeptonow.com',
  // 6 Oct live location search: Zepto's address autocomplete uses this sibling
  // API host, which is outside *.www.zepto.com and was failing with ERR_FAILED.
  'bff-gateway.zepto.com',
]

// 3 Oct electronics diagnostics: these stylesheet/bootstrap/image hosts were
// read from the actual public Amazon and Flipkart DOM. The broker previously
// aborted them because their domains differ from the storefront hostname.
const AMAZON_PAGE_DEPENDENCIES = ['m.media-amazon.com','images-na.ssl-images-amazon.com']
const FLIPKART_PAGE_DEPENDENCIES = ['static-assets-web.flixcart.com','rukminim2.flixcart.com']

export function browserPageAllowlist(url:string):Record<string,string[]>{
  const host=new URL(url).hostname.toLowerCase()
  const hosts=[host,`*.${host}`]
  // 3 Oct live cloud page lacked the flight widget. The public DOM loads its
  // booking/remoteEntry.js from a sibling host, not *.www.goindigo.in.
  // The restored live widget then failed its observed airport-search GET on
  // api-prod-skyplus.goindigo.in/bookingwidgetsearchengine/search.
  if(host==='www.goindigo.in'||host==='goindigo.in')hosts.push('app-prod-skyplus6e.goindigo.in','api-prod-skyplus.goindigo.in')
  if(host==='www.amazon.in'||host==='amazon.in')hosts.push(...AMAZON_PAGE_DEPENDENCIES)
  // 3 Oct live Network panel: Zomato images/fonts/videos failed on this exact
  // asset host while same-origin scripts loaded. Do not grant sibling domains.
  if(host==='www.zomato.com'||host==='zomato.com')hosts.push('b.zmtcdn.com')
  if(host==='www.flipkart.com'||host==='flipkart.com')hosts.push(...FLIPKART_PAGE_DEPENDENCIES)
  if(host==='www.swiggy.com'||host==='swiggy.com')hosts.push(...SWIGGY_PAGE_DEPENDENCIES)
  if(host==='www.zepto.com'||host==='zepto.com')hosts.push(...ZEPTO_PAGE_DEPENDENCIES)
  return Object.fromEntries(hosts.map(name=>[name,[]]))
}
