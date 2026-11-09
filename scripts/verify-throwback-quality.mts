import assert from 'node:assert/strict'
import { eligibleThrowbackMemory } from '../lib/bot/handlers/throwback-quality'

let tested = 0
function check(input:unknown,source:unknown,expected:boolean){
  assert.equal(eligibleThrowbackMemory(input,source),expected,JSON.stringify(input))
  tested++
}
check('User wants to save something, but no specific fact or detail was provided in the message.','memories',false)
check('There was nothing specific to save from this message.','memories',false)
check('Cannot remember without details.','memories',false)
check('ASKGOGO_USAGE: state','memories',false)
check('[APPROVAL id=12] do not run','memories',false)
check('My password is ZXZZ1234','memories',false)
check('Payment card 4111 1111 1111 1111','memories',false)
check('I prefer reminders at 8 am on weekdays.','memories',true)
check('Divya is arriving in Bengaluru on Friday.','memories',true)
check('Project Helios was launched in September.','memories',true)
check('Samsonite invoice was uploaded last week.','documents',false)
check('I prefer reminders at 8 am on weekdays.',null,false)
check(undefined,'memories',false)
console.log('Throwback quality: '+tested+' content/source isolation assertions passed')
