'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useUI } from '@/stores/ui'

const NAV_ITEMS = [
  { href: '/divisioni/quant', label: 'Overview', icon: '📊' },
  { href: '/divisioni/quant/conti', label: 'Conti', icon: '🏦' },
  { href: '/divisioni/quant/schede-conto', label: 'Schede Conto', icon: '🗂️' },
  { href: '/divisioni/quant/sizing-status', label: 'Stato Sizing', icon: '🚦' },
  { href: '/divisioni/quant/sizing', label: 'Sizing', icon: '⚖️' },
  { href: '/divisioni/quant/schede', label: 'Schede Strategia', icon: '📋' },
  { href: '/divisioni/quant/magic', label: 'Stato Magic', icon: '🎯' },
  { href: '/divisioni/quant/health', label: 'Salute', icon: '🩺' },
  { href: '/divisioni/quant/scenarios', label: 'Scenari', icon: '🎲' },
  { href: '/divisioni/quant/research', label: 'Research', icon: '🔬' },
  { href: '/divisioni/quant/monthly', label: 'Mensile', icon: '📈' },
  { href: '/divisioni/quant/builder', label: 'Builder', icon: '🔧' },
  { href: '/divisioni/quant/import', label: 'Import', icon: '📥' },
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
          <Link href="/divisioni/quant" onClick={closeSidebar}>
            <h1 className="text-xl font-bold tracking-tight">VELQOR QUANT</h1>
            <span className="text-xs text-slate-400">Control Room</span>
          </Link>
        </div>

        {/* Nav Quant */}
        <nav className="p-3">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = item.href === '/divisioni/quant'
                ? pathname === item.href
                : pathname.startsWith(item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={closeSidebar}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors touch-target',
                      active
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    )}
                  >
                    <span>{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>
    </>
  )
}
