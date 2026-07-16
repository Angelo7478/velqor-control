'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useUI } from '@/stores/ui'
import { MARKET_TYPES, MARKET_LABELS } from '@/lib/market'

// scope: 'macro'  = la pagina mostra i dati del mercato selezionato dal toggle (CFD | FUTURE)
//        'global' = la pagina e' trasversale ai due mondi e sta fuori dal toggle.
//                   Research legge solo le tabelle qre_ (conoscenza, metodo, robustezza):
//                   vale per entrambi i mercati, quindi non si filtra.
const NAV_ITEMS = [
  { href: '/divisioni/quant', label: 'Overview', icon: '📊', scope: 'macro' },
  { href: '/divisioni/quant/conti', label: 'Conti', icon: '🏦', scope: 'macro' },
  { href: '/divisioni/quant/schede-conto', label: 'Schede Conto', icon: '🗂️', scope: 'macro' },
  { href: '/divisioni/quant/sizing-status', label: 'Stato Sizing', icon: '🚦', scope: 'macro' },
  { href: '/divisioni/quant/schede', label: 'Schede Strategia', icon: '📋', scope: 'macro' },
  { href: '/divisioni/quant/magic', label: 'Stato Magic', icon: '🎯', scope: 'macro' },
  { href: '/divisioni/quant/health', label: 'Salute', icon: '🩺', scope: 'macro' },
  { href: '/divisioni/quant/monthly', label: 'Mensile', icon: '📈', scope: 'macro' },
  { href: '/divisioni/quant/portfolio', label: 'Builder', icon: '🔧', scope: 'macro' },
  { href: '/divisioni/quant/research', label: 'Research', icon: '🔬', scope: 'global' },
] as const

export function Sidebar() {
  const pathname = usePathname()
  const { sidebarOpen, closeSidebar, marketType, setMarketType } = useUI()

  const isActive = (href: string) =>
    href === '/divisioni/quant' ? pathname === href : pathname.startsWith(href)

  const navLink = (item: typeof NAV_ITEMS[number]) => (
    <li key={item.href}>
      <Link
        href={item.href}
        onClick={closeSidebar}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors touch-target',
          isActive(item.href)
            ? 'bg-blue-600 text-white'
            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        )}
      >
        <span>{item.icon}</span>
        {item.label}
      </Link>
    </li>
  )

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
          'fixed top-0 left-0 h-full w-64 bg-slate-900 text-white z-50 transition-transform duration-200 lg:translate-x-0 lg:static lg:z-auto overflow-y-auto',
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

        {/* Toggle macro mercato: filtra TUTTE le pagine con scope 'macro' */}
        <div className="p-3 border-b border-slate-700">
          <div
            role="tablist"
            aria-label="Macro mercato"
            className="grid grid-cols-2 gap-1 p-1 bg-slate-800 rounded-lg"
          >
            {MARKET_TYPES.map((m) => (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={marketType === m}
                onClick={() => setMarketType(m)}
                className={cn(
                  'px-3 py-2 rounded-md text-xs font-bold tracking-wide transition-colors touch-target',
                  marketType === m
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700'
                )}
              >
                {MARKET_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {/* Nav: prima le pagine legate al mercato, poi le trasversali */}
        <nav className="p-3">
          <ul className="space-y-1">
            {NAV_ITEMS.filter((i) => i.scope === 'macro').map(navLink)}
          </ul>

          <div className="mt-4 pt-3 border-t border-slate-700">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Trasversale
            </p>
            <ul className="space-y-1">
              {NAV_ITEMS.filter((i) => i.scope === 'global').map(navLink)}
            </ul>
          </div>
        </nav>
      </aside>
    </>
  )
}
