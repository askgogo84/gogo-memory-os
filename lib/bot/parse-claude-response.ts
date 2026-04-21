export type ClaudeAction =
  | { type: 'none' }
  | { type: 'memory'; fact: string; replyText: string }
  | { type: 'reminder'; remindAt: string; message: string; pattern?: string; replyText: string }
  | { type: 'list_add'; listName: string; items: string[]; replyText: string }
  | { type: 'list_show'; listName: string; replyText: string }
  | { type: 'list_clear'; listName: string; replyText: string }
  | { type: 'list_check'; listName: string; itemText: string; replyText: string }
  | { type: 'list_all'; replyText: string }
  | { type: 'search'; query: string; replyText: string }

function cleanReply(lines: string[]) {
  return lines.join('\n').trim()
}

export function parseClaudeResponse(raw: string): ClaudeAction {
  const text = (raw || '').trim()
  if (!text) return { type: 'none' }

  const lines = text.split('\n')
  const first = lines[0]?.trim() || ''
  const rest = cleanReply(lines.slice(1))

  if (first.startsWith('MEMORY:')) {
    return {
      type: 'memory',
      fact: first.replace('MEMORY:', '').trim(),
      replyText: rest,
    }
  }

  if (first.startsWith('REMINDER:')) {
    const payload = first.replace('REMINDER:', '').trim()
    const parts = payload.split('|').map(p => p.trim())

    return {
      type: 'reminder',
      remindAt: parts[0] || '',
      message: parts[1] || 'Reminder',
      pattern: parts[2] || undefined,
      replyText: rest,
    }
  }

  if (first.startsWith('LIST_ADD:')) {
    const payload = first.replace('LIST_ADD:', '').trim()
    const parts = payload.split('|').map(p => p.trim())
    return {
      type: 'list_add',
      listName: parts[0] || 'list',
      items: (parts[1] || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
      replyText: rest,
    }
  }

  if (first.startsWith('LIST_SHOW:')) {
    return {
      type: 'list_show',
      listName: first.replace('LIST_SHOW:', '').trim(),
      replyText: rest,
    }
  }

  if (first.startsWith('LIST_CLEAR:')) {
    return {
      type: 'list_clear',
      listName: first.replace('LIST_CLEAR:', '').trim(),
      replyText: rest,
    }
  }

  if (first.startsWith('LIST_CHECK:')) {
    const payload = first.replace('LIST_CHECK:', '').trim()
    const parts = payload.split('|').map(p => p.trim())
    return {
      type: 'list_check',
      listName: parts[0] || 'list',
      itemText: parts[1] || '',
      replyText: rest,
    }
  }

  if (first.startsWith('LIST_ALL')) {
    return {
      type: 'list_all',
      replyText: rest,
    }
  }

  if (first.startsWith('SEARCH:')) {
    return {
      type: 'search',
      query: first.replace('SEARCH:', '').trim(),
      replyText: rest,
    }
  }

  return { type: 'none' }
}

