import { supabaseAdmin } from '@/lib/supabase-admin'
import { searchWorkspaceDrive, readWorkspaceDriveText } from './google-workspace-read'
import { evaluateAgentExecutionPolicy, type AgentPermissionLevel } from './policy'
import type { GeneralPlanStep } from './general-planner'
import type { AutonomousToolContext, AutonomousToolResult } from './autonomous-runtime'

const MAX_TEXT = 3500
const MUTATION = /\b(?:create|write|save|upload|delete|remove|share|send|email|book|pay|purchase|submit|grant|publish|move|rename|update|edit|append|copy)\b/i
const normalize = (value: string) => String(value || '').replace(/\s+/g, ' ').trim()
const blocked = (reason: string): AutonomousToolResult => ({status:'blocked', error:`persistent_drive_${reason}`})

export function persistentDriveFailureReply(error: unknown): string | null {
  const reason = String(error || '').replace(/^persistent_drive_/, '')
  const replies: Record<string,string> = {
    connection_required:'Connect or refresh Google Drive, then try this file request again.',
    scope_required:'Google Drive did not grant read access to this file. Check its permissions or reconnect Google.',
    ambiguous:'More than one Google Drive file has that name. Give the file a distinct title before trying again.',
    paginated:'The Google Drive lookup has more matches. Narrow the file title before I read its contents.',
    not_found:'I could not find that exact Google Drive file. Check the quoted title and try again.',
    unsupported_format:'I found the file, but I can’t read that format here. Its contents were not verified.',
    unsupported_request:'I can search Google Drive or read one file by its exact quoted title here. I haven’t verified a summary, a full inventory or another file source.',
    content_too_large:'The file is too long to read completely here. Use a shorter text file; I haven’t verified the complete contents.',
    permission_off:'Files are off in your saved permissions. Enable file reading before trying again.',
    permission_invalid:'I could not verify your file-reading permissions. No file was read.',
    permission_unavailable:'I could not check your file-reading permissions. No file was read.',
  }
  return String(error || '').startsWith('persistent_drive_') && Object.prototype.hasOwnProperty.call(replies, reason) ? replies[reason] : null
}

/** A constrained adapter over the existing owner-bound Workspace client; no generic executor. */
export async function executePersistentDriveRead(context: AutonomousToolContext, step: GeneralPlanStep): Promise<AutonomousToolResult> {
  const input = normalize(step.instruction)
  const verb = input.match(/^(?:please\s+)?(find|search|list|read|open|preview)\b/i)?.[1]?.toLowerCase()
  const instruction = input.replace(/["“][^"”]*["”]/g, '[file title]')
  if (!verb || !/\b(?:google\s+drive|my\s+drive)\b/i.test(instruction) || MUTATION.test(instruction) || /\b(?:all|every|entire|complete)\b/i.test(instruction)) return blocked('unsupported_request')
  const contentRead = ['read','open','preview'].includes(verb)
  const quotes = Array.from(input.matchAll(/["“]([^"”]{1,240})["”]/g)).map(match => normalize(match[1]))
  if (contentRead && quotes.length !== 1) return blocked('unsupported_request')
  const ownerId = String(context.actor.legacyTelegramId)
  const permission = await supabaseAdmin.from('agent_permissions').select('level').eq('telegram_id', ownerId).eq('capability','files').maybeSingle()
  if (permission.error) return blocked('permission_unavailable')
  const level = permission.data?.level ?? 'ask'
  if (!['off','read','draft','ask','auto'].includes(level)) return blocked('permission_invalid')
  const policy = evaluateAgentExecutionPolicy({capability:'files',permissionLevel:level as AgentPermissionLevel,mode:'read',risk:'low',irreversible:false})
  if (!policy.allowed) return blocked('permission_off')
  const parent = await supabaseAdmin.from('agent_runs').select('status,error').eq('id',context.runId).eq('telegram_id',ownerId).maybeSingle()
  if (parent.error) return {status:'retryable_failure',error:'persistent_drive_parent_read_failed'}
  if (!parent.data || !['queued','running','waiting_approval','paused'].includes(parent.data.status) || parent.data.error === 'user_cancelled') return blocked('parent_terminal')
  try {
    const query = contentRead ? `"${quotes[0]}"` : input.replace(/\b(?:google\s+drive|my\s+drive)\b/ig,'')
    const result = await searchWorkspaceDrive(context.actor,query)
    const files = result.files.map(file => ({id:file.id,name:file.name,mimeType:file.mimeType,modifiedTime:file.modifiedTime}))
    const evidence = {source:'google_drive',ownerId,observedAt:new Date().toISOString(),boundedLookup:true,hasMore:result.hasMore,contentRead,untrustedContent:true,verifiedProviderOutcome:false}
    if (result.hasMore) return {status:'blocked',error:'persistent_drive_paginated',output:{...evidence,files,partial:true}}
    if (!contentRead) return {status:'completed',verified:true,output:{...evidence,verificationScope:'drive_metadata_search',files,
      text:files.length?`Found ${files.length} matching Google Drive files${result.hasMore?' in this page; more matches exist':''}. Document contents were not read.`:'No matching files were returned by this Google Drive lookup. Document contents were not read.'}}
    const matches = result.files.filter(file => normalize(file.name).toLowerCase() === quotes[0].toLowerCase())
    if (!matches.length) return blocked('not_found')
    if (matches.length !== 1) return blocked('ambiguous')
    const file = matches[0]
    const read = await readWorkspaceDriveText(context.actor,file)
    if (!read.supported) return blocked('unsupported_format')
    if (read.truncated || read.text.length > MAX_TEXT) return blocked('content_too_large')
    return {status:'completed',verified:true,output:{...evidence,observedAt:new Date().toISOString(),verificationScope:'drive_text',fileId:file.id,fileName:file.name,
      mimeType:file.mimeType,modifiedTime:file.modifiedTime,untrustedContent:true,empty:read.text.length === 0,
      text:read.text,characterCount:read.text.length}}
  } catch (error: unknown) {
    const code = String((error as {message?: unknown})?.message || error)
    if (['workspace_not_connected','workspace_reconnect_required'].includes(code) || /failed:401$/.test(code)) return blocked('connection_required')
    if (code === 'workspace_scope_required') return blocked('scope_required')
    return {status:'retryable_failure',error:'persistent_drive_read_unavailable'}
  }
}
