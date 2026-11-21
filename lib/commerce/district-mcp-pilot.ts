/**
 * District MCP guarded pilot. No production District integration is enabled.
 * Official reference: https://studio.district.in/mcp/
 * District requires partner permission to embed this connector inside a product.
 */
export const DISTRICT_MCP_ENDPOINT = 'https://mcp-server.district.in/v2/mcp' as const
export const DISTRICT_INTEGRATION_CONTACT = 'developers@district.in' as const
export type DistrictArea = 'movies' | 'dining' | 'events' | 'sports' | 'salons' | 'bookings'
export const DISTRICT_AREAS: readonly DistrictArea[] = ['movies', 'dining', 'events', 'sports', 'salons', 'bookings']
export type DistrictAction = 'search' | 'execute' | 'act' | 'pay' | 'cancel_payment'
export type DistrictRisk = 'read' | 'contextual_read' | 'consequential' | 'payment'
export const DISTRICT_ACTION_RISK: Readonly<Record<DistrictAction, DistrictRisk>> = {
  search: 'read', execute: 'contextual_read', act: 'consequential',
  pay: 'payment', cancel_payment: 'consequential',
}
export const DISTRICT_PUBLIC_CAPABILITIES = [
  {area: 'movies', capabilities: ['showtimes', 'cinema_details', 'movie_ticket_booking', 'ticket_offers']},
  {area: 'dining', capabilities: ['restaurant_discovery', 'table_booking', 'bill_payment', 'manage_reservations']},
  {area: 'events', capabilities: ['event_discovery', 'dates_and_tickets', 'event_booking']},
  {area: 'sports', capabilities: ['venue_discovery', 'available_courts', 'court_booking', 'cancel_court_booking']},
  {area: 'salons', capabilities: ['services_and_prices', 'appointment_slots', 'appointment_booking', 'bill_payment']},
  {area: 'bookings', capabilities: ['existing_bookings', 'tickets_and_refunds', 'lists_and_reminders']},
] as const

// All values below must come from a TRUSTED server-side owner-scoped credential broker.
export type DistrictConnection = {ownerId: string; credential: string}
export type DistrictMcpTool = {name: string; description?: string; inputSchema?: unknown}
export type DistrictPilotErrorCode = 'partner_approval_required' | 'owner_mismatch'
  | 'connection_required' | 'reauth_required' | 'provider_unavailable'
  | 'invalid_response' | 'tool_not_allowed'
export class DistrictMcpPilotError extends Error {
  readonly code: DistrictPilotErrorCode
  constructor(code: DistrictPilotErrorCode) {
    super(code); this.code = code; this.name = 'DistrictMcpPilotError'
  }
}
export function districtPilotStatus(env: Record<string, string | undefined> = process.env) {
  return env.DISTRICT_PARTNER_APPROVED === 'true' && env.DISTRICT_MCP_READ_ENABLED === 'true'
    ? 'partner_read_pilot_enabled' as const : 'awaiting_partner_approval' as const
}
export function assertDistrictReadAccess(
  userId: string, connection: DistrictConnection | null,
  env: Record<string, string | undefined> = process.env,
): asserts connection is DistrictConnection {
  if (districtPilotStatus(env) !== 'partner_read_pilot_enabled')
    throw new DistrictMcpPilotError('partner_approval_required')
  if (!userId || !connection?.ownerId || connection.ownerId !== userId)
    throw new DistrictMcpPilotError('owner_mismatch')
  if (!connection.credential || !/^[A-Za-z0-9._~+\/-]+={0,2}$/.test(connection.credential))
    throw new DistrictMcpPilotError('connection_required')
}

const CLIENT_PROTOCOL = '2025-06-18'
const SUPPORTED_PROTOCOLS = new Set(['2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'])
const MAX_RESPONSE_BYTES = 512_000
async function readBoundedResponse(res: Response, id: number): Promise<any> {
  if (!res.body) throw new DistrictMcpPilotError('invalid_response')
  const reader = res.body.getReader(), decoder = new TextDecoder()
  let text = '', bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) throw new DistrictMcpPilotError('invalid_response')
      text += decoder.decode(next.value, {stream: true})
    }
    text += decoder.decode()
    const isSse = res.headers.get('content-type')?.includes('text/event-stream')
    const payloads = isSse
      ? text.split(/\r?\n\r?\n/).map(e => e.split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart()).join('\n')).filter(Boolean)
      : [text]
    for (const payload of payloads) {
      let parsed: any
      try { parsed = JSON.parse(payload) } catch { continue }
      if (parsed?.jsonrpc === '2.0' && parsed.id === id) return parsed
    }
    throw new DistrictMcpPilotError('invalid_response')
  } finally { await reader.cancel().catch(() => {}) }
}

