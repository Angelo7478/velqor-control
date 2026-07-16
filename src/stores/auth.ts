import { create } from 'zustand'
import { createClient } from '@/lib/supabase-browser'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import type { User, Membership } from '@/types/database'

interface AuthState {
  user: SupabaseUser | null
  profile: User | null
  membership: Membership | null
  loading: boolean
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

// Init GLOBALE, non per-mount: initialize() viene chiamata a ogni mount del layout e
// senza questa guardia si registrava un listener a ogni mount (si accumulavano).
// Con la guardia il listener e' UNO SOLO e vive quanto l'app: e' il pattern corretto,
// e non serve unsubscribe (il layout si smonta solo uscendo dall'app).
let initStarted = false

async function loadProfile(userId: string) {
  const supabase = createClient()
  const [profileRes, membershipRes] = await Promise.all([
    supabase.from('users').select('*').eq('id', userId).single(),
    supabase.from('memberships').select('*').eq('user_id', userId).eq('is_active', true).single(),
  ])
  return { profile: profileRes.data as User | null, membership: membershipRes.data as Membership | null }
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  membership: null,
  loading: true,

  initialize: async () => {
    if (initStarted) return
    initStarted = true
    const supabase = createClient()

    // Sessione iniziale: qui l'await e' sicuro (siamo fuori dal callback, nessun lock tenuto).
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      const p = await loadProfile(session.user.id)
      set({ user: session.user, profile: p.profile, membership: p.membership, loading: false })
    } else {
      set({ user: null, profile: null, membership: null, loading: false })
    }

    // DEADLOCK — leggere prima di toccare (gotcha MASTER sez. 8):
    // supabase-js v2 tiene il LOCK AUTH mentre esegue i callback di onAuthStateChange.
    // Una query Supabase awaited QUI DENTRO ha bisogno dello stesso lock per il token ->
    // deadlock: da quel momento OGNI chiamata dell'app resta appesa per sempre (la
    // navigazione non completa, le save restano su "Salvataggio..."), e solo il refresh
    // del tab ripara perche' ricrea il client. Scattava al TOKEN_REFRESHED (~ogni ora) o
    // al refocus del tab.
    // REGOLA: questo callback resta SINCRONO. Lo stato sessione si aggiorna qui; ogni
    // lavoro async va DIFFERITO con setTimeout(0), cosi' gira dopo il rilascio del lock.
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session?.user) {
        set({ user: null, profile: null, membership: null })
        return
      }

      const u = session.user
      set({ user: u })

      // Il profilo si ricarica solo se manca o se e' cambiato l'utente: al TOKEN_REFRESHED
      // (evento piu' frequente) non serve rifare le query, il profilo e' gia' quello giusto.
      const prev = get().profile
      if (!prev || prev.id !== u.id) {
        setTimeout(() => {
          loadProfile(u.id)
            .then(p => set(p))
            .catch(() => { /* il profilo resta com'e': meglio stale che appeso */ })
        }, 0)
      }
    })
  },

  signIn: async (email, password) => {
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return { error: null }
  },

  signOut: async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    set({ user: null, profile: null, membership: null })
  },
}))
