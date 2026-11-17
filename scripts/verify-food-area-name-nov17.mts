// 17 Nov investor demo: "compare chicken biryani at Meghana Foods in HSR" found no price. An area said by name was
// left inside the restaurant name and never used to pick the outlet; three-letter areas (HSR, BTM) were dropped.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const m = await import('../lib/commerce/comparison-model.ts')
const { outletInArea } = await import('../lib/commerce/price-comparison.ts')
let checks = 0
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++ }

// 1. The area is read out of the request.
eq(m.parseFoodSubject('chicken biryani at Meghana Foods in HSR'), { dish: 'chicken biryani', restaurant: 'Meghana Foods', area: 'HSR' }, 'live: "in HSR"')
eq(m.parseFoodSubject('chicken biryani at Meghana Foods HSR Layout'), { dish: 'chicken biryani', restaurant: 'Meghana Foods', area: 'HSR Layout' }, 'area after the name, no "in"')
eq(m.parseFoodSubject('chicken biryani at Meghana Foods, Koramangala'), { dish: 'chicken biryani', restaurant: 'Meghana Foods', area: 'Koramangala' }, 'after a comma')
eq(m.parseFoodSubject('paneer butter masala at Empire near Indiranagar'), { dish: 'paneer butter masala', restaurant: 'Empire', area: 'Indiranagar' }, 'near …')
eq(m.parseFoodSubject('dal makhani at Burger King in Powai'), { dish: 'dal makhani', restaurant: 'Burger King', area: 'Powai' }, 'an area we do not list works after a two-word name')
// Review (PR #1535): names that contain "in/at/near" are not split.
for (const name of ['Made in Punjab', 'Eat in Peace', 'Pop in Cafe', 'Pizza in Cone', 'Dine at Home', 'Hotel at Whitefield Arms', 'Cafe at Koramangala Social', 'Karavalli in Taj Gateway', 'MTR in Powai'])
  eq(m.parseFoodSubject(`chicken biryani at ${name}`), { dish: 'chicken biryani', restaurant: name }, `a name, not a name plus an area: ${name}`)
eq(m.parseFoodSubject('dal makhani at Made in Punjab in Koramangala'), { dish: 'dal makhani', restaurant: 'Made in Punjab', area: 'Koramangala' }, 'such a name followed by a real area')
eq(m.parseFoodSubject('chicken biryani at Meghana Foods near home'), { dish: 'chicken biryani', restaurant: 'Meghana Foods near home' }, '"near home" is not an area name')
eq(m.parseFoodSubject('chicken biryani at Meghana Foods in HSR today'), { dish: 'chicken biryani', restaurant: 'Meghana Foods', area: 'HSR' }, 'a trailing "today" is dropped')
eq(m.parseFoodSubject('masala dosa at A2B in Jayanagar 4th Block'), { dish: 'masala dosa', restaurant: 'A2B', area: 'Jayanagar 4th Block' }, 'an area with a block number')
eq(m.parseFoodSubject('filter coffee at Third Wave Coffee, Indiranagar'), { dish: 'filter coffee', restaurant: 'Third Wave Coffee', area: 'Indiranagar' }, 'comma form')
eq(m.parseFoodSubject('chicken biryani at Meghana Foods'), { dish: 'chicken biryani', restaurant: 'Meghana Foods' }, 'no area said: unchanged')
eq(m.parseFoodSubject('chicken biryani at Meghana Foods for 560086'), { dish: 'chicken biryani', restaurant: 'Meghana Foods' }, 'pincode form unchanged')
eq(m.parseFoodSubject('filter coffee at Indiranagar Social'), { dish: 'filter coffee', restaurant: 'Indiranagar Social' }, 'an area that starts the name is part of the name')
eq(m.parseFoodSubject('pancakes at Hole in the Wall'), { dish: 'pancakes', restaurant: 'Hole in the Wall' }, '"in the …" inside a name is not an area')
eq(m.parseFoodSubject('pancakes at Hole in the Wall in Koramangala'), { dish: 'pancakes', restaurant: 'Hole in the Wall', area: 'Koramangala' }, 'name with "in", then a real area')
eq(m.parseFoodSubject('pizza at Onesta near me'), { dish: 'pizza', restaurant: 'Onesta near me' }, '"near me" is not an area name')
eq(m.parseFoodSubject('biryani at Koramangala'), { dish: 'biryani', restaurant: 'Koramangala' }, 'a bare area is not split into nothing')

