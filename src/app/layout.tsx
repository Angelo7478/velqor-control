import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Velqor Control Room',
  description: 'Sistema operativo Velqor',
  robots: 'noindex, nofollow',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  )
}
