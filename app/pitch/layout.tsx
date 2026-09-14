import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'AskGogo Investor Deck',
  description: 'AskGogo — One Gogo. Everywhere. Plan. Act. Watch. Investor deck.',
  openGraph: {
    title: 'AskGogo Investor Deck',
    description: 'The personal AI operating agent for everyday life.',
    type: 'website',
  },
}

export default function PitchLayout({ children }: { children: React.ReactNode }) {
  return children
}
