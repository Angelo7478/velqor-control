'use client'

import { usePathname } from 'next/navigation'

const PAGES = [
  { href: '/divisioni/quant', label: 'Overview', icon: '📊' },
  { href: '/divisioni/quant/sizing', label: 'Sizing', icon: '⚖️' },
  { href: '/divisioni/quant/health', label: 'Salute', icon: '🩺' },
  { href: '/divisioni/quant/scenarios', label: 'Scenari', icon: '🎲' },
  { href: '/divisioni/quant/builder', label: 'Builder', icon: '🔧' },
  { href: '/divisioni/quant/monthly', label: 'Mensile', icon: '📊' },
  { href: '/divisioni/quant/import', label: 'Import', icon: '📥' },
  { href: '/divisioni/quant/conti', label: 'Conti', icon: '🏦' },
]

export default function QuantNav() {
  const pathname = usePathname()

  return (
    <nav className="flex gap-1 overflow-x-auto pb-1 mb-4 border-b border-slate-200">
      {PAGES.map(p => {
        const active = pathname === p.href
        return (
          <a
            key={p.href}
            href={p.href}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-lg whitespace-nowrap transition ${
              active
                ? 'bg-white border border-b-white border-slate-200 -mb-px font-medium text-slate-900'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className="text-xs">{p.icon}</span>
            {p.label}
          </a>
        )
      })}
    </nav>
  )
}
