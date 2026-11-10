// Test helper: the small part of the supabase-js query builder that lib/events/store.ts uses, run against PGlite,
// so store code is tested on real SQL (constraints, functions, row locks) with no network.
import type { PGlite } from '@electric-sql/pglite'

const ident = (s: string) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('bad identifier ' + s); return `"${s}"` }
const cols = (s: string) => (s.trim() === '*' ? '*' : s.split(',').map(c => ident(c.trim())).join(', '))

export function pgliteSupabase(db: PGlite) {
  const run = async (sql: string, params: unknown[]) => { try { return { rows: (await db.query(sql, params)).rows as any[], error: null as any } } catch (e: any) { return { rows: [] as any[], error: { message: String(e?.message || e), code: e?.code } } } }
  function builder(table: string) {
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select', selected = '*', returning: string | null = null, values: any = null, single: 'one' | 'maybe' | null = null
    const where: [string, unknown][] = []; let order = '', limit = ''
    const q: any = {
      select(c = '*') { if (op === 'select') selected = c; else returning = c; return q },
      insert(v: any) { op = 'insert'; values = v; return q },
      update(v: any) { op = 'update'; values = v; return q },
      delete() { op = 'delete'; return q },
      eq(c: string, v: unknown) { where.push([c, v]); return q },
      order(c: string, o: { ascending?: boolean } = {}) { order = ` order by ${ident(c)} ${o.ascending === false ? 'desc' : 'asc'}`; return q },
      limit(n: number) { limit = ` limit ${Math.floor(n)}`; return q },
      single() { single = 'one'; return q }, maybeSingle() { single = 'maybe'; return q },
      then(resolve: any, reject: any) { return exec().then(resolve, reject) },
    }
    async function exec() {
      const params: unknown[] = []
      const p = (v: unknown) => { params.push(v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v); return `$${params.length}` }
      let sql = ''
      if (op === 'insert') {
        const rows = Array.isArray(values) ? values : [values]
        const keys = Object.keys(rows[0])
        sql = `insert into ${ident(table)} (${keys.map(ident).join(', ')}) values ${rows.map(r => `(${keys.map(k => p(r[k])).join(', ')})`).join(', ')}`
      } else if (op === 'update') {
        sql = `update ${ident(table)} set ${Object.keys(values).map(k => `${ident(k)} = ${p(values[k])}`).join(', ')}`
      } else if (op === 'delete') { if (!where.length) return { data: null, error: { message: 'delete without a filter' } }; sql = `delete from ${ident(table)}` }
      else sql = `select ${cols(selected)} from ${ident(table)}`
      if (op !== 'insert' && where.length) sql += ' where ' + where.map(([c, v]) => `${ident(c)} = ${p(v)}`).join(' and ')
      if (op === 'select') sql += order + limit
      else if (returning) sql += ` returning ${cols(returning)}`
      const { rows, error } = await run(sql, params)
      if (error) return { data: null, error }
      if (single === 'one') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'expected one row', code: 'PGRST116' } }
      if (single === 'maybe') return rows.length > 1 ? { data: null, error: { message: 'more than one row', code: 'PGRST116' } } : { data: rows[0] ?? null, error: null }
      return { data: rows, error: null }
    }
    return q
  }
  return {
    from: builder,
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      const keys = Object.keys(args)
      const { rows, error } = await run(`select ${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')}) as r`, keys.map(k => args[k]))
      return error ? { data: null, error } : { data: rows[0]?.r ?? null, error: null }
    },
  }
}
