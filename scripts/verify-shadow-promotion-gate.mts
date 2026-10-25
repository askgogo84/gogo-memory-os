import assert from 'node:assert/strict'
import { shadowActionFamily, shadowNeedsContext } from '../lib/agent/shadow-brain'

const contextual=[
  'Save it to my calendar',
  'Monitor it and tell me if anything changes',
  'Book it',
  'Order my usual pizza',
  'Same as last time',
  'Book the second one',
  'Continue',
  'Check the flight',
  'Send this to Ravi',
]
for(const text of contextual)assert.equal(shadowNeedsContext(text),true,text)

const actions:[string,string][]=[
  ['Save it to my calendar','calendar'],
  ['Monitor it and tell me if anything changes','monitor'],
  ['Book it','book'],
  ['Order my usual pizza','buy'],
  ['Remind me tomorrow','remind'],
  ['Check travel requirements','research'],
  ['Send this to Ravi','send'],
]
for(const [text,expected] of actions)assert.equal(shadowActionFamily(text),expected,text)

assert.equal(shadowNeedsContext('What is the weather in Bengaluru today?'),false)
assert.equal(shadowNeedsContext('Create a new grocery list called Sunday'),false)

console.log('Shadow Brain promotion-gate fixtures passed')
