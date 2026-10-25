'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ITEMS: [string, string][] = [
  ['/admin', 'Overview'], ['/admin/waitlist', 'Waitlist'], ['/admin/users', 'Users'], ['/admin/tasks', 'Tasks'],
  ['/admin/costs', 'Costs'], ['/admin/tools', 'Tools and APIs'], ['/admin/health', 'System health'],
  ['/admin/architecture', 'Architecture'], ['/admin/access', 'Access and audit'],
]

export function AdminNav({ waiting }: { waiting: number }) {
  const path = usePathname() || '/admin'
  const active = (href: string) => (href === '/admin' ? path === '/admin' : path === href || path.startsWith(href + '/'))
  return (
    <nav aria-label="Admin sections" className="adm-nav">
      {ITEMS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={active(href) ? 'page' : undefined}>
          <span>{label}</span>
          {href === '/admin/waitlist' && waiting > 0 ? <span className="badge">{waiting}</span> : null}
        </Link>
      ))}
    </nav>
  )
}