/**
 * Read-only, owner-bound, partner-locked discovery.
 * No execute, act, pay or cancel_payment method is exposed.
 * No generic model-controlled tools/call passthrough is provided.
 */
export class DistrictMcpReadPilot {
  private protocol = CLIENT_PROTOCOL
  private sessionId: string | null = null
  private initialized = false
  private nextId = 1
  private tools: DistrictMcpTool[] | null = null
  private readonly ownerId: string
  private readonly connection: DistrictConnection | null
  private readonly request: typeof fetch
  private readonly env: Record<string, string | undefined>
  constructor(
    ownerId: string, connection: DistrictConnection | null,
    request: typeof fetch = fetch,
    env: Record<string, string | undefined> = process.env,
  ) {
    this.ownerId = ownerId; this.connection = connection
    this.request = request; this.env = env
  }
  private access() { assertDistrictReadAccess(this.ownerId, this.connection, this.env) }
  private async rpc(method: string, params: Record<string, unknown>, notification = false): Promise<any> {
    this.access()
    const id = this.nextId++
    let response: Response
    try {
      response = await this.request(DISTRICT_MCP_ENDPOINT, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
          Authorization: 'Bearer ' + this.connection!.credential,
          ...(this.sessionId ? {'Mcp-Session-Id': this.sessionId} : {}),
          ...(method !== 'initialize' ? {'MCP-Protocol-Version': this.protocol} : {}),
        },
        body: JSON.stringify({jsonrpc: '2.0', ...(notification ? {} : {id}), method, params}),
      })
    } catch { throw new DistrictMcpPilotError('provider_unavailable') }
    if (response.status === 401 || response.status === 419)
      throw new DistrictMcpPilotError('reauth_required')
    if (!response.ok) throw new DistrictMcpPilotError('provider_unavailable')
    if (notification) { await response.body?.cancel().catch(() => {}); return null }
    if (method === 'initialize') {
      const sid = response.headers.get('mcp-session-id')
      if (sid && /^[\x21-\x7e]{1,256}$/.test(sid)) this.sessionId = sid
    }
    const body = await readBoundedResponse(response, id)
    if (body.error || !Object.prototype.hasOwnProperty.call(body, 'result'))
      throw new DistrictMcpPilotError('invalid_response')
    return body.result
  }
  async initialize() {
    this.access()
    if (this.initialized) return
    const result = await this.rpc('initialize', {
      protocolVersion: CLIENT_PROTOCOL, capabilities: {},
      clientInfo: {name: 'AskGogo District read pilot', version: '0.1.0'},
    })
    if (!SUPPORTED_PROTOCOLS.has(result?.protocolVersion))
      throw new DistrictMcpPilotError('invalid_response')
    this.protocol = result.protocolVersion
    await this.rpc('notifications/initialized', {}, true)
    this.initialized = true
  }
  async listSafeTools(): Promise<DistrictMcpTool[]> {
    await this.initialize()
    if (this.tools) return this.tools
    const result = await this.rpc('tools/list', {})
    if (!Array.isArray(result?.tools) || result.nextCursor)
      throw new DistrictMcpPilotError('invalid_response')
    // Deliberately omit execute, act, pay and cancel_payment.
    this.tools = result.tools
      .filter((tool: any) => tool && tool.name === 'search' && tool.inputSchema?.type === 'object')
      .map((tool: any) => ({
        name: 'search',
        description: typeof tool.description === 'string' ? tool.description.slice(0, 500) : undefined,
        inputSchema: tool.inputSchema,
      })).slice(0, 1)
    return this.tools
  }
  async search(query: string): Promise<unknown> {
    this.access()
    if (typeof query !== 'string' || query.trim().length < 3 || query.trim().length > 500)
      throw new DistrictMcpPilotError('invalid_response')
    const tool = (await this.listSafeTools())[0]
    const schema = tool?.inputSchema as {properties?: Record<string, any>; required?: string[]} | undefined
    if (!schema || schema.properties?.query?.type !== 'string' ||
      !Array.isArray(schema.required || []) ||
      (schema.required || []).some(key => key !== 'query'))
      throw new DistrictMcpPilotError('tool_not_allowed')
    const result = await this.rpc('tools/call', {name: 'search', arguments: {query: query.trim()}})
    if (!result || result.isError === true)
      throw new DistrictMcpPilotError('provider_unavailable')
    // External result is untrusted discovery information, not verified booking/payment evidence.
    return result.structuredContent ?? result.content ?? result
  }
}