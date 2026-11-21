/**
 * Zomato MCP partner-locked catalogue-only pilot.
 * Source: https://github.com/Zomato/mcp-server-manifest
 * IMPORTANT: Zomato currently restricts third-party commercial integrations.
 * No external requests are made until all partner, OAuth-client and operator
 * approval gates are enabled, and a trusted owner-scoped broker supplies a token.
 * This class deliberately has NO tools/call, ordering, cart or payment method.
 */
export const ZOMATO_MCP_ENDPOINT = 'https://mcp-server.zomato.com/mcp' as const
export const ZOMATO_PUBLISHED_CAPABILITIES = [
  'restaurant_discovery', 'menu_browsing', 'cart_creation', 'food_ordering',
  'order_tracking', 'qr_payment',
] as const
export type ZomatoCapability = typeof ZOMATO_PUBLISHED_CAPABILITIES[number]
export type ZomatoMcpConnection = {ownerId: string; credential: string}
export type ZomatoMcpToolSummary = {name: string; description?: string; verification: 'unreviewed'}
export type ZomatoPilotErrorCode = 'partner_approval_required' | 'owner_mismatch'
  | 'connection_required' | 'reauth_required' | 'provider_unavailable' | 'invalid_response'
export class ZomatoMcpPilotError extends Error {
  readonly code: ZomatoPilotErrorCode
  constructor(code: ZomatoPilotErrorCode) {
    super(code)
    this.code = code
    this.name = 'ZomatoMcpPilotError'
  }
}

export function zomatoPilotStatus(env: Record<string, string | undefined> = process.env) {
  return env.ZOMATO_PARTNER_APPROVED === 'true' &&
    env.ZOMATO_OAUTH_CLIENT_APPROVED === 'true' &&
    env.ZOMATO_MCP_CATALOGUE_ENABLED === 'true'
    ? 'approved_catalogue_pilot' as const : 'awaiting_partner_approval' as const
}
export function assertZomatoCatalogueAccess(
  ownerId: string,
  connection: ZomatoMcpConnection | null,
  env: Record<string, string | undefined> = process.env,
): asserts connection is ZomatoMcpConnection {
  if (zomatoPilotStatus(env) !== 'approved_catalogue_pilot')
    throw new ZomatoMcpPilotError('partner_approval_required')
  if (!ownerId || !connection?.ownerId || connection.ownerId !== ownerId)
    throw new ZomatoMcpPilotError('owner_mismatch')
  if (!connection.credential || !/^[A-Za-z0-9._~+\/-]+={0,2}$/.test(connection.credential))
    throw new ZomatoMcpPilotError('connection_required')
}

const CLIENT_PROTOCOL = '2025-06-18'
const SUPPORTED_PROTOCOLS = new Set(['2025-03-26', '2025-06-18', '2025-11-25'])
const MAX_RESPONSE_BYTES = 256_000
async function parseRpcResponse(res: Response, id: number): Promise<any> {
  if (!res.body) throw new ZomatoMcpPilotError('invalid_response')
  const contentType = (res.headers.get('content-type') || '').toLowerCase()
  const isSse = contentType.includes('text/event-stream')
  if (!isSse && !contentType.includes('application/json'))
    throw new ZomatoMcpPilotError('invalid_response')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let body = '', bytes = 0
  try {
    for (;;) {
      const step = await reader.read()
      if (step.done) break
      bytes += step.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) throw new ZomatoMcpPilotError('invalid_response')
      body += decoder.decode(step.value, {stream: true})
    }
    body += decoder.decode()
    const records = isSse ? body.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/)
      .filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')).filter(Boolean) : [body]
    for (const record of records) {
      let obj: any
      try { obj = JSON.parse(record) } catch { continue }
      if (obj?.jsonrpc === '2.0' && obj.id === id) {
        if (obj.error || !Object.prototype.hasOwnProperty.call(obj, 'result'))
          throw new ZomatoMcpPilotError('invalid_response')
        return obj.result
      }
    }
    throw new ZomatoMcpPilotError('invalid_response')
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/** Metadata-only inspection, not an executable tool client. */
export class ZomatoMcpCataloguePilot {
  private protocol = CLIENT_PROTOCOL
  private sessionId: string | null = null
  private initialized = false
  private nextId = 1
  private readonly ownerId: string
  private readonly connection: ZomatoMcpConnection | null
  private readonly request: typeof fetch
  private readonly env: Record<string, string | undefined>
  constructor(
    ownerId: string,
    connection: ZomatoMcpConnection | null,
    request: typeof fetch = fetch,
    env: Record<string, string | undefined> = process.env,
  ) { this.ownerId = ownerId; this.connection = connection; this.request = request; this.env = env }
  private check() { assertZomatoCatalogueAccess(this.ownerId, this.connection, this.env) }
  private async rpc(method: 'initialize' | 'notifications/initialized' | 'tools/list',
    params: Record<string, unknown>, notification = false): Promise<any> {
    this.check()
    const id = this.nextId++
    let response: Response
    try {
      response = await this.request(ZOMATO_MCP_ENDPOINT, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: 'Bearer ' + this.connection!.credential,
          ...(this.sessionId ? {'Mcp-Session-Id': this.sessionId} : {}),
          ...(method === 'initialize' ? {} : {'MCP-Protocol-Version': this.protocol}),
        },
        body: JSON.stringify({jsonrpc: '2.0', ...(notification ? {} : {id}), method, params}),
      })
    } catch { throw new ZomatoMcpPilotError('provider_unavailable') }
    if (response.status === 401 || response.status === 419)
      throw new ZomatoMcpPilotError('reauth_required')
    if (!response.ok) throw new ZomatoMcpPilotError('provider_unavailable')
    if (notification) { await response.body?.cancel().catch(() => {}); return null }
    if (method === 'initialize') {
      const session = response.headers.get('mcp-session-id')
      if (session && !/^[\x21-\x7e]{1,256}$/.test(session))
        throw new ZomatoMcpPilotError('invalid_response')
      this.sessionId = session || null
    }
    return parseRpcResponse(response, id)
  }
  async listUnreviewedTools(): Promise<readonly ZomatoMcpToolSummary[]> {
    this.check()
    if (!this.initialized) {
      const init = await this.rpc('initialize', {
        protocolVersion: CLIENT_PROTOCOL, capabilities: {},
        clientInfo: {name: 'AskGogo Zomato catalogue pilot', version: '0.1.0'},
      })
      if (!SUPPORTED_PROTOCOLS.has(init?.protocolVersion))
        throw new ZomatoMcpPilotError('invalid_response')
      this.protocol = init.protocolVersion
      await this.rpc('notifications/initialized', {}, true)
      this.initialized = true
    }
    const result = await this.rpc('tools/list', {})
    if (!Array.isArray(result?.tools) || result.tools.length > 300 || result.nextCursor)
      throw new ZomatoMcpPilotError('invalid_response')
    return result.tools.map((t: any) => {
      if (!t || typeof t.name !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(t.name))
        throw new ZomatoMcpPilotError('invalid_response')
      return {name: t.name, ...(typeof t.description === 'string' ? {description: t.description.slice(0, 300)} : {}),
        verification: 'unreviewed' as const}
    })
  }
}
