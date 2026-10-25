import json,urllib.request,collections
from pathlib import Path
revision='2473bd8f135c10c3c0edc8af58f9aad742541575'
base=f'https://raw.githubusercontent.com/mwgg/Airports/{revision}/'
raw=json.load(urllib.request.urlopen(base+'airports.json',timeout=45))
iata=collections.defaultdict(set);cities=collections.defaultdict(set)
for row in raw.values():
 code=row.get('iata','');zone=row.get('tz','');city=row.get('city','').strip().lower()
 if len(code)!=3 or not code.isascii() or not code.isalpha() or not zone: continue
 iata[code.upper()].add(zone)
 if city: cities[city].add(zone)
result={'iata':{k:next(iter(v)) for k,v in sorted(iata.items()) if len(v)==1},'cities':{k:next(iter(v)) for k,v in sorted(cities.items()) if len(v)==1}}
Path('lib/data/airport-timezones.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
license=urllib.request.urlopen(base+'LICENSE',timeout=30).read().decode()
Path('lib/data/airport-timezones.LICENSE').write_text('Airport timezone data derived from https://github.com/mwgg/Airports\nRevision: '+revision+'\n\n'+license,encoding='utf-8')
print('IATA timezones:',len(result['iata']),'unambiguous cities:',len(result['cities']))
