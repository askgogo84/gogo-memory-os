// Shared by the emitted worker and human takeover server. Output is limited to
// load state and HTTP status: no URLs, cookies, headers or provider page data.
export const BROWSER_PAGE_READINESS=String.raw`
function observeBrowserPage(page){
 let httpStatus=null,wafAction=null,navigationFailed=false;
 page.on('response',response=>{
  if(response.request().isNavigationRequest()&&response.frame()===page.mainFrame()){
   httpStatus=response.status();
   const action=response.headers()['x-amzn-waf-action'];
   wafAction=action==='challenge'||action==='captcha'?action:null;
   navigationFailed=false;
  }
 });
 const sample=()=>page.evaluate(()=>({
  hasContent:Boolean(document.body?.innerText?.trim())||Array.from(document.querySelectorAll('input,button,select,canvas,img')).some(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0}),
  challenge:Array.from(document.scripts).some(script=>{try{const u=new URL(script.src);return u.hostname.endsWith('.token.awswaf.com')&&/\/(?:challenge|captcha)\.js$/.test(u.pathname)}catch{return false}}),
 }));
 const pricePending=()=>page.evaluate(()=>{
  if(location.protocol!=='https:'||!['croma.com','www.croma.com'].includes(location.hostname)||!/^\/[a-z0-9]+(?:-[a-z0-9]+){3,}-?\/p\/\d{6,7}\/?$/i.test(location.pathname))return false;
  const text=document.body?.innerText||'';
  return !/₹\s*\d[\d,]*(?:\.\d+)?/.test(text)||/(?:^|\s)NaN(?:\s|$)/.test(text);
 });
 return {
  navigationFailed:()=>{navigationFailed=true},
  read:async(wait=false)=>{
   let observed=await sample();
   // A 202 is not a loaded storefront. Allow the provider's own normal script
   // time to finish, without solving CAPTCHAs or manufacturing a WAF token.
   if(wait&&(observed.challenge||!observed.hasContent)&&!(httpStatus>=400)){
    await page.waitForFunction(()=>{
     const challenge=Array.from(document.scripts).some(script=>{try{const u=new URL(script.src);return u.hostname.endsWith('.token.awswaf.com')&&/\/(?:challenge|captcha)\.js$/.test(u.pathname)}catch{return false}});
     return !challenge&&(Boolean(document.body?.innerText?.trim())||Array.from(document.querySelectorAll('input,button,select,canvas,img')).some(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0}));
    },null,{timeout:12000,polling:250}).catch(()=>{});
    observed=await sample();
   }
   // Croma renders the product before its price request finishes: the early
   // body has NaN and a temporary unavailable message. Wait for visible price
   // hydration, without clicking, selecting a location or inferring a value.
   if(wait&&!(httpStatus>=400)&&!observed.challenge&&!wafAction&&await pricePending()){
    await page.waitForFunction(()=>{
     if(location.protocol!=='https:'||!['croma.com','www.croma.com'].includes(location.hostname)||!/^\/[a-z0-9]+(?:-[a-z0-9]+){3,}-?\/p\/\d{6,7}\/?$/i.test(location.pathname))return true;
     const text=document.body?.innerText||'';
     return /₹\s*\d[\d,]*(?:\.\d+)?/.test(text)&&!/(?:^|\s)NaN(?:\s|$)/.test(text);
    },null,{timeout:12000,polling:250}).catch(()=>{});
    observed=await sample();
   }
   return {state:observed.challenge||wafAction?'security_check':httpStatus>=400?'http_error':navigationFailed&&!observed.hasContent?'navigation_error':observed.hasContent?'ready':'empty',httpStatus};
  },
 };
}
`
