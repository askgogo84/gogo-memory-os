// Same Brain 3.0 Phase 1: the semantic spine. Scope is enforced on every store call, corrections supersede rather than
// overwrite, a weak source never beats a strong one, time decides what is current, identities are not merged on a
// first name, secrets are refused, and "forget everything" retracts without deleting history.
import assert from 'node:assert/strict'
import { MemorySemanticStore } from '../lib/semantic/store'
import { SemanticRepo, scopeForActor, scopeForWorkspace, semanticEnabledFor } from '../lib/semantic/repo'
import { fromCalendarEvent, fromLifeEvent, fromMemory, fromOpenLoop, fromReminder, ingestBatch, SELF } from '../lib/semantic/ingest'
import { personKey, samePerson } from '../lib/semantic/resolve'
import { evidenceClassOf, temporalStatus } from '../lib/semantic/types'
let n = 0; const ok = (s: string) => { n++; console.log('PASS', s) }
const NOW = '2026-11-09T10:00:00.000Z'

{ // scope from actor only; a bad id throws; workspace needs a uuid
  assert.deepEqual(scopeForActor({ legacyTelegramId: -884501501 }), { scope_type: 'user', scope_id: '-884501501' })
  assert.throws(() => scopeForActor({ legacyTelegramId: 0 }))
  assert.throws(() => scopeForActor({ legacyTelegramId: Number.MAX_SAFE_INTEGER + 2 }))
  assert.throws(() => scopeForWorkspace('x; drop'))
  assert.equal(semanticEnabledFor('-884501501', {}), false); assert.equal(semanticEnabledFor('-884501501', { GOGO_SEMANTIC_OWNERS: '-884501501' }), true)
  ok('scope comes from the verified actor; flag off by default')
}

const store = new MemorySemanticStore()
const me = new SemanticRepo(store, scopeForActor({ legacyTelegramId: -884501501 }))
const other = new SemanticRepo(store, scopeForActor({ legacyTelegramId: 918310441698 }))

{ // supersession: meeting at 3 PM, then a verified source says 4 PM
  const ev = (start: string) => fromCalendarEvent({ id: 'evt1', title: 'Harbor partner meeting', startAt: start, endAt: start.replace('T09', 'T10').replace('T10:30', 'T11:30') })
  await ingestBatch(me, { calendarEvents: [{ id: 'evt1', title: 'Harbor partner meeting', startAt: '2026-11-12T09:30:00Z', endAt: '2026-11-12T10:30:00Z' }] }, NOW)
  const r = await me.assert(ev('2026-11-12T10:30:00Z').find(a => a.predicate === 'starts_at')!, NOW)
  assert.equal(r.changed, true); assert.ok(r.superseded); assert.equal(r.superseded!.assertion_status, 'superseded'); assert.equal(r.assertion.supersedes_assertion_id, r.superseded!.id)
  const facts = await me.factsFor({ entity_type: 'event', canonical_key: 'google:evt1' }, Date.parse(NOW), 'starts_at')
  assert.equal(facts.length, 1); assert.equal(facts[0].assertion.literal_value_json, '2026-11-12T10:30:00Z')
  assert.equal(store.assertions.filter(a => a.predicate === 'starts_at' && a.subject_entity_id === facts[0].subject.id).length, 2, 'history kept')
  // same value again is a no-op
  const again = await me.assert(ev('2026-11-12T10:30:00Z').find(a => a.predicate === 'starts_at')!, NOW)
  assert.equal(again.changed, false)
  ok('correction supersedes (3 PM → 4 PM), history traceable, recall sees only 4 PM, re-assert is a no-op')
}

{ // authority: an inference cannot replace the provider's time
  const weak = await me.assert({ subject: { entity_type: 'event', canonical_key: 'google:evt1' }, predicate: 'starts_at', literal: '2026-11-12T08:00:00Z', source: { source_type: 'open_loops', source_object_ref: 'guess-1', verification_status: 'inferred' }, confidence: 0.4 }, NOW)
  assert.equal(weak.conflict, true); assert.equal(weak.changed, false); assert.equal(weak.assertion.assertion_status, 'superseded'); assert.equal(weak.assertion.metadata_json.conflict, true)
  const facts = await me.factsFor({ entity_type: 'event', canonical_key: 'google:evt1' }, Date.parse(NOW), 'starts_at')
  assert.equal(facts[0].assertion.literal_value_json, '2026-11-12T10:30:00Z')
  ok('an inference never silently becomes the current fact; the attempt is recorded for review')
}

