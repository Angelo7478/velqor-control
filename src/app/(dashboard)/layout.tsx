'use client'

import { useEffect } from 'react'
import { useAuth } from '@/stores/auth'
import { useUI } from '@/stores/ui'
import { Sidebar } from '@/components/layout/Sidebar'
import { Topbar } from '@/components/layout/Topbar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { initialize, loading } = useAuth()
  const hydrated = useUI((s) => s.hydrated)

  useEffect(() => {
    initialize()
  }, [initialize])

  // Rilettura manuale del marketType persistito (lo store usa skipHydration per non
  // divergere dall'HTML del server). Finche' non e' fatta si resta sullo splash: cosi'
  // nessuna pagina monta con la macro sbagliata, e nessuna deve gestire l'attesa.
  useEffect(() => {
    useUI.persist.rehydrate()
  }, [])

  if (loading || !hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900">VELQOR</h1>
          <p className="text-slate-500 mt-1">Caricamento...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
