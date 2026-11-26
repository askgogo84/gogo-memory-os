import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { options, runExport } from '../bridge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const helper = process.execPath, helperArg = join(here, 'mock-mcp.mjs');

test('parser requires a specified helper and bounded limit', () => {
  assert.throws(() => options([]), /Specify --helper/);
  assert.throws(() => options(['--helper', helper, '--limit', '200']), /limit/);
});

test('private export defaults to summaries; skips in-progress meetings', async () => {
  const out = await mkdtemp(join(tmpdir(), 'askgogo-yogurt-'));
  const result = await runExport(options(['--helper', helper, '--helper-arg', helperArg, '--out', out]));
  assert.equal(result.count, 1);
  assert.equal((await readdir(out)).length, 2);
  const manifest = JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));
  assert.equal(manifest.exportMode, 'local-only');
  assert.equal(manifest.includesTranscript, false);
  const record = JSON.parse(await readFile(join(out,manifest.meetings[0].file),'utf8'));
  assert.equal(record.summary, '# Summary\nWe met.');
  assert.equal('transcript' in record, false);
  if (process.platform !== 'win32') assert.equal((await stat(join(out,manifest.meetings[0].file))).mode & 0o777, 0o600);
});

test('transcripts require explicit opt-in', async () => {
  const out = await mkdtemp(join(tmpdir(), 'askgogo-yogurt-'));
  await runExport(options(['--helper', helper, '--helper-arg', helperArg, '--out', out, '--include-transcript']));
  const manifest = JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));
  const record = JSON.parse(await readFile(join(out,manifest.meetings[0].file),'utf8'));
  assert.equal(record.transcript[0].text,'Hello');
});
