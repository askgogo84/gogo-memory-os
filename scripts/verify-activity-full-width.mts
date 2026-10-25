import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync('app/dashboard/(app)/activity/page.tsx','utf8')

assert.ok(source.includes('className="w-full pb-8"'),'Activity must use the available dashboard canvas')
assert.ok(source.includes("xl:grid-cols-[minmax(0,1fr)_340px]"),'desktop Activity must use a content + context-rail layout')
assert.ok(source.includes('Gogo at work'),'desktop context rail must surface current work')
assert.ok(source.includes('Needs you'),'desktop context rail must surface approvals')
assert.ok(source.includes('Background Gogo'),'desktop context rail must surface active watches')
assert.ok(source.includes("sticky top-8"),'desktop context rail should remain visible while scrolling')
assert.ok(!source.includes('max-w-[1180px] pb-8'),'Activity must not recenter into a narrow fixed canvas')

console.log('Activity full-width workspace regression passed')
