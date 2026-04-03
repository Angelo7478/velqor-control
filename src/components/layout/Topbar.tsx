'use client'

import { useUI } from '@/stores/ui'
import { useAuth } from '@/stores/auth'

export function Topbar() {
  const { toggleSidebar } = useUI()
  const { profile, signOut } = useAuth()

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 sticky top-0 z-30">
      {/* Menu hamburger (mobile) */}
      <button
        onClick={toggleSidebar}
        className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-slate-100 touch-target"
        aria-label="Menu"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-600 hidden sm:block">
          {profile?.full_name || 'Utente'}
        </span>
        <button
          onClick={signOut}
          className="text-sm text-slate-500 hover:text-slate-700 px-2 py-1 rounded"
        >
          Esci
        </button>
      </div>
    </header>
  )
}
