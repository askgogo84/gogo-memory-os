import type { MetadataRoute } from 'next'

// Makes AskGogo installable on a phone or desktop ("Install app"). It opens straight into Gogo's chat
// and runs without the browser address bar. Dark colours match the dashboard so there is no white flash.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AskGogo',
    short_name: 'AskGogo',
    description: 'Your personal AI that remembers, plans, acts and keeps working when you are away.',
    id: '/dashboard/chat',
    start_url: '/dashboard/chat',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b0b0b',
    theme_color: '#0b0b0b',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Message Gogo', url: '/dashboard/chat' },
      { name: 'Today', url: '/dashboard/home' },
      { name: 'Needs you', url: '/dashboard/agent?section=approvals' },
    ],
  }
}