{ // temporal: last month's hotel is historical, not the current hotel
  await ingestBatch(me, { lifeEvents: [
    { id: 'le-old', subtype: 'hotel_stay', title: 'Four Seasons Mumbai', start_at: '2026-10-02T08:30:00Z', end_at: '2026-10-04T06:00:00Z', location: 'Mumbai', provider: 'Four Seasons' },
    { id: 'le-new', subtype: 'hotel_stay', title: 'Taj Candolim', start_at: '2026-12-12T08:30:00Z', end_at: '2026-12-15T06:00:00Z', location: 'Goa', provider: 'Taj' },
  ] }, NOW)
  const stays = await me.factsFor(SELF, Date.parse(NOW), 'has_booking')
  const byTitle = Object.fromEntries(stays.map(f => [f.object!.attributes!.title as string, f.temporal]))
  assert.equal(byTitle['Four Seasons Mumbai'], 'historical'); assert.equal(byTitle['Taj Candolim'], 'future')
  assert.equal(stays.find(f => f.object!.attributes!.title === 'Taj Candolim')!.source.verification_status, 'unverified', 'an emailed booking is unverified until provider read-back')
  assert.equal(temporalStatus({ valid_from: '2026-11-09T09:00:00Z', valid_until: '2026-11-09T11:00:00Z' }, Date.parse(NOW)), 'current')
  ok('time-aware: historical / current / future; emailed bookings stay unverified')
}

{ // identity: two Divyas stay apart; email ties
  assert.equal(personKey({ name: 'Divya' }), 'first:divya'); assert.equal(personKey({ name: 'Divya Shree' }), 'name:divya shree')
  assert.equal(samePerson(personKey({ name: 'Divya' }), personKey({ name: 'Divya' })), false, 'first-name-only never merges')
  assert.equal(samePerson(personKey({ name: 'D. Nair', email: 'Divya@Example.com' }), personKey({ email: 'divya@example.com' })), true)
  assert.equal(personKey({ phone: '88845 01501' }), 'phone:918884501501')
  ok('entity resolution: no merge on a first name; email/phone are strong keys')
}

{ // scope isolation: the other account sees nothing of mine, and cannot update my rows
  const mine = await me.factsFor(SELF, Date.parse(NOW)); assert.ok(mine.length > 0)
  const theirs = await other.factsFor(SELF, Date.parse(NOW)); assert.equal(theirs.length, 0)
  const myAssertion = store.assertions[0]
  await assert.rejects(store.updateAssertion(other.scope, myAssertion.id, { assertion_status: 'retracted' }), /not_in_scope/)
  ok('owner isolation: reads and writes are scoped; cross-owner update refused')
}

{ // secrets and shape
  await assert.rejects(me.assert({ subject: SELF, predicate: 'noted', literal: 'my card 4111111111111111', source: { source_type: 'memories', source_object_ref: 's1', verification_status: 'user_stated' }, confidence: 0.9 }), /unsafe/)
  await assert.rejects(me.assert({ subject: SELF, predicate: 'noted', source: { source_type: 'memories', source_object_ref: 's2', verification_status: 'user_stated' }, confidence: 0.9 } as any), /one_object/)
  ok('secret-shaped literals refused; exactly one object representation')
}

{ // mappers: statuses by origin, preferences, skipping internal rows
  assert.equal(fromMemory({ id: 1, content: 'I always prefer an aisle seat' })[0].source.verification_status, 'user_preference')
  assert.equal(fromMemory({ id: 2, content: 'Divya lives in Rajajinagar' })[0].source.verification_status, 'user_stated')
  assert.deepEqual(fromMemory({ id: 3, content: '{"type":"followup_state"}' }), [])
  assert.equal(fromReminder({ id: 9, message: 'call Divya', remind_at: '2026-11-10T03:30:00Z' })[0].valid_until, '2026-11-10T03:30:00Z')
  assert.equal(fromOpenLoop({ id: 'l1', title: 'Reply to Nithin', due_at: null })[0].source.verification_status, 'inferred')
  const fl = fromLifeEvent({ id: 'f1', subtype: 'flight', title: '6E 204 BLR→GOI', start_at: '2026-12-12T09:10:00Z', metadata_json: { flightNo: '6E204', to: 'Goa' }, provider: 'IndiGo' })
  assert.equal(fl[0].object!.entity_type, 'flight'); assert.equal(fl[0].object!.canonical_key, '6E204@2026-12-12'); assert.ok(fl.some(a => a.predicate === 'in_city' && a.object!.canonical_key === 'goa'))
  assert.deepEqual([evidenceClassOf('verified_provider'), evidenceClassOf('user_stated'), evidenceClassOf('inferred')], ['verified', 'reported', 'inferred'])
  ok('ingest mappers: status by origin, flights keyed by number+date, evidence classes')
}

{ // forget everything: nothing current, nothing deleted
  const before = store.assertions.length
  const r = await me.forgetEverything(NOW)
  assert.ok(r.assertions > 0 && r.entities > 0)
  assert.equal(store.assertions.length, before, 'rows kept')
  assert.equal((await me.factsFor(SELF, Date.parse(NOW))).length, 0)
  // the other owner is untouched
  await other.assert(fromReminder({ id: 77, message: 'water plants', remind_at: '2026-11-10T03:30:00Z' })[0], NOW)
  assert.equal((await other.factsFor(SELF, Date.parse(NOW))).length, 1)
  ok('forget everything retracts and retires without deleting; other owners untouched')
}
console.log(`verify-semantic-spine-nov9: ${n} passed`)
