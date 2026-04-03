'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { useAuth } from '@/stores/auth'
import { DIVISIONS, PROJECT_STATUSES } from '@/lib/constants'
import { formatDate } from '@/lib/utils'
import type { Project, ModuleType } from '@/types/database'

export default function ProgettiPage() {
  const { membership } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [filter, setFilter] = useState<ModuleType | 'all'>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!membership?.organization_id) return

    const supabase = createClient()
    async function load() {
      let query = supabase
        .from('projects')
        .select('*')
        .eq('organization_id', membership!.organization_id)
        .order('updated_at', { ascending: false })

      if (filter !== 'all') {
        query = query.eq('module', filter)
      }

      const { data } = await query
      setProjects(data || [])
      setLoading(false)
    }

    load()
  }, [membership?.organization_id, filter])

  if (loading) return <p className="text-slate-500">Caricamento...</p>

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Progetti</h1>
        <Link
          href="/progetti/nuovo"
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 touch-target"
        >
          + Nuovo
        </Link>
      </div>

      {/* Filtro divisione */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${
            filter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Tutti
        </button>
        {Object.entries(DIVISIONS).map(([key, div]) => (
          <button
            key={key}
            onClick={() => setFilter(key as ModuleType)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${
              filter === key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {div.icon} {div.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {projects.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-slate-500">Nessun progetto {filter !== 'all' && 'per questa divisione'}</p>
            <Link href="/progetti/nuovo" className="text-sm text-blue-600 hover:underline mt-2 inline-block">Crea il primo</Link>
          </div>
        ) : (
          projects.map((project) => (
            <Link key={project.id} href={`/progetti/${project.id}`} className="p-4 flex items-center gap-3 hover:bg-slate-50">
              <span className="text-xl">{DIVISIONS[project.module as keyof typeof DIVISIONS]?.icon || '📁'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{project.name}</p>
                <p className="text-xs text-slate-500">
                  {DIVISIONS[project.module as keyof typeof DIVISIONS]?.label}
                  {project.start_date && ` · ${formatDate(project.start_date)}`}
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${PROJECT_STATUSES[project.status]?.color}`}>
                {PROJECT_STATUSES[project.status]?.label}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
