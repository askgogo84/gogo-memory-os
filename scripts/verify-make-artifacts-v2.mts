// Make v2 (Duet parity): saved results are editable, versioned and refreshable; Gogo regeneration keeps owner edits.
// Pure helper tests + source assertions for owner scoping, validation and the version cap. No network.
// Run: npx --yes tsx scripts/verify-make-artifacts-v2.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
process.env.OPENAI_API_KEY ||= 'test-key'
process.env.ANTHROPIC_API_KEY ||= 'test-key'
const originalFetch = globalThis.fetch
globalThis.fetch = (async () => { throw new Error('no network in tests') }) as any

try {
  const v = await import('../lib/agent/artifact-versions')
  const RUN = '11111111-2222-3333-4444-555555555555'
  const prevRow = {
    title: 'Co-working near Rajajinagar', updated_at: '2026-10-22T05:00:00.000Z',
    content_json: { runId: RUN, sections: [
      { title: 'Research report', tool: 'artifact', result: { text: 'Gogo synthesis v1', synthesisStatus: 'generated', sourceUrls: ['https://a.example/x'] } },
      { title: 'Search', tool: 'web_search', result: { reply: 'Excerpts v1', sourceUrls: ['https://b.example/y', 'https://a.example/x'] } },
    ] },
  }

  // 1. Validation is strict: unknown keys, wrong types, over-long values and empty edits are rejected.
  assert.equal(v.parseArtifactEdit(null).ok, false)
  assert.deepEqual(v.parseArtifactEdit({ hack: 1 }), { ok: false, error: 'unknown_field' })
  assert.deepEqual(v.parseArtifactEdit({ title: '' }), { ok: false, error: 'invalid_title' })
  assert.deepEqual(v.parseArtifactEdit({ title: 'x'.repeat(181) }), { ok: false, error: 'invalid_title' })
  assert.deepEqual(v.parseArtifactEdit({ title: 5 }), { ok: false, error: 'invalid_title' })
  assert.deepEqual(v.parseArtifactEdit({ notes: 'x'.repeat(4001) }), { ok: false, error: 'invalid_notes' })
  assert.deepEqual(v.parseArtifactEdit({ sections: [{ title: 'A', text: 'x'.repeat(20001) }] }), { ok: false, error: 'invalid_sections' })
  assert.deepEqual(v.parseArtifactEdit({ sections: [{ title: 'A', text: 'x', extra: 1 }] }), { ok: false, error: 'invalid_sections' })
  assert.deepEqual(v.parseArtifactEdit({ sections: [{ title: 'A', text: 'x' }, { title: 'A', text: 'y' }] }), { ok: false, error: 'invalid_sections' }, 'duplicate section titles')
  assert.deepEqual(v.parseArtifactEdit({ sections: Array.from({ length: 11 }, (_, i) => ({ title: 'S' + i, text: 't' })) }), { ok: false, error: 'invalid_sections' })
  assert.deepEqual(v.parseArtifactEdit({}), { ok: false, error: 'nothing_to_change' })
  const good = v.parseArtifactEdit({ title: '  Desks   near me ', notes: 'Call them\r\nMonday', sections: [{ title: 'Search', text: 'My own summary' }] })
  assert.ok(good.ok)
  assert.deepEqual((good as any).edit, { title: 'Desks near me', notes: 'Call them\nMonday', sections: [{ title: 'Search', text: 'My own summary' }] })

  // 2. Owner edit: previous version pushed, edited section recorded, text replaced, editedBy owner.
  const applied: any = v.applyOwnerEdit(prevRow, (good as any).edit, 'user-1', '2026-10-23T06:00:00.000Z')
  assert.ok(applied.ok)
  assert.equal(applied.title, 'Desks near me')
  assert.deepEqual(applied.changedSections, ['Search'])
  const c = applied.content_json
  assert.deepEqual(c.userEdits, ['Search'])
  assert.equal(c.editedBy, 'owner'); assert.equal(c.editedAt, '2026-10-23T06:00:00.000Z'); assert.equal(c.notes, 'Call them\nMonday')
  assert.equal(c.sections[1].result.text, 'My own summary'); assert.equal(c.sections[1].result.reply, undefined); assert.equal(c.sections[1].editedBy, 'owner')
  assert.deepEqual(c.sections[1].result.sourceUrls, prevRow.content_json.sections[1].result.sourceUrls, 'sources survive an edit')
  assert.equal(c.versions.length, 1)
  assert.deepEqual(c.versions[0], { title: prevRow.title, content_json: prevRow.content_json, updated_at: prevRow.updated_at, by: 'gogo' })
  assert.equal((prevRow.content_json.sections[1].result as any).reply, 'Excerpts v1', 'the previous row is not mutated')
  assert.deepEqual(v.applyOwnerEdit(prevRow, { sections: [{ title: 'Nope', text: 'x' }] }, 'u'), { ok: false, error: 'unknown_section' })
  assert.deepEqual(v.applyOwnerEdit(prevRow, { sections: [{ title: 'Search', text: 'Excerpts v1' }] }, 'u'), { ok: false, error: 'nothing_to_change' })

  // 3. Version cap: last 10 kept, newest last; snapshots never nest history.
  let row: any = prevRow
  for (let i = 0; i < 14; i++) {
    const r: any = v.applyOwnerEdit(row, { notes: 'n' + i }, 'u', `2026-10-23T07:${String(i).padStart(2, '0')}:00.000Z`)
    assert.ok(r.ok)
    row = { title: r.title, content_json: r.content_json, updated_at: r.content_json.editedAt }
  }
  assert.equal(row.content_json.versions.length, v.MAX_VERSIONS)
  assert.equal(v.MAX_VERSIONS, 10)
  assert.ok(row.content_json.versions.every((x: any) => !('versions' in x.content_json)), 'no nested history')
  assert.equal(row.content_json.versions.at(-1).content_json.notes, 'n12')
  assert.equal(row.content_json.versions.at(-1).by, 'owner')
  const summaries = v.versionSummaries(row.content_json)
  assert.equal(summaries.length, 10); assert.equal(summaries[0].at, '2026-10-23T07:12:00.000Z', 'newest first for the page')

  // 4. Regeneration keeps owner sections (even if missing from the new run) and notes; pushes history; regeneratedAt.
  const edited = { title: applied.title, content_json: applied.content_json, updated_at: '2026-10-23T06:00:00.000Z' }
  const nextContent = { runId: 'new-run', sections: [
    { title: 'Research report', tool: 'artifact', result: { text: 'Gogo synthesis v2' } },
    { title: 'Search', tool: 'web_search', result: { reply: 'Excerpts v2' } },
  ] }
  const merged: any = v.mergeRegenerated(edited, nextContent, '2026-10-24T01:00:00.000Z')
  assert.equal(merged.runId, 'new-run')
  assert.equal(merged.sections[0].result.text, 'Gogo synthesis v2', 'unedited sections take the new run')
  assert.equal(merged.sections[1].result.text, 'My own summary', 'owner text wins')
  assert.equal(merged.notes, 'Call them\nMonday'); assert.deepEqual(merged.userEdits, ['Search'])
  assert.equal(merged.regeneratedAt, '2026-10-24T01:00:00.000Z'); assert.equal(merged.lastWriter, 'gogo')
  assert.equal(merged.versions.length, 2); assert.equal(merged.versions.at(-1).by, 'owner')
  const dropped: any = v.mergeRegenerated(edited, { runId: 'r', sections: [{ title: 'Research report', tool: 'artifact', result: { text: 'v3' } }] })
  assert.deepEqual(dropped.sections.map((s: any) => s.title), ['Research report', 'Search'], 'an owner-edited section the new run lacks is kept')
  const fresh: any = v.mergeRegenerated(prevRow, nextContent)
  assert.equal(fresh.sections[1].result.reply, 'Excerpts v2'); assert.equal(fresh.notes, undefined); assert.equal(fresh.userEdits, undefined)

  // 5. Refresh rules: only a finished, read-only general plan; plain reasons otherwise.
  const plan = { title: 'p', reason: 'r', steps: [{ tool: 'web_search', title: 's', instruction: 'Search desks' }, { tool: 'artifact', title: 'a', instruction: 'Save' }] }
  const okRun = { id: RUN, status: 'completed', metadata_json: { plan_type: 'general_multi_tool', input_text: 'Find co-working near Rajajinagar', plan } }
  const art = { source_refs: [{ type: 'agent_run', id: RUN }], content_json: {} }
  assert.deepEqual(v.refreshCheck(art, okRun), { ok: true, runId: RUN, missionText: 'Find co-working near Rajajinagar' })
  const reason = (r: any) => (r.ok ? '' : r.reason)
  assert.match(reason(v.refreshCheck({ source_refs: [{ type: 'google_drive_file', id: 'x' }] }, null)), /not made by a Gogo run/)
  assert.match(reason(v.refreshCheck(art, null)), /no longer available/)
  assert.match(reason(v.refreshCheck(art, { ...okRun, status: 'running' })), /still working/)
  assert.match(reason(v.refreshCheck(art, { ...okRun, metadata_json: { ...okRun.metadata_json, plan_type: 'meeting' } })), /Only research/)
  assert.match(reason(v.refreshCheck(art, { ...okRun, metadata_json: { ...okRun.metadata_json, input_text: '' } })), /original request was not saved/)
  for (const step of [{ tool: 'reminders', instruction: 'Remind me' }, { tool: 'calendar', instruction: 'Read my calendar' }, { tool: 'tasks', instruction: 'Create a task: call' }, { tool: 'email', instruction: 'Send' }])
    assert.match(reason(v.refreshCheck(art, { ...okRun, metadata_json: { ...okRun.metadata_json, plan: { steps: [...plan.steps, step] } } })), /change things/, step.tool)
  assert.equal(v.planRefreshBlock({ steps: [...plan.steps, { tool: 'tasks', instruction: 'List my open tasks' }] }), null, 'reading tasks is fine')
  assert.match(String(v.planRefreshBlock({ steps: [plan.steps[0]] })), /would not save a result/)
  assert.match(reason(v.refreshCheck({ ...art, content_json: { refreshRequestedAt: new Date(Date.now() - 30_000).toISOString() } }, okRun)), /just started/)
  assert.deepEqual(v.artifactSourceUrls(prevRow.content_json), ['https://a.example/x', 'https://b.example/y'])

  // 6. Source assertions: owner scoping, origin check, validation, activity row, writer integration, UI.
  const route = readFileSync('app/api/agent/artifacts/[id]/route.ts', 'utf8')
  const patch = route.slice(route.indexOf('export async function PATCH'))
  assert.ok(patch.indexOf('requireAgentMutationOrigin(request)') < patch.indexOf('requireAgentSession(request)'), 'origin before session')
  assert.equal((patch.match(/from\('agent_artifacts'\)/g) || []).length, 2)
  assert.equal((patch.match(/\.eq\('telegram_id',session\.telegramId\)/g) || []).length, 2, 'every artifact query is owner-scoped')
  assert.match(patch, /parseArtifactEdit\(body\)/); assert.match(patch, /MAX_BODY_CHARS/)
  assert.match(patch, /\.eq\('updated_at',row\.updated_at\)/, 'stale writes are refused, never overwrite')
  assert.match(patch, /event_type:'artifact_edited'/)
  const refresh = readFileSync('app/api/agent/artifacts/[id]/refresh/route.ts', 'utf8')
  assert.ok(refresh.indexOf('requireAgentMutationOrigin(request)') < refresh.indexOf('requireAgentSession(request)'))
  assert.equal((refresh.match(/from\('agent_(?:artifacts|runs)'\)/g) || []).length, (refresh.match(/\.eq\('telegram_id', session\.telegramId\)/g) || []).length, 'every query is owner-scoped')
  assert.match(refresh, /prepareGeneralPlanForActor\(actor, check\.missionText\)/)
  assert.match(refresh, /tryRunGeneralPlan\(\{ actor, surface: session\.surface, text: check\.missionText, prepared \}\)/, 'same entry point the chat uses')
  assert.match(refresh, /planRefreshBlock\(prepared\.plan\)/, 'the re-plan is checked again')
  assert.match(refresh, /status: 409/)
  assert.doesNotMatch(refresh, /sendWhatsApp|sendAskGogoEmail|executePlanFromOrdinal/)
  const planner = readFileSync('lib/agent/general-planner.ts', 'utf8')
  assert.match(planner, /const merged=mergeRegenerated\(existing,content_json,now\)/)
  assert.match(planner, /content_json:merged, source_refs, updated_at:now/)
  assert.match(planner, /select\('id,title,content_json,updated_at'\)\.eq\('telegram_id',String\(tg\)\)/)
  const page = readFileSync('app/dashboard/(app)/reports/[id]/page.tsx', 'utf8')
  assert.match(page, /\.eq\('id',id\)\.eq\('telegram_id',telegramId\)/); assert.match(page, /\.eq\('id',runRef\)\.eq\('telegram_id',telegramId\)/)
  const editor = readFileSync('components/dashboard/report-editor.tsx', 'utf8')
  for (const s of ['Edited by you', 'Refresh from sources', 'Earlier versions (', "'Save'", '>Cancel<', '>Edit<', 'Sources', 'min-h-11', "method: 'PATCH'"]) assert.ok(editor.includes(s), s)
  assert.match(editor, /disabled=\{Boolean\(busy\) \|\| !refresh\.ok\}/, 'refresh disabled with a reason when not refreshable')

  // 7. Kinds registered with honest labels.
  const make = await import('../lib/dashboard/make')
  assert.equal(make.typeLabel('daily_brief'), 'Daily brief'); assert.equal(make.typeLabel('decision_summary'), 'Decision summary')
  assert.ok((make.MAKE_KINDS.find(k => k.key === 'briefs')!.types as readonly string[]).includes('daily_brief'))
  console.log('Make v2: strict owner edits, 10-version history, owner text survives regeneration, read-only refresh via the chat planner, kinds registered')
} finally { globalThis.fetch = originalFetch }
