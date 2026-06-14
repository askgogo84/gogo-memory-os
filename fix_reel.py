with open('lib/services/reel-saver.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old = '''  const contextParts = [
    params.creator ? \Creator: \\ : null,
    params.caption ? \Caption: "\"\ : null,
    \Platform: \\,
  ].filter(Boolean).join('\\n')'''

new = '''  // No creator AND no caption -> skip GPT entirely, deterministic note
  if (!params.creator && !params.caption) {
    return \\ saved for later viewing. Open the link to watch.\
  }

  const contextParts = [
    params.creator ? \Creator: \\ : null,
    params.caption ? \Caption: "\"\ : null,
    \Platform: \\,
  ].filter(Boolean).join('\\n')'''

if old in content:
    content = content.replace(old, new)
    print('Fix 1 applied: skip GPT when no context')
else:
    print('Fix 1 target not found')

old2 = '''  return response.choices[0]?.message?.content?.trim() || params.caption || \'\''''

new2 = '''  const gptNote = response.choices[0]?.message?.content?.trim() || ''
  // Reject GPT output that asks for more info
  if (/please provide|provide the|creator name|need more|caption for/i.test(gptNote)) {
    return params.caption || \\ by \ saved for later.\
  }
  return gptNote || params.caption || \'\''''

if old2 in content:
    content = content.replace(old2, new2)
    print('Fix 2 applied: reject please-provide GPT output')
else:
    print('Fix 2 target not found')

with open('lib/services/reel-saver.ts', 'w', encoding='utf-8') as f:
    f.write(content)
