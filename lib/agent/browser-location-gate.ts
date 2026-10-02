// A delivery-location gate is missing user input, not authentication or a 403.
// Require an observed location input plus provider copy; a navigation header
// saying "Select location" alone must not interrupt a usable product page.
export function needsBrowserDeliveryLocation(page:any):boolean {
  const fields=(page.forms||[]).flatMap((form:any)=>form.inputs||[])
  const locationField=fields.some((field:any)=>
    /\b(?:search|enter|select|choose)\s+(?:your\s+)?(?:delivery\s+)?(?:location|address|pincode|pin code)\b/i.test(String(field.label||'')))
  const prompt=/\b(?:provide|select|choose|enter)\s+(?:your\s+)?delivery\s+(?:location|address)\b/i.test(String(page.text||''))
  return locationField&&prompt
}
