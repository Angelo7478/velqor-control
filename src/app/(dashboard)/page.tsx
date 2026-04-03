'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { useAuth } from '@/stores/auth'
import { DIVISIONS, MEMO_TYPES, PRIORITY_LEVELS } from '@/lib/constants'
import { formatDate, daysUntil } from '@/lib/utils'
import type { Project, Memorandum, Event } from '@/types/database'

export default function DashboardPage() {
  const { membership } = useAuth()
  const [stats, setStats] = useState({ projects: 0, memos: 0, tasks: 0, events: 0 })
  const [recentMemos, setRecentMemos] = useState<Memorandum[]>([])
  const [upcomingEvents, setUpcomingEvents] = useState<Event[]>([])
  const [recentProjects, setRecentProjects] = useState<Project[]>([])

  useEffect(() => {
    if (!membership?.organization_id) return

    const supabase = createClient()
    const orgId = membership.organization_id

    async function load() {
      const [projectsRes, memosRes, tasksRes, eventsRes, recentProjectsRes] = await Promise.all([
        supabase.from('projects').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['draft', 'active', 'on_hold']),
        supabase.from('memoranda').select('*').eq('organization_id', orgId).in('status', ['pending', 'in_progress']).order('due_date', { ascending: true }).limit(5),
        supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['todo', 'in_progress']),
        supabase.from('events').select('*').eq('organization_id', orgId).gte('starts_at', new Date().toISOString()).order('starts_at').limit(5),
        supabase.from('projects').select('*').eq('organization_id', orgId).order('updated_at', { ascending: false }).limit(5),
      ])

      setStats({
        projects: projectsRes.count || 0,
        memos: memosRes.data?.length || 0,
        tasks: tasksRes.count || 0,
        events: eventsRes.data?.length || 0,
      })
      setRecentMemos(memosRes.data || [])
      setUpcomingEvents(eventsRes.data || [])
      setRecentProjects(recentProjectsRes.data || [])
    }

    load()
  }, [membership?.organization_id])

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <KpiCard label="Progetti attivi" value={stats.projects} href="/progetti" color="bg-blue-50 text-blue-700" />
        <KpiCard label="Memo pendenti" value={stats.memos} href="/memorandum" color="bg-amber-50 text-amber-700" />
        <KpiCard label="Task aperti" value={stats.tasks} href="/task" color="bg-green-50 text-green-700" />
        <KpiCard label="Eventi prossimi" value={stats.events} href="/calendario" color="bg-purple-50 text-purple-700" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Memorandum urgenti */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-900">Memorandum urgenti</h2>
            <Link href="/memorandum" className="text-sm text-blue-600 hover:underline">Vedi tutti</Link>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {recentMemos.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Nessun memorandum pendente</p>
            ) : (
              recentMemos.map((memo) => (
                <div key={memo.id} className="p-3 flex items-start gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${MEMO_TYPES[memo.memo_type]?.color}`}>
                    {MEMO_TYPES[memo.memo_type]?.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{memo.title}</p>
                    {memo.due_date && (
                      <p className={`text-xs mt-0.5 ${daysUntil(memo.due_date) < 0 ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                        {daysUntil(memo.due_date) < 0 ? 'Scaduto' : `Scade ${formatDate(memo.due_date)}`}
                      </p>
                    )}
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${PRIORITY_LEVELS[memo.priority]?.color}`}>
                    {PRIORITY_LEVELS[memo.priority]?.label}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Prossimi eventi */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-900">Prossimi eventi</h2>
            <Link href="/calendario" className="text-sm text-blue-600 hover:underline">Vedi tutti</Link>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {upcomingEvents.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Nessun evento in programma</p>
            ) : (
              upcomingEvents.map((event) => (
                <div key={event.id} className="p-3">
                  <p className="text-sm font-medium text-slate-900">{event.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {formatDate(event.starts_at)} {event.location && `· ${event.location}`}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Progetti recenti */}
        <section className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-900">Progetti recenti</h2>
            <Link href="/progetti" className="text-sm text-blue-600 hover:underline">Vedi tutti</Link>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {recentProjects.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Nessun progetto ancora</p>
            ) : (
              recentProjects.map((project) => (
                <Link key={project.id} href={`/progetti/${project.id}`} className="p-3 flex items-center gap-3 hover:bg-slate-50">
                  <span className="text-lg">{DIVISIONS[project.module as keyof typeof DIVISIONS]?.icon || '📁'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{project.name}</p>
                    <p className="text-xs text-slate-500">{DIVISIONS[project.module as keyof typeof DIVISIONS]?.label || project.module}</p>
                  </div>
                  <span className="text-xs text-slate-400">{formatDate(project.updated_at)}</span>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function KpiCard({ label, value, href, color }: { label: string; value: number; href: string; color: string }) {
  return (
    <Link href={href} className={`rounded-xl p-4 ${color} hover:opacity-90 transition-opacity`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm mt-1 opacity-80">{label}</p>
    </Link>
  )
}
