with open('lib/services/reel-saver.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old = """    return params.caption || \\ by \\ saved for later.  }"""
new = """    return params.caption || 'Saved for later viewing.'
  }"""

if old in content:
    content = content.replace(old, new)
    print('Mangled line fixed')
else:
    # Try finding it by unique part
    idx = content.find('saved for later.  }')
    if idx > -1:
        start = content.rfind('    return params.caption ||', 0, idx)
        content = content[:start] + "    return params.caption || 'Saved for later viewing.'\n  }" + content[idx+len('saved for later.  }'):]
        print('Mangled line fixed via index')
    else:
        print('NOT FOUND')

with open('lib/services/reel-saver.ts', 'w', encoding='utf-8') as f:
    f.write(content)