// 2. The outlet for that area ranks first, including three-letter areas.
const z = (slug: string) => ({ url: `https://www.zomato.com/bangalore/${slug}/order` })
const leads = [z('meghana-foods-residency-road'), z('meghana-foods-hsr-bangalore'), z('meghana-foods-rajajinagar-bangalore'), z('meghana-foods-1-koramangala-5th-block-bangalore')]
eq(m.foodRestaurantLead('zomato', 'Meghana Foods', leads, null, 'HSR'), 'https://www.zomato.com/bangalore/meghana-foods-hsr-bangalore/order', 'live: HSR outlet first (was Residency Road)')
eq(m.foodRestaurantLead('zomato', 'Meghana Foods', leads, null, 'HSR Layout'), 'https://www.zomato.com/bangalore/meghana-foods-hsr-bangalore/order', '"HSR Layout" too')
eq(m.foodRestaurantLead('zomato', 'Meghana Foods', leads, null, 'Koramangala'), 'https://www.zomato.com/bangalore/meghana-foods-1-koramangala-5th-block-bangalore/order', 'Koramangala')
eq(m.foodRestaurantLead('zomato', 'Meghana Foods', leads, '560086', 'Rajajinagar'), 'https://www.zomato.com/bangalore/meghana-foods-rajajinagar-bangalore/order', 'the pincode path still picks Rajajinagar')
eq(m.areaWordsOf('HSR Layout'), ['hsr'], 'area words: generic words dropped, short codes kept')
// Review A: ordinals and units are not area words, so the 13 Nov home-area behaviour holds for these areas.
eq([m.areaWordsOf('Rajajinagar 1st Block'), m.areaWordsOf('Koramangala 5th Block'), m.areaWordsOf('Indiranagar 100 ft road'), m.areaWordsOf('HAL 2nd Stage Indiranagar')], [['rajajinagar'], ['koramangala'], ['indiranagar'], ['hal', 'indiranagar']], 'ordinals and "ft" dropped')
eq(outletInArea('https://www.zomato.com/bangalore/meghana-foods-rajajinagar-bangalore/order', 'Rajajinagar 1st Block'), true, 'home area with a block number still matches its outlet')
eq(m.foodRestaurantLead('zomato', 'Meghana Foods', [z('meghana-foods-residency-road'), z('meghana-foods-jayanagar-bangalore'), z('meghana-foods-rajajinagar-bangalore')], '560086', 'Jayanagar 4th Block'), 'https://www.zomato.com/bangalore/meghana-foods-jayanagar-bangalore/order', 'Jayanagar 4th Block picks Jayanagar (was Residency Road in the first version)')
eq(m.foodRestaurantLead('zomato', 'Made in Punjab', [z('homemade-kitchen-hsr'), z('made-in-punjab-ub-city-bangalore')], null, null), 'https://www.zomato.com/bangalore/made-in-punjab-ub-city-bangalore/order', '"Made in Punjab" is searched as a whole name')
eq(m.areaWordsOf('J P Nagar'), ['jp'], 'JP Nagar')
eq([m.slugInArea('/bangalore/meghana-foods-hsr-bangalore/order', 'HSR'), m.slugInArea('/bangalore/chshraddha-cafe/order', 'HSR'), m.slugInArea('/bangalore/empire-btm-bangalore', 'BTM Layout'), m.slugInArea('/x', null)], [true, false, true, false], 'a short area must be a whole path segment')
eq([outletInArea('https://www.zomato.com/bangalore/meghana-foods-hsr-bangalore/order', 'HSR'), outletInArea('https://www.zomato.com/bangalore/meghana-foods-residency-road/order', 'HSR'), outletInArea('https://www.swiggy.com/city/bangalore/meghana-foods-dr-rajkumar-road-rajajinagar-rest288893', 'Rajajinagar')], [true, false, true], 'outlet-in-area check agrees')

