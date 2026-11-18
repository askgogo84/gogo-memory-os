import assert from 'node:assert/strict'
import {normalizePostUrl,selectEngagementCandidates,canPublishComment,ENGAGEMENT_RULES} from '../lib/agent/linkedin-engagement'
import {selectContentWorkflow} from '../lib/agent/content-workflows'
assert.equal(normalizePostUrl('https://www.linkedin.com/posts/a-activity-123?utm_campaign=x'), 'https://www.linkedin.com/posts/a-activity-123')
for (const u of ['http://linkedin.com/posts/a','https://evil.test/posts/a','https://linkedin.com.evil.test/posts/a','https://linkedin.com/jobs/view/1','https://lnkd.in/p/x']) assert.equal(normalizePostUrl(u),null)
const now=Date.parse('2026-11-18T12:00:00Z')
const item={postUrl:'https://www.linkedin.com/posts/a-activity-123',author:'Industry expert',body:'AI agents in enterprise workflows require strong governance and reliable execution. We need to measure more than fluent responses and demos.',publishedAt:'2026-11-18T07:00:00Z',source:'public_verified' as const}
assert.equal(selectEngagementCandidates([item,item,{...item,publishedAt:'2024-01-01'}],{now}).length,1)
assert.equal(selectEngagementCandidates([item],{now,usedUrls:new Set([item.postUrl])}).length,0)
const good={ownerId:'owner',connectedOwnerId:'owner',scopes:['w_member_social'],providerPostUrn:'urn:li:activity:123',approvedPostUrn:'urn:li:activity:123',draftHash:'a',approvedHash:'a',approvedAt:now-1000,approvalExpiry:now+60000,now,providerAvailable:true}
assert.equal(canPublishComment(good).allowed,true)
for (const bad of [{connectedOwnerId:'other'},{scopes:[]},{providerAvailable:false},{approvedPostUrn:'urn:li:activity:124'},{approvedHash:'b'},{approvalExpiry:now-1}]) assert.equal(canPublishComment({...good,...bad}).allowed,false)
assert.match(ENGAGEMENT_RULES,/Never publish/)
assert.equal(selectContentWorkflow('Draft a LinkedIn comment about this post')?.id,'linkedin-comment')
assert.equal(selectContentWorkflow('Publish this post on LinkedIn'),null)
console.log('LinkedIn engagement foundation passed')
