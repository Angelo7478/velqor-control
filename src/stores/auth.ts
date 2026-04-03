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

export const useAuth = create<AuthState>((set) => ({
  user: null,
  profile: null,
  membership: null,
  loading: true,

  initialize: async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (session?.user) {
      const [profileRes, membershipRes] = await Promise.all([
        supabase.from('users').select('*').eq('id', session.user.id).single(),
        supabase.from('memberships').select('*').eq('user_id', session.user.id).eq('is_active', true).single(),
      ])

      set({
        user: session.user,
        profile: profileRes.data,
        membership: membershipRes.data,
        loading: false,
      })
    } else {
      set({ user: null, profile: null, membership: null, loading: false })
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        set({ user: null, profile: null, membership: null })
      } else if (session?.user) {
        const [profileRes, membershipRes] = await Promise.all([
          supabase.from('users').select('*').eq('id', session.user.id).single(),
          supabase.from('memberships').select('*').eq('user_id', session.user.id).eq('is_active', true).single(),
        ])
        set({
          user: session.user,
          profile: profileRes.data,
          membership: membershipRes.data,
        })
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
