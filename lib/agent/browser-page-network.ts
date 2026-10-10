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
]

// 3 Oct electronics diagnostics: these stylesheet/bootstrap/image hosts were
// read from the actual public Amazon and Flipkart DOM. The broker previously
// aborted them because their domains differ from the storefront hostname.
const AMAZON_PAGE_DEPENDENCIES = ['m.media-amazon.com','images-na.ssl-images-amazon.com']
// 6 Oct bot-block probe (A-vs-B): with only the base www host + flixcart CDNs allowed,
// Flipkart's /account/login timed out because its OWN first-party fraud/data-collector
// API (sonic.fdp.api.flipkart.com) and API gateway (1.rome.api.flipkart.com) were aborted
// by the broker — the registrable-domain siblings never matched `*.www.flipkart.com`.
// These are first-party flipkart.com hosts only; third-party trackers stay blocked.
const FLIPKART_PAGE_DEPENDENCIES = ['static-assets-web.flixcart.com','rukminim2.flixcart.com','sonic.fdp.api.flipkart.com','1.rome.api.flipkart.com']
// 6 Oct probe: croma.com had no entry at all, so its OWN CDN/API (assets.croma.com,
// media-ik.croma.com, api.croma.com) were aborted and the SPA failed to render. First-party
// croma.com hosts only; third-party (adobedtm/fullstory/rudderlabs/appdynamics/go-mpulse) stay blocked.
const CROMA_PAGE_DEPENDENCIES = ['assets.croma.com','media-ik.croma.com','api.croma.com']
// 7 Oct live flight read: the broker aborted these script/font hosts 12 times.
// Grant only the observed hosts for Google Flights, never wildcard Google egress.
const GOOGLE_FLIGHTS_PAGE_DEPENDENCIES = ['www.gstatic.com','fonts.googleapis.com','fonts.gstatic.com']
// 9 Oct Hugging Face takeover: the sign-up page answered 202 with the provider's AWS WAF
// interstitial, and its token script host was blocked by the sandbox, so the visible human
// check rendered as a blank frame. The token host differs per run (a different region and
// id prefix each time), so an exact host cannot match. Grant only AWS's WAF token domain,
// and only for Hugging Face pages, so the person can see and complete the check. Gogo does
// not solve it or fabricate a token.
// 10 Oct: the takeover frame stayed blank again with only the token domain allowed. A visible AWS
// WAF CAPTCHA loads from other awswaf.com hosts (CAPTCHA SDK and puzzle). Grant AWS's WAF domain,
// still only for Hugging Face pages, so the person can see and solve it themselves.
// 10 Oct run 2c73711f: after submit, Hugging Face showed an hCaptcha whose script (js.hcaptcha.com)
// the allowlist aborted, so the person could not see it. Its password-breach check also failed.
const HUGGING_FACE_PAGE_DEPENDENCIES = ['*.awswaf.com', 'hcaptcha.com', '*.hcaptcha.com', 'api.pwnedpasswords.com']

export function browserPageAllowlist(url:string):Record<string,string[]>{
  const target=new URL(url)
  const host=target.hostname.toLowerCase()
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
  if(host==='www.croma.com'||host==='croma.com')hosts.push(...CROMA_PAGE_DEPENDENCIES)
  if(host==='www.swiggy.com'||host==='swiggy.com')hosts.push(...SWIGGY_PAGE_DEPENDENCIES)
  if(host==='www.zepto.com'||host==='zepto.com')hosts.push(...ZEPTO_PAGE_DEPENDENCIES)
  if((host==='www.google.com'||host==='google.com') && /^\/travel\/flights(?:\/|$)/.test(target.pathname))
    hosts.push(...GOOGLE_FLIGHTS_PAGE_DEPENDENCIES)
  if(host==='huggingface.co'||host==='www.huggingface.co')hosts.push(...HUGGING_FACE_PAGE_DEPENDENCIES)
  return Object.fromEntries(hosts.map(name=>[name,[]]))
}
