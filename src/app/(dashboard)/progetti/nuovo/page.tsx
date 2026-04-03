'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useAuth } from '@/stores/auth'
import { DIVISIONS, PROJECT_STATUSES } from '@/lib/constants'
import type { ModuleType, ProjectStatus } from '@/types/database'

export default function NuovoProgettoPage() {
  const { membership, user } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    const supabase = createClient()

    const { error } = await supabase.from('projects').insert({
      organization_id: membership!.organization_id,
      name: formData.get('name') as string,
      module: formData.get('module') as ModuleType,
      status: formData.get('status') as ProjectStatus || 'draft',
      start_date: formData.get('start_date') || null,
      end_date: formData.get('end_date') || null,
      budget: formData.get('budget') ? Number(formData.get('budget')) : null,
      owner_user_id: user?.id,
      visibility_scope: 'org',
    })

    if (!error) {
      router.push('/progetti')
    }
    setLoading(false)
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Nuovo Progetto</h1>

      <form action={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Nome progetto</label>
          <input name="name" required className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Divisione</label>
            <select name="module" required className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
              {Object.entries(DIVISIONS).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Stato</label>
            <select name="status" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" defaultValue="draft">
              {Object.entries(PROJECT_STATUSES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Data inizio</label>
            <input name="start_date" type="date" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Data fine</label>
            <input name="end_date" type="date" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Budget (EUR)</label>
          <input name="budget" type="number" step="0.01" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Opzionale" />
        </div>

        <div className="flex gap-2 pt-2">
          <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Salvataggio...' : 'Crea progetto'}
          </button>
          <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
            Annulla
          </button>
        </div>
      </form>
    </div>
  )
}
