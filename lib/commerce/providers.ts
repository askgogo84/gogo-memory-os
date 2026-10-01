export type CommerceProvider = 'swiggy' | 'zepto'

// Official metadata read 1 Oct 2026. Never accept endpoint URLs from chat or a tool response.
export const COMMERCE_PROVIDERS = {
  swiggy: {
    label: 'Swiggy', issuer: 'https://mcp.swiggy.com/auth',
    authorize: 'https://mcp.swiggy.com/auth/authorize', token: 'https://mcp.swiggy.com/auth/token',
    register: 'https://mcp.swiggy.com/auth/register', revoke: 'https://mcp.swiggy.com/auth/logout',
    resource: 'https://mcp.swiggy.com', scope: 'mcp:tools', tokenFormat: 'json',
    servers: { food: 'https://mcp.swiggy.com/food', grocery: 'https://mcp.swiggy.com/im' },
  },
  zepto: {
    label: 'Zepto', issuer: 'https://auth.zepto.co.in',
    authorize: 'https://auth.zepto.co.in/authorize', token: 'https://auth.zepto.co.in/token',
    register: 'https://auth.zepto.co.in/register', revoke: 'https://auth.zepto.co.in/revoke',
    resource: 'https://mcp.zepto.co.in',
    scope: 'tools:read dev.ucp.shopping.cart:manage dev.ucp.shopping.catalog.search:read dev.ucp.shopping.catalog.lookup:read dev.ucp.common.location.search:read dev.ucp.common.location.lookup:read',
    tokenFormat: 'form', servers: { grocery: 'https://mcp.zepto.co.in/mcp' },
  },
} as const

export function commerceProvider(value: string): CommerceProvider | null {
  return value === 'swiggy' || value === 'zepto' ? value : null
}

export function commerceOrigin() {
  const url = new URL(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.askgogo.in')
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.username || url.password || (!local && url.protocol !== 'https:') || (local && !['http:', 'https:'].includes(url.protocol))) throw new Error('commerce_origin_invalid')
  return url.origin
}

export function commerceEnabled(provider: CommerceProvider) {
  // An operator enables this only after the provider approves the exact callback.
  // Merely deploying code must not imply that provider access was granted.
  return process.env[`COMMERCE_${provider.toUpperCase()}_ENABLED`] === 'true'
}

export function commerceCallback(provider: CommerceProvider) {
  return `${commerceOrigin()}/api/commerce/${provider}/callback`
}
