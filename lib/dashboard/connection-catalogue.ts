// Every app and site Gogo can work with, India first. How each one connects:
// - signin: Gogo opens the site in your private secure browser; you sign in yourself (password, OTP). Gogo keeps the
//   signed-in browser session, never the password.
// - oauth: the provider's own connect screen (Swiggy, Zepto), set up on the food and grocery page.
// - soon: no safe connection exists yet; shown so the list is honest about what is coming.
// Client-safe: pure data, no server imports.

export type ConnectionKind = 'signin' | 'oauth' | 'soon'
export type ConnectionCategory = 'shopping' | 'grocery' | 'food' | 'travel' | 'events' | 'health' | 'home' | 'work'

export type CatalogueSite = {
  id: string
  name: string
  category: ConnectionCategory
  what: string
  url: string
  kind: ConnectionKind
}

export const CONNECTION_CATEGORIES: Array<{ id: ConnectionCategory; label: string; title: string }> = [
  { id: 'shopping', label: 'Shopping', title: 'Shopping' },
  { id: 'grocery', label: 'Groceries', title: 'Groceries and quick commerce' },
  { id: 'food', label: 'Food', title: 'Food and dining' },
  { id: 'travel', label: 'Travel', title: 'Travel and rides' },
  { id: 'events', label: 'Movies', title: 'Movies, events and sport' },
  { id: 'health', label: 'Health', title: 'Health' },
  { id: 'home', label: 'Home', title: 'Home services and bills' },
  { id: 'work', label: 'Work', title: 'Work apps' },
]

const s = (id: string, name: string, category: ConnectionCategory, what: string, url: string, kind: ConnectionKind = 'signin'): CatalogueSite =>
  ({ id, name, category, what, url, kind })

