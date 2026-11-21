import {notFound} from 'next/navigation'
import ZomatoSandbox from './ZomatoSandbox'

// Authenticated by the dashboard layout; never available on the production deployment.
export const dynamic = 'force-dynamic'
export default function ZomatoSandboxPage() {
  if (process.env.VERCEL_ENV !== 'preview' && process.env.NODE_ENV !== 'development') notFound()
  return <ZomatoSandbox />
}
