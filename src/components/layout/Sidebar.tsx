'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { DIVISIONS } from '@/lib/constants'
import { useUI } from '@/stores/ui'

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '📊' },
  { href: '/memorandum', label: 'Memorandum', icon: '📋' },
  { href: '/calendario', label: 'Calendario', icon: '📅' },
  { href: '/progetti', label: 'Progetti', icon: '📁' },
  { href: '/task', label: 'Task', icon: '✅' },
]

export function Sidebar() {
  const pathname = usePathname()
  const { sidebarOpen, closeSidebar } = useUI()

  return (
    <>
      {/* Backdrop mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 h-full w-64 bg-slate-900 text-white z-50 transition-transform duration-200 lg:translate-x-0 lg:static lg:z-auto',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="p-4 border-b border-slate-700">
          <Link href="/" onClick={closeSidebar}>
            <h1 className="text-xl font-bold tracking-tight">VELQOR</h1>
            <span className="text-xs text-slate-400">Control Room</span>
          </Link>
        </div>

        {/* Nav principale */}
        <nav className="p-3">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={closeSidebar}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors touch-target',
                    pathname === item.href
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  )}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Divisioni */}
        <div className="p-3 mt-2">
          <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Divisioni
          </p>
          <ul className="space-y-1">
            {Object.entries(DIVISIONS).map(([key, div]) => (
              <li key={key}>
                <Link
                  href={div.href}
                  onClick={closeSidebar}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors touch-target',
                    pathname.startsWith(div.href)
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  )}
                >
                  <span>{div.icon}</span>
                  {div.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </>
  )
}