export const CONNECTION_CATALOGUE: CatalogueSite[] = [
  s('amazon', 'Amazon.in', 'shopping', 'Orders, prices, returns', 'https://www.amazon.in/'),
  s('flipkart', 'Flipkart', 'shopping', 'Orders, prices, returns', 'https://www.flipkart.com/'),
  s('myntra', 'Myntra', 'shopping', 'Fashion orders and returns', 'https://www.myntra.com/'),
  s('ajio', 'Ajio', 'shopping', 'Fashion orders', 'https://www.ajio.com/'),
  s('nykaa', 'Nykaa', 'shopping', 'Beauty orders', 'https://www.nykaa.com/'),
  s('meesho', 'Meesho', 'shopping', 'Orders', 'https://www.meesho.com/'),
  s('tatacliq', 'Tata CLiQ', 'shopping', 'Orders', 'https://www.tatacliq.com/'),
  s('croma', 'Croma', 'shopping', 'Electronics, prices', 'https://www.croma.com/'),
  s('reliancedigital', 'Reliance Digital', 'shopping', 'Electronics, prices', 'https://www.reliancedigital.in/'),
  s('lenskart', 'Lenskart', 'shopping', 'Eyewear orders', 'https://www.lenskart.com/'),
  s('decathlon', 'Decathlon', 'shopping', 'Sports gear', 'https://www.decathlon.in/'),
  s('firstcry', 'FirstCry', 'shopping', 'Kids orders', 'https://www.firstcry.com/'),

  s('blinkit', 'Blinkit', 'grocery', '10-minute delivery', 'https://blinkit.com/'),
  s('zepto', 'Zepto', 'grocery', '10-minute delivery', 'https://www.zeptonow.com/', 'oauth'),
  s('instamart', 'Swiggy Instamart', 'grocery', 'Quick delivery', 'https://www.swiggy.com/instamart', 'oauth'),
  s('bigbasket', 'BigBasket', 'grocery', 'Groceries', 'https://www.bigbasket.com/'),
  s('jiomart', 'JioMart', 'grocery', 'Groceries', 'https://www.jiomart.com/'),

  s('swiggy', 'Swiggy', 'food', 'Food orders, Dineout tables', 'https://www.swiggy.com/', 'oauth'),
  s('zomato', 'Zomato', 'food', 'Food orders', 'https://www.zomato.com/'),
  s('district', 'District', 'food', 'Tables, movies and events', 'https://www.district.in/'),
  s('eazydiner', 'EazyDiner', 'food', 'Table bookings', 'https://www.eazydiner.com/'),

  s('makemytrip', 'MakeMyTrip', 'travel', 'Flights, hotels, trains', 'https://www.makemytrip.com/'),
  s('goibibo', 'Goibibo', 'travel', 'Flights, hotels', 'https://www.goibibo.com/'),
  s('cleartrip', 'Cleartrip', 'travel', 'Flights, hotels', 'https://www.cleartrip.com/'),
  s('easemytrip', 'EaseMyTrip', 'travel', 'Flights', 'https://www.easemytrip.com/'),
  s('ixigo', 'ixigo', 'travel', 'Flights, trains, buses', 'https://www.ixigo.com/'),
  s('indigo', 'IndiGo', 'travel', 'Bookings, web check-in', 'https://www.goindigo.in/'),
  s('airindia', 'Air India', 'travel', 'Bookings, check-in', 'https://www.airindia.com/'),
  s('akasa', 'Akasa Air', 'travel', 'Bookings, check-in', 'https://www.akasaair.com/'),
  s('irctc', 'IRCTC', 'travel', 'Train tickets, PNR', 'https://www.irctc.co.in/'),
  s('redbus', 'redBus', 'travel', 'Bus tickets', 'https://www.redbus.in/'),
  s('uber', 'Uber', 'travel', 'Rides', 'https://m.uber.com/'),
  s('ola', 'Ola', 'travel', 'Rides', 'https://book.olacabs.com/'),
  s('rapido', 'Rapido', 'travel', 'Bike and auto rides', 'https://www.rapido.bike/'),
  s('oyo', 'OYO', 'travel', 'Hotel stays', 'https://www.oyorooms.com/'),
  s('booking', 'Booking.com', 'travel', 'Hotel stays', 'https://www.booking.com/'),
  s('airbnb', 'Airbnb', 'travel', 'Stays', 'https://www.airbnb.co.in/'),

  s('bookmyshow', 'BookMyShow', 'events', 'Movies, concerts, events', 'https://in.bookmyshow.com/'),
  s('pvrinox', 'PVR INOX', 'events', 'Movie tickets', 'https://www.pvrcinemas.com/'),
  s('cinepolis', 'Cinepolis', 'events', 'Movie tickets', 'https://www.cinepolisindia.com/'),
  s('playo', 'Playo', 'events', 'Sports venues', 'https://playo.co/'),
  s('hudle', 'Hudle', 'events', 'Sports venues', 'https://hudle.in/'),

  s('practo', 'Practo', 'health', 'Doctor appointments', 'https://www.practo.com/'),
  s('apollo247', 'Apollo 24/7', 'health', 'Consults, pharmacy', 'https://www.apollo247.com/'),
  s('tata1mg', 'Tata 1mg', 'health', 'Medicines, lab tests', 'https://www.1mg.com/'),
  s('pharmeasy', 'PharmEasy', 'health', 'Medicines', 'https://pharmeasy.in/'),
  s('cultfit', 'Cult.fit', 'health', 'Classes', 'https://www.cult.fit/'),

  s('urbancompany', 'Urban Company', 'home', 'Cleaning, repairs, salon', 'https://www.urbancompany.com/'),
  s('nobroker', 'NoBroker', 'home', 'Home services', 'https://www.nobroker.in/'),
  s('bescom', 'BESCOM', 'home', 'Electricity bills', 'https://bescom.karnataka.gov.in/'),
  s('airtel', 'Airtel', 'home', 'Bills, recharges', 'https://www.airtel.in/'),
  s('jio', 'Jio', 'home', 'Recharges', 'https://www.jio.com/'),

  s('notion', 'Notion', 'work', 'Pages and notes', 'https://www.notion.so/', 'soon'),
  s('slack', 'Slack', 'work', 'Messages', 'https://slack.com/', 'soon'),
  s('outlook', 'Microsoft Outlook', 'work', 'Mail and calendar', 'https://outlook.live.com/', 'soon'),
  s('zoom', 'Zoom', 'work', 'Meetings', 'https://zoom.us/', 'soon'),
  s('trello', 'Trello', 'work', 'Boards', 'https://trello.com/', 'soon'),
  s('zapier', 'Zapier', 'work', 'Automations', 'https://zapier.com/', 'soon'),
]

// Sites whose login Gogo can keep in the vault and use itself (phone and text code, or password). The value is the
// vault provider key in lib/vault/providers.ts. Other sign-in sites use the secure-browser sign-in.
export const VAULT_CONNECT_SITES: Record<string, string> = { amazon: 'amazon', flipkart: 'flipkart', irctc: 'irctc', booking: 'booking', swiggy: 'swiggy', zomato: 'zomato' }

export function connectPath(site: CatalogueSite, ask?: string) {
  const base = `/dashboard/connect/${site.id}`
  return ask ? `${base}?ask=${encodeURIComponent(ask.slice(0, 300))}` : base
}

export function findCatalogueSite(id: unknown): CatalogueSite | null {
  return CONNECTION_CATALOGUE.find(site => site.id === String(id || '')) || null
}

/** The registrable host a site's session lives on (www.amazon.in -> amazon.in). */
export function catalogueDomain(site: CatalogueSite): string {
  return new URL(site.url).hostname.replace(/^(?:www|m|in|book)\./, '')
}
