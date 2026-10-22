// Existing in-memory summary fixtures: understand the new query shape rather
// than silently ignoring filters/order. New SQL-backed tests independently check it.
import { compareSummaryTimestamps } from '../lib/agent/conversation-summary-evidence.ts'
export const summaryFixtureId = (n:number) => `00000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`
export function summaryFixtureFilter(row:any, expression:string):boolean {
  const split=(s:string)=>{let depth=0,start=0;const parts:string[]=[];for(let i=0;i<s.length;i++){if(s[i]==='(')depth++;if(s[i]===')')depth--;if(s[i]===','&&!depth){parts.push(s.slice(start,i));start=i+1}}parts.push(s.slice(start));return parts}
  const test=(s:string):boolean=>{const group=s.match(/^(and|or)\((.*)\)$/);if(group){const parts=split(group[2]);return group[1]==='and'?parts.every(test):parts.some(test)}const m=s.match(/^(created_at|role|id)\.(eq|gt|gte|lt|lte)\.(.+)$/);if(!m)throw Error('unsupported fixture filter '+s);const value=m[1]==='created_at'?compareSummaryTimestamps(row[m[1]],m[3]):String(row[m[1]]).localeCompare(m[3]);return m[2]==='eq'?value===0:m[2]==='gt'?value>0:m[2]==='gte'?value>=0:m[2]==='lt'?value<0:value<=0}
  return test('or('+expression+')')
}
export function summaryFixtureOrder(rows:any[],orders:{key:string;ascending:boolean}[]) {
 return [...rows].sort((a,b)=>{for(const o of orders){const c=o.key==='created_at'&&typeof a[o.key]==='string'&&typeof b[o.key]==='string'?compareSummaryTimestamps(a[o.key],b[o.key]):String(a[o.key]).localeCompare(String(b[o.key]));if(c)return c*(o.ascending?1:-1)}return 0})
}
