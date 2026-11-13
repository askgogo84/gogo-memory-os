#!/usr/bin/env node
import readline from 'node:readline';
const answer = (id, data) => process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id, result: data }) + '\n');
const tool = v => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.id == null) continue;
  if (m.method === 'initialize') answer(m.id, { protocolVersion:'2025-06-18', capabilities:{ tools:{} }, serverInfo:{ name:'yogurt', version:'test' } });
  else if (m.method === 'tools/call' && m.params.name === 'list_meetings') answer(m.id, tool([
    { id:'meeting:one', title:'Sample', start:'2026-11-14T01:00:00.000Z', recording:false },
    { id:'meeting:live', title:'Still recording', recording:true }
  ]));
  else if (m.method === 'tools/call' && m.params.name === 'get_meeting') answer(m.id, tool({
    id:'meeting:one', title:'Sample Meeting', myNotes:'Private note', summary:'# Summary\nWe met.', people:['Alice']
  }));
  else if (m.method === 'tools/call' && m.params.name === 'get_transcript') answer(m.id, tool([
    { start_ms:0, end_ms:500, speaker:'Alice', text:'Hello' }
  ]));
  else answer(m.id, { isError:true, content:[{ type:'text', text:'Unexpected tool' }] });
}
