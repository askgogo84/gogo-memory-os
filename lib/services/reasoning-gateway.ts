import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'

export type ReasoningProvider = 'anthropic' | 'openai'
export type ReasoningPurpose = 'freeform' | 'context_answer' | 'flight_status'

export type ReasoningMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ReasoningRequest = {
  purpose: ReasoningPurpose
  system?: string
  messages: ReasoningMessage[]
  maxTokens: number
  temperature?: number
}

export type ReasoningResult = {
  text: string
  provider: ReasoningProvider
  model: string
  fallbackUsed: boolean
}

type ProviderRunner = (request: ReasoningRequest) => Promise<{ text:string; model:string }>

function configuredPrimary(): ReasoningProvider {
  return String(process.env.ASKGOGO_REASONING_PRIMARY || 'anthropic').toLowerCase() === 'openai'
    ? 'openai'
    : 'anthropic'
}

function configuredFallback(primary: ReasoningProvider): ReasoningProvider {
  const raw = String(process.env.ASKGOGO_REASONING_FALLBACK || '').toLowerCase()
  if (raw === 'anthropic' || raw === 'openai') return raw
  return primary === 'anthropic' ? 'openai' : 'anthropic'
}

function safeProviderError(error:any) {
  return {
    name:String(error?.name || 'Error'),
    status:error?.status || null,
    type:error?.type || error?.error?.type || null,
    message:redactSecretShapedText(String(error?.message || error || '').slice(0,240)),
  }
}

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

const ANTHROPIC_MODEL = process.env.ASKGOGO_ANTHROPIC_REASONING_MODEL || 'claude-sonnet-4-5'
const OPENAI_MODEL = process.env.ASKGOGO_OPENAI_REASONING_MODEL || process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini'

async function runAnthropic(request: ReasoningRequest) {
  if (!anthropic) throw new Error('anthropic_reasoning_not_configured')
  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: request.maxTokens,
    temperature: request.temperature ?? 0.3,
    ...(request.system ? { system: request.system } : {}),
    messages: request.messages,
  })
  const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
  if (!text) throw new Error('anthropic_reasoning_empty')
  return { text, model: ANTHROPIC_MODEL }
}

async function runOpenAI(request: ReasoningRequest) {
  if (!openai) throw new Error('openai_reasoning_not_configured')
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    max_tokens: request.maxTokens,
    temperature: request.temperature ?? 0.3,
    messages: [
      ...(request.system ? [{ role:'system' as const, content:request.system }] : []),
      ...request.messages.map(message => ({ role:message.role, content:message.content })),
    ],
  })
  const text = response.choices?.[0]?.message?.content?.trim() || ''
  if (!text) throw new Error('openai_reasoning_empty')
  return { text, model: OPENAI_MODEL }
}

function runner(provider: ReasoningProvider): ProviderRunner {
  return provider === 'anthropic' ? runAnthropic : runOpenAI
}

/**
 * AskGogo owns routing, context, permissions, task state and learning.
 * Foundation-model providers are interchangeable reasoning executors only.
 * This gateway never stores task identity or memory in a provider session.
 */
export async function completeReasoning(request: ReasoningRequest): Promise<ReasoningResult> {
  return completeReasoningWithProviders(
    request,
    configuredPrimary(),
    configuredFallback(configuredPrimary()),
    { anthropic: runAnthropic, openai: runOpenAI },
  )
}

export async function completeReasoningWithProviders(
  request: ReasoningRequest,
  primary: ReasoningProvider,
  fallback: ReasoningProvider,
  providers: Record<ReasoningProvider, ProviderRunner>,
): Promise<ReasoningResult> {
  try {
    const result = await providers[primary](request)
    return { ...result, provider:primary, fallbackUsed:false }
  } catch (error:any) {
    console.error('ASKGOGO_REASONING_PRIMARY_FAILED:', {
      purpose:request.purpose,
      provider:primary,
      ...safeProviderError(error),
    })
  }

  if (fallback === primary) throw new Error('reasoning_fallback_same_as_primary')

  try {
    const result = await providers[fallback](request)
    return { ...result, provider:fallback, fallbackUsed:true }
  } catch (error:any) {
    console.error('ASKGOGO_REASONING_FALLBACK_FAILED:', {
      purpose:request.purpose,
      provider:fallback,
      ...safeProviderError(error),
    })
    throw new Error('reasoning_providers_unavailable')
  }
}
