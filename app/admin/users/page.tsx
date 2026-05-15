'use client'
import { useState, useEffect, useCallback } from 'react'

const TIERS = [
  { value: 'free', label: 'Free', color: 'bg-slate-100 text-slate-600' },
  { value: 'starter', label: 'Starter', color: 'bg-blue-50 text-blue-700' },
  { value: 'pro', label: 'Pro', color: 'bg-purple-50 text-purple-700' },
  { value: 'founder_pro', label: 'Founder Pro', color: 'bg-emerald-50 text-emerald-700' },
]

function TierBadge({ tier }: { tier: string }) {
  const t = TIERS.find(t => t.value === tier) || TIERS[0]
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${t.color}`}>{t.label}</span>
}

function formatDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatPhone(waId: string) {
  return waId?.replace('whatsapp:', '') || '—'
}

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  // Add user form
  const [addPhone, setAddPhone] = useState('')
  const [addTier, setAddTier] = useState('founder_pro')
  const [addName, setAddName] = useState('')
  const [adding, setAdding] = useState(false)

  const fetchUsers = useCallback(async (search = '') => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users?q=${encodeURIComponent(search)}`)
      const data = await res.json()
      if (data.error) { setError('API error: ' + data.error); setLoading(false); return }
      setUsers(data.users || [])
    } catch (e: any) { setError('Failed to load users: ' + e.message) }
    setLoading(false)
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchUsers(q)
  }

  const updateTier = async (phone: string, tier: string, name?: string) => {
    setEditing(phone)
    setMsg('')
    setError('')
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_tier', phone, tier, name })
      })
      const data = await res.json()
      if (data.ok) {
        setMsg(`✅ ${data.action === 'created' ? 'Created' : 'Updated'}: ${formatPhone(data.user?.whatsapp_id || phone)} → ${tier}`)
        fetchUsers(q)
      } else {
        setError(data.error || 'Failed')
      }
    } catch { setError('Network error') }
    setEditing(null)
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addPhone) return
    setAdding(true)
    await updateTier(addPhone, addTier, addName || undefined)
    setAddPhone('')
    setAddName('')
    setAdding(false)
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
            <p className="text-sm text-slate-500 mt-1">Search users · update plans · grant Founder Pro access</p>
          </div>
          <a href="/admin" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            ← Dashboard
          </a>
        </div>

        {/* Add / Grant Access */}
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-sm font-bold text-emerald-800 mb-3 uppercase tracking-wide">Grant Access / Add User</h2>
          <form onSubmit={handleAdd} className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">WhatsApp Number</label>
              <input
                value={addPhone}
                onChange={e => setAddPhone(e.target.value)}
                placeholder="+971504561503"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Name (optional)</label>
              <input
                value={addName}
                onChange={e => setAddName(e.target.value)}
                placeholder="John Doe"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Plan</label>
              <select
                value={addTier}
                onChange={e => setAddTier(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              style={{color: '#374151', backgroundColor: '#ffffff'}}
              >
                {TIERS.map(t => <option key={t.value} value={t.value} style={{color:'#374151'}}>{t.label}</option>)}
              </select>
            </div>
            <button
              type="submit"
              disabled={adding}
              className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {adding ? 'Saving...' : 'Grant Access'}
            </button>
          </form>
        </div>

        {/* Feedback */}
        {msg && <div className="mb-4 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">{msg}</div>}
        {error && <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

        {/* Search */}
        <form onSubmit={handleSearch} className="mb-4 flex gap-2">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search by phone number or name..."
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          <button type="submit" className="rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">
            Search
          </button>
          {q && <button type="button" onClick={() => { setQ(''); fetchUsers('') }} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600">Clear</button>}
        </form>

        {/* Users Table */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600">{users.length} users</span>
            {loading && <span className="text-xs text-slate-400">Loading...</span>}
          </div>
          <div className="divide-y divide-slate-50">
            {users.length === 0 && !loading && (
              <div className="px-5 py-8 text-center text-sm text-slate-400">No users found</div>
            )}
            {users.map(u => (
              <div key={u.telegram_id} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-sm font-bold text-emerald-700 flex-shrink-0">
                  {(u.name || '?')[0].toUpperCase()}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">{u.name || 'Unknown'}</div>
                  <div className="text-xs text-slate-400">{formatPhone(u.whatsapp_id)} · Joined {formatDate(u.created_at)}</div>
                </div>
                {/* Current tier */}
                <TierBadge tier={u.tier || 'free'} />
                {/* Change tier */}
                <select
                  defaultValue={u.tier || 'free'}
                  disabled={editing === u.whatsapp_id}
                  onChange={e => updateTier(u.whatsapp_id, e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50 cursor-pointer"
                  style={{color: '#374151', backgroundColor: '#ffffff'}}
                >
                  {TIERS.map(t => <option key={t.value} value={t.value} style={{color:'#374151'}}>{t.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-4 text-xs text-slate-400 text-center">
          Changing the dropdown instantly updates the user's plan. Founder Pro = unlimited access.
        </p>
      </div>
    </main>
  )
}
