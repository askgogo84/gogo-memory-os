// User-facing task names. Run titles are written by workers ("Browser · www.flipkart.com"); people
// should see "Flipkart", not a hostname. Dependency-free so any reply path can import it.
export function friendlyTaskTitle(raw:unknown){
  let t=String(raw??'').trim()
  const browser=t.match(/^Browser\s*[·:-]\s*(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)(?:\.[a-z.]+)?/i)
  if(browser)t=`${browser[1].charAt(0).toUpperCase()}${browser[1].slice(1)}`
  // An older gold watch saved the place as "Bangalore Drops" (fixed in #673); don't repeat the verb in the label.
  t=t.replace(/\bin ([A-Z][a-z]+(?: [A-Z][a-z]+)?) (?:Drops|Falls|Rises|Dips|Crosses)\b/g,'in $1')
  return t
}

// Name used when telling the user which task was cancelled or matched: a browser run reads as
// "the Flipkart browser check", anything else keeps its friendly title.
export function taskDisplayTitle(raw:unknown){
  const friendly=friendlyTaskTitle(raw)
  return /^Browser\s*[·:-]/i.test(String(raw??'').trim())?`${friendly} browser check`:friendly
}
