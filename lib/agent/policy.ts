import type { AgentRiskLevel } from './types'

type PolicyDecision = {
  riskLevel: AgentRiskLevel
  confirmationRequired: boolean
  reason: string
}

const RED_PATTERNS = [
  /\b(?:pay|payment|purchase|buy|subscribe|upgrade plan|renew subscription)\b/i,
  /\b(?:send|email|message|forward)\b.*\b(?:to|externally|client|customer|contact)\b/i,
  /\b(?:share|expose)\b.*\b(?:password|passport|aadhaar|pan|bank|card|account|sensitive)\b/i,
  /\b(?:delete|erase|wipe)\b.*\b(?:memory|document|account|history|data)\b/i,
]

const AMBER_PATTERNS = [
  /\b(?:move|reschedule|cancel|delete|remove)\b.*\b(?:meeting|event|calendar)\b/i,
  /\b(?:cancel|stop|delete|remove)\b.*\b(?:reminder|series|task|list)\b/i,
  /\b(?:share|send|forward)\b/i,
  /\b(?:change|edit|update)\b.*\b(?:calendar|meeting|event)\b/i,
]

export function classifyAgentRisk(text: string): PolicyDecision {
  const input = String(text || '').trim()

  if (RED_PATTERNS.some((pattern) => pattern.test(input))) {
    return {
      riskLevel: 'red',
      confirmationRequired: true,
      reason: 'This action may send, delete, expose, purchase, or change something consequential.',
    }
  }

  if (AMBER_PATTERNS.some((pattern) => pattern.test(input))) {
    return {
      riskLevel: 'amber',
      confirmationRequired: true,
      reason: 'This action changes or shares existing information and should be reviewed before execution.',
    }
  }

  return {
    riskLevel: 'green',
    confirmationRequired: false,
    reason: 'This request is read-only or a low-risk reversible AskGogo action.',
  }
}

export function buildConfirmationText(riskLevel: AgentRiskLevel, text: string): string {
  const request = String(text || '').trim().replace(/\s+/g, ' ')
  const short = request.length > 180 ? `${request.slice(0, 177)}...` : request

  if (riskLevel === 'red') {
    return `I can prepare this, but I need your explicit confirmation before I do it: “${short}”`
  }

  return `I’m ready to do this. Please confirm before I make the change: “${short}”`
}
