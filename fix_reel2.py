with open('lib/services/reel-saver.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old1 = """  const contextParts = ["""
new1 = """  // No creator AND no caption -> skip GPT entirely, deterministic note
  if (!params.creator && !params.caption) {
    return 'Saved for later viewing. Open the link to watch.'
  }

  const contextParts = ["""

if old1 in content:
    content = content.replace(old1, new1, 1)
    print('Fix 1 applied')
else:
    print('Fix 1 NOT found')

old2 = """  return response.choices[0]?.message?.content?.trim() || params.caption || ''
}"""
new2 = """  const gptNote = response.choices[0]?.message?.content?.trim() || ''
  if (/please provide|provide the|creator name|need more|caption for/i.test(gptNote)) {
    return params.caption || 'Saved for later viewing.'
  }
  return gptNote || params.caption || ''
}"""

if old2 in content:
    content = content.replace(old2, new2, 1)
    print('Fix 2 applied')
else:
    print('Fix 2 NOT found')

with open('lib/services/reel-saver.ts', 'w', encoding='utf-8') as f:
    f.write(content)
