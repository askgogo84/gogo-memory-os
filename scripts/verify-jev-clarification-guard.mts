import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { jevClarificationReply } from '../lib/agent/jev-router'

const base:any={
  ok:true,contextual:true,
  decisionReadiness:{choice:'clarify',confidence:0.96,probabilities:{clarify:0.96,ready:0.04}},
  referentKind:{choice:'calendar_event',confidence:0.91,probabilities:{calendar_event:0.91}},
}
assert.match(jevClarificationReply(base)||'',/meeting or calendar event/)
assert.equal(jevClarificationReply({...base,contextual:false}),null)
assert.equal(jevClarificationReply({...base,decisionReadiness:{choice:'ready',confidence:0.98,probabilities:{ready:0.98}}}),null)
assert.equal(jevClarificationReply({...base,decisionReadiness:{choice:'clarify',confidence:0.71,probabilities:{clarify:0.71}}}),null)
assert.match(jevClarificationReply({...base,referentKind:{choice:'watcher',confidence:0.9,probabilities:{watcher:0.9}}})||'',/monitor or watcher/)
assert.match(jevClarificationReply({...base,referentKind:{choice:'travel_option',confidence:0.9,probabilities:{travel_option:0.9}}})||'',/travel option/)

const wa=readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts',import.meta.url),'utf8')
const guardPos=wa.indexOf('const jevClarify=jevClarificationReply')
const promotePos=wa.indexOf('const jevIntent=promotedJevIntent')
const legacyPos=wa.indexOf('const featureReply = await routeFeatureIntent')
assert.ok(guardPos>=0&&promotePos>guardPos,'clarification guard must run before Jev promotion')
assert.ok(legacyPos>guardPos,'clarification guard must run before broad feature fallback')
assert.match(wa,/actualHandler:'jev-clarification-guard'/)

console.log('Jev clarification guard fail-closed routing passed')