// 3. The said area is used first; if no outlet page for it is found, no other branch is opened in its place.
const pc = readFileSync('lib/commerce/price-comparison.ts', 'utf8')
eq(/const saidArea = food\.area \|\| null\s+let area: string \| null = saidArea \|\| homeArea/.test(pc), true, 'said area first, then the home area')
// 17 Nov live (5:54 pm): Zomato has no Meghana Foods page for HSR (its pages: Sarjapur Road, Hosur Road, Indiranagar…).
// The map search gives an address for "Meghana Foods near HSR"; the outlet page whose area is in that address is
// read, and the reply says which outlet it is (review, PR #1537: chosen from real pages, never called "nearest").
const live = ['meghana-foods-sarjapur-road-bangalore', 'meghana-foods-hosur-road-bangalore', 'meghana-foods-indiranagar', 'meghana-foods-kanakapura-road-bangalore', 'meghana-foods-1-koramangala-5th-block-bangalore'].map(z)
eq(outletInArea(String(m.foodRestaurantLead('zomato', 'Meghana Foods', live, null, 'HSR')), 'HSR'), false, 'live lead list: no HSR page')
const pick = (address: string) => m.outletLeadForAddress('zomato', 'Meghana Foods', live, address)
eq(pick('124, Sarjapur Road, Bengaluru, Karnataka 560102'), { url: 'https://www.zomato.com/bangalore/meghana-foods-sarjapur-road-bangalore/order', area: 'Sarjapur Road' }, 'a "… Road" address finds the Sarjapur Road page')
eq(pick('Sarjapur Main Rd, above Fab India, Bellandur, Bengaluru')?.area, 'Sarjapur Road', '"Rd" and a different locality word still match Sarjapur')
eq(pick('1st Block Koramangala, HSR Layout 5th Sector, Bengaluru')?.area, 'Koramangala 5th Block', 'Koramangala address finds the Koramangala page')
eq(pick('27th Main Rd, HSR Layout, Bengaluru, Karnataka 560102'), null, 'an address in the said area with no page for it: nothing is substituted')
eq(pick('Linking Road, Bandra West, Mumbai, Maharashtra'), null, 'another city: nothing')
eq(pick(''), null, 'no address: nothing')
eq(/const other = listing \? outletLeadForAddress\(next\.provider, food\.restaurant, leadsSoFar, String\(listing\.address \|\| ''\)\) : null\s*if \(other && !outletInArea\(other\.url, saidArea\)\) \{/.test(pc) && /\} else found = \{leads: leadsSoFar, url: null\}/.test(pc), true, 'no page for the said area: the map address picks one of the pages found, or nothing')
eq(/next\.outletNote = `No \$\{food\.restaurant\} outlet in \$\{saidArea\} on \$\{COMPARISON_PROVIDERS\[next\.provider\]\.label\}\. This is the \$\{other\.area\} outlet, which the map shows for \$\{saidArea\}\.`/.test(pc), true, 'the note says which outlet was read')
eq(/\.\.\.\(row\.outletNote \? \{outletNote: row\.outletNote\} : \{\}\)\}, child\.error\)\)/.test(pc), true, 'the note survives the row rebuild when the read finishes (review defect 1)')
const row: any = { provider: 'zomato', status: 'observed', sourceUrl: 'https://www.zomato.com/bangalore/meghana-foods-sarjapur-road-bangalore/order', evidence: 'Chicken Biryani ₹365\nMeghana Foods, Sarjapur Road', outletNote: 'No Meghana Foods outlet in HSR on Zomato. This is the Sarjapur Road outlet, which the map shows for HSR.' }
const done: any = { id: 't', status: 'completed', metadata_json: { subject: 'chicken biryani at Meghana Foods in HSR', request: 'compare chicken biryani at Meghana Foods in HSR', providers: [row], withheld: [] } }
eq(/₹365/.test(String(m.comparisonWhatsAppSummary(done))) && String(m.comparisonWhatsAppSummary(done)).includes(row.outletNote), true, 'WhatsApp reply: the price and which outlet it is')
eq(String(m.comparisonSummary(done)).includes(row.outletNote), true, 'dashboard summary carries the same note')
eq(/\(the outlet in Sarjapur Road\)/.test(m.comparisonObjective({ metadata_json: { subject: 'chicken biryani at Meghana Foods in HSR', request: 'x', providers: [] } } as any, 'zomato', 'Sarjapur Road')), true, 'the browser is sent to the outlet actually chosen')
const task: any = { metadata_json: { subject: 'chicken biryani at Meghana Foods in HSR', request: 'compare chicken biryani at Meghana Foods in HSR', providers: [] } }
const objective = m.comparisonObjective(task, 'zomato')
eq(/restaurant "Meghana Foods" \(the outlet in HSR\)/.test(objective) && /shows no outlet of this restaurant in HSR, stop and report that; do not read a different outlet/.test(objective), true, 'the browser is told the area and not to substitute another outlet')
eq(/outlet in/.test(m.comparisonObjective({ metadata_json: { subject: 'chicken biryani at Meghana Foods', request: 'compare chicken biryani at Meghana Foods for 560086', providers: [] } } as any, 'zomato')), false, 'no area said: objective unchanged')
console.log(`PASS verify-food-area-name-nov17: ${checks} checks`)
