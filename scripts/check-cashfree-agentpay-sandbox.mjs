import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const ENDPOINT = 'https://sandbox.cashfree.com/agentpay/mcp'
const MAX_RESPONSE_BYTES = 256 * 1024
const KEY_ENV = 'CASHFREE_AGENTPAY_SANDBOX_CLIENT_KEY'

function parseResponse(text, eventStream, id) {
  const events = eventStream
    ? text.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n')).filter(Boolean)
    : [text]
  const response = events.map(event => JSON.parse(event)).find(message => message?.id === id)
  if (response?.jsonrpc !== '2.0' || response.error || response.result?.isError) {
    throw new Error('Invalid AgentPay response')
  }

  const result = response.result
  const content = result?.content?.find?.(part => part?.type === 'text')?.text
  const categories = (result?.structuredContent ?? JSON.parse(content))?.biller_categories
  if (!Array.isArray(categories) || categories.length === 0 || categories.some(
    category => typeof category?.biller_category_name !== 'string' || !category.biller_category_name.trim(),
  )) {
    throw new Error('Invalid AgentPay catalogue')
  }
  return categories.length
}

async function readResponse(response, id) {
  if (!response.body) throw new Error('Missing AgentPay response')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const eventStream = response.headers.get('content-type')?.includes('text/event-stream')
  let text = ''
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return parseResponse(text + decoder.decode(), eventStream, id)
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) throw new Error('AgentPay response limit exceeded')
      text += decoder.decode(value, { stream: true })
      if (eventStream) {
        const complete = text.split(/\r?\n\r?\n/)
        text = complete.pop() ?? ''
        for (const event of complete) {
          const data = event.split(/\r?\n/).filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart()).join('\n')
          if (data && JSON.parse(data)?.id === id) return parseResponse(data, false, id)
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

export async function checkSandboxCatalogue(apiKey, request = fetch) {
  if (!apiKey?.trim()) throw new Error(`Missing ${KEY_ENV}`)
  const id = randomUUID()
  let response
  try {
    response = await request(ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: 'list_biller_categories', arguments: {} },
      }),
    })
  } catch {
    throw new Error('Could not reach Cashfree AgentPay sandbox')
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`Cashfree AgentPay sandbox returned HTTP ${response.status}`)
  }
  try {
    return await readResponse(response, id)
  } catch {
    throw new Error('Cashfree AgentPay sandbox returned an invalid catalogue')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const count = await checkSandboxCatalogue(process.env[KEY_ENV])
    console.log(`Cashfree AgentPay sandbox catalogue verified (${count} categories)`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
