import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { MarketType } from '@/lib/market'

interface UIState {
  sidebarOpen: boolean
  toggleSidebar: () => void
  closeSidebar: () => void
  /** Macro mercato selezionato dal toggle in Sidebar: filtra TUTTA la Control Room. */
  marketType: MarketType
  setMarketType: (m: MarketType) => void
  /** true quando il valore persistito e' stato riletto da localStorage (vedi nota sotto). */
  hydrated: boolean
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      closeSidebar: () => set({ sidebarOpen: false }),
      marketType: 'cfd',
      setMarketType: (m) => set({ marketType: m }),
      hydrated: false,
    }),
    {
      name: 'velqor-ui',
      storage: createJSONStorage(() => localStorage),
      // Solo marketType e' persistito: sidebarOpen deve ripartire chiuso a ogni visita.
      partialize: (s) => ({ marketType: s.marketType }) as Partial<UIState>,
      // HYDRATION — perche' skipHydration:
      // con storage sincrono zustand rileggerebbe localStorage durante la creazione dello
      // store, cioe' al primo render client, che divergerebbe dall'HTML del server (dove
      // marketType e' sempre 'cfd') -> hydration mismatch di React.
      // Qui la rilettura e' MANUALE: la fa (dashboard)/layout.tsx in un useEffect, e finche'
      // `hydrated` e' false il layout mostra lo splash che ha gia' per l'auth. Cosi' server e
      // primo render client sono identici (splash), e nessuna pagina monta prima che
      // marketType sia definitivo -> nessuna pagina deve controllare `hydrated`, e nessuna
      // fa un primo fetch con la macro sbagliata seguito da refetch.
      skipHydration: true,
      onRehydrateStorage: () => () => { useUI.setState({ hydrated: true }) },
    }
  )
)
