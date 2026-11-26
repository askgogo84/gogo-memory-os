#!/usr/bin/env node
// AskGogo Meetings local-only Yogurt MCP export. Never uploads or reads raw audio.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

export function options(argv) {
  const o = { helper: '', helperArgs: [], out: join(homedir(), 'AskGogoMeetings', 'local-export'), limit: 20, includeTranscript: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--include-transcript') { o.includeTranscript = true; continue; }
    if (!['--helper', '--helper-arg', '--out', '--limit'].includes(k)) throw new Error('Unknown option: ' + k);
    const v = argv[++i];
    if (!v || v.startsWith('--')) throw new Error('Missing value for ' + k);
    if (k === '--helper-arg') o.helperArgs.push(v);
    else if (k === '--limit') o.limit = Number(v);
    else o[k.slice(2)] = v;
  }
  if (!o.helper) throw new Error('Specify --helper from Yogurt Settings > AI apps');
  if (!Number.isInteger(o.limit) || o.limit < 1 || o.limit > 100) throw new Error('--limit must be an integer from 1 to 100');
  o.out = resolve(o.out);
  return o;
}

class Mcp {
  constructor(helper, args) {
    this.seq = 0; this.pending = new Map();
    this.child = spawn(helper, args, { shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    this.child.stderr.on('data', () => {}); // Never log meeting content or helper output
    const rejectAll = err => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
      this.pending.clear();
    };
    this.child.on('error', e => rejectAll(new Error('MCP helper launch failed: ' + e.message)));
    this.child.on('exit', code => rejectAll(new Error('MCP helper exited: ' + code)));
    readline.createInterface({ input: this.child.stdout }).on('line', line => {
      try {
        const r = JSON.parse(line), p = this.pending.get(r.id);
        if (!p) return;
        this.pending.delete(r.id); clearTimeout(p.timer);
        if (r.error) p.reject(new Error(r.error.message || 'MCP error'));
        else p.resolve(r.result);
      } catch { /* ignore non-RPC lines */ }
    });
  }
  request(method, params = {}) {
    const id = ++this.seq;
    if (!this.child.stdin.writable) return Promise.reject(new Error('MCP helper not running'));
    const reply = new Promise((resolveReply, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('MCP timeout: ' + method)); }, 30000);
      this.pending.set(id, { resolve: resolveReply, reject, timer });
    });
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return reply;
  }
  notify(method) {
    if (this.child.stdin.writable) this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: {} }) + '\n');
  }
  close() {
    this.child.stdin.end(); this.child.kill();
  }
}

function decoded(r) {
  if (r?.isError) throw new Error('Yogurt refused the read. Enable Settings > AI apps.');
  const s = (r?.content || []).filter(v => v.type === 'text').map(v => v.text).join('\n');
  try { return JSON.parse(s); } catch { return s; }
}
async function save(path, data) {
  const f = await open(path, 'w', 0o600);
  try { await f.writeFile(JSON.stringify(data, null, 2) + '\n', 'utf8'); await f.chmod(0o600).catch(() => {}); }
  finally { await f.close(); }
}
export async function runExport(o) {
  const c = new Mcp(o.helper, o.helperArgs);
  try {
    await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'askgogo-local-export', version: '0.1.0' } });
    c.notify('notifications/initialized');
    const list = decoded(await c.request('tools/call', { name: 'list_meetings', arguments: { limit: o.limit } }));
    if (!Array.isArray(list)) throw new Error('Unexpected list_meetings response');
    await mkdir(o.out, { recursive: true, mode: 0o700 });
    const manifest = [];
    for (const m of list) {
      if (!m || typeof m.id !== 'string' || !m.id || m.recording) continue;
      const n = decoded(await c.request('tools/call', { name: 'get_meeting', arguments: { id: m.id } }));
      if (!n || typeof n !== 'object' || Array.isArray(n)) continue;
      const transcript = o.includeTranscript
        ? decoded(await c.request('tools/call', { name: 'get_transcript', arguments: { id: m.id, format: 'lines' } }))
        : undefined;
      const record = { source: 'yogurt-local-mcp', sourceId: m.id, title: String(n.title || m.title || ''),
        start: n.start || m.start || null, end: n.end || m.end || null, attendees: n.people || [],
        app: n.app || m.app || null, personalNotes: n.myNotes ?? null, summary: n.summary ?? null,
        ...(o.includeTranscript ? { transcript } : {}) };
      const hash = createHash('sha256').update(m.id).digest('hex');
      const name = hash.slice(0, 24) + '.json';
      await save(join(o.out, name), record);
      manifest.push({ file: name, sourceIdHash: hash, start: record.start });
    }
    await save(join(o.out, 'manifest.json'), { schemaVersion: 1, exportMode: 'local-only',
      includesTranscript: o.includeTranscript, meetings: manifest });
    return { count: manifest.length, out: o.out };
  } finally { c.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runExport(options(process.argv.slice(2)));
    console.log('Exported ' + result.count + ' meeting(s) to ' + result.out + '. No cloud sync or audio export.');
  } catch (e) { console.error('Export failed: ' + e.message); process.exitCode = 1; }
}
