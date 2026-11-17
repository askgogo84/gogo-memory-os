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
eq(m.parseFoodSubject('masala dosa at MTR in Powai'), { dish: 'masala dosa', restaurant: 'MTR', area: 'Powai' }, 'any area works after "in", not only Bengaluru ones')
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
eq(m.areaWordsOf('J P Nagar'), ['jp'], 'JP Nagar')
eq([m.slugInArea('/bangalore/meghana-foods-hsr-bangalore/order', 'HSR'), m.slugInArea('/bangalore/chshraddha-cafe/order', 'HSR'), m.slugInArea('/bangalore/empire-btm-bangalore', 'BTM Layout'), m.slugInArea('/x', null)], [true, false, true, false], 'a short area must be a whole path segment')
eq([outletInArea('https://www.zomato.com/bangalore/meghana-foods-hsr-bangalore/order', 'HSR'), outletInArea('https://www.zomato.com/bangalore/meghana-foods-residency-road/order', 'HSR'), outletInArea('https://www.swiggy.com/city/bangalore/meghana-foods-dr-rajkumar-road-rajajinagar-rest288893', 'Rajajinagar')], [true, false, true], 'outlet-in-area check agrees')

// 3. The said area is used before the home area and the map search.
const pc = readFileSync('lib/commerce/price-comparison.ts', 'utf8')
eq(/const saidArea = food\.area \|\| null\s+let area: string \| null = saidArea \|\| homeArea\s+let found = area \? await look\(area\) : null\s+if \(!found\?\.url \|\| !outletInArea\(found\.url, area\)\) \{\s*area = await nearestOutletArea/.test(pc), true, 'said area first, then home area, then nearest outlet')
console.log(`PASS verify-food-area-name-nov17: ${checks} checks`)
