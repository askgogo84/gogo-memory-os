import {randomUUID} from 'node:crypto'
import {COMMERCE_PROVIDERS, type CommerceProvider} from './providers'

export class CommerceMcpError extends Error {
  constructor(public reason: 'reauth_required' | 'provider_unavailable' | 'invalid_response' | 'tool_not_allowed') { super(reason) }
}

// This initial transport exposes discovery and documented read-only tools only.
// Cart writes require a separate durable approval/readback executor, not an LLM tool loop.
const READ_TOOLS: Record<CommerceProvider, Partial<Record<'food' | 'grocery', readonly string[]>>> = {
  swiggy: {
    food: ['get_addresses', 'search_restaurants', 'search_menu', 'get_restaurant_menu', 'get_food_cart'],
    grocery: ['get_addresses', 'search_products', 'get_cart'],
  },
  zepto: {}, // Populate only after the authenticated provider catalogue/schema is verified.
}
const PROTOCOL = '2025-06-18'

async function rpcResponse(response: Response, id: string): Promise<any> {
  if (!response.body) throw new CommerceMcpError('invalid_response')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const sse = response.headers.get('content-type')?.includes('text/event-stream')
  let buffer = '', size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 2_000_000) throw new CommerceMcpError('invalid_response')
      buffer += decoder.decode(chunk.value, {stream: true})
      if (!sse) continue
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() || ''
      for (const event of events) {
        const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (!data) continue
        const message = JSON.parse(data)
        if (message.id === id) return message
      }
    }
    if (!sse) {
      const message = JSON.parse(buffer + decoder.decode())
      if (message.id === id) return message
    }
    throw new CommerceMcpError('invalid_response')
  } catch {
    throw new CommerceMcpError('invalid_response')
  } finally { await reader.cancel().catch(() => {}) }
}

export class CommerceMcpClient {
  private sessionId: string | null = null
  private version = PROTOCOL
  private initialized = false
  private endpoint: string
  constructor(private provider: CommerceProvider, private server: 'food' | 'grocery', private accessToken: string, private request: typeof fetch = fetch) {
    this.endpoint = (COMMERCE_PROVIDERS[provider].servers as Partial<Record<'food' | 'grocery', string>>)[server] || ''
    if (!this.endpoint || !accessToken) throw new CommerceMcpError('provider_unavailable')
  }
  private async rpc(method: string, params: Record<string, unknown>, notification = false): Promise<any> {
    const id = randomUUID()
    let response: Response
    try {
      response = await this.request(this.endpoint, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25_000),
        headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${this.accessToken}`,
          ...(this.sessionId ? {'Mcp-Session-Id': this.sessionId} : {}), ...(method !== 'initialize' ? {'MCP-Protocol-Version': this.version} : {})},
        body: JSON.stringify({jsonrpc: '2.0', ...(notification ? {} : {id}), method, params})})
    } catch { throw new CommerceMcpError('provider_unavailable') }
    if (response.status === 401 || response.status === 419) throw new CommerceMcpError('reauth_required')
    if (!response.ok) throw new CommerceMcpError('provider_unavailable')
    if (notification) { await response.body?.cancel(); return null }
    if (method === 'initialize') this.sessionId = response.headers.get('mcp-session-id')
    const envelope = await rpcResponse(response, id)
    if (envelope.jsonrpc !== '2.0' || envelope.error || !('result' in envelope)) throw new CommerceMcpError('invalid_response')
    return envelope.result
  }
  async initialize() {
    if (this.initialized) return
    const result = await this.rpc('initialize', {protocolVersion: PROTOCOL, capabilities: {}, clientInfo: {name: 'AskGogo', version: '1.0.0'}})
    if (!['2024-11-05', '2025-03-26', PROTOCOL].includes(result.protocolVersion)) throw new CommerceMcpError('invalid_response')
    this.version = result.protocolVersion
    await this.rpc('notifications/initialized', {}, true)
    this.initialized = true
  }
  async listTools() {
    await this.initialize()
    const tools: any[] = []
    let cursor: string | undefined
    for (let page = 0; page < 5; page++) {
      const result = await this.rpc('tools/list', cursor ? {cursor} : {})
      if (!Array.isArray(result.tools)) throw new CommerceMcpError('invalid_response')
      tools.push(...result.tools)
      if (!result.nextCursor) return tools
      cursor = result.nextCursor
    }
    throw new CommerceMcpError('invalid_response')
  }
  async readTool(name: string, args: Record<string, unknown>) {
    if (!(READ_TOOLS[this.provider][this.server] || []).includes(name)) throw new CommerceMcpError('tool_not_allowed')
    await this.initialize()
    const result = await this.rpc('tools/call', {name, arguments: args})
    if (result.isError) throw new CommerceMcpError('provider_unavailable')
    let payload = result.structuredContent
    if (!payload) {
      const text = result.content?.find((part: any) => part.type === 'text')?.text
      try { payload = JSON.parse(text) } catch { throw new CommerceMcpError('invalid_response') }
    }
    if (!payload || payload.success !== true || !payload.data) throw new CommerceMcpError('invalid_response')
    return payload.data
  }
}
