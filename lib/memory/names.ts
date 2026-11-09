// Pure name helpers shared by connected memory and document saving.

/** "Aman passport" saved, but the page reads "RUDITA CHANEDJA": the label and the read name share no word. Pure. */
export function labelNameMismatch(label: string | null, holder: string | null): boolean {
  const stop = /^(?:my|the|a|an|of|his|her|save|this|passport|passports|id|card|aadhaar|aadhar|pan|licence|license|driving|voter|copy|front|back|page|new|old|doc|document|photo|scan|pic|mine|wife|wifes|husband|husbands|mom|mother|dad|father|son|daughter|kid|kids|brother|sister|indian|expired|renewed|latest|first|second)$/i
  const words = String(label || '').toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stop.test(w))
  const read = String(holder || '').toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean)
  if (!words.length || !read.length) return false
  return !words.some(w => read.some(r => r === w || (r.length > 3 && w.length > 3 && (r.startsWith(w) || w.startsWith(r)))))
}
