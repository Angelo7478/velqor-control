'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useAuth } from '@/stores/auth'
import { MEMO_TYPES, PRIORITY_LEVELS } from '@/lib/constants'
import { cn, formatDate, daysUntil } from '@/lib/utils'
import type { Memorandum, MemoType, MemoStatus, PriorityLevel } from '@/types/database'

const TABS: { key: MemoType; label: string }[] = [
  { key: 'estimate', label: 'Da stimare' },
  { key: 'evaluate', label: 'Da valutare' },
  { key: 'execute', label: 'Da eseguire' },
]

export default function MemorandumPage() {
  const { membership, user } = useAuth()
  const [memos, setMemos] = useState<Memorandum[]>([])
  const [activeTab, setActiveTab] = useState<MemoType>('estimate')
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)

  const supabase = createClient()
  const orgId = membership?.organization_id

  useEffect(() => {
    if (!orgId) return
    loadMemos()

    // Realtime subscription
    const channel = supabase
      .channel('memoranda-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memoranda' }, () => {
        loadMemos()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [orgId])

  async function loadMemos() {
    if (!orgId) return
    const { data } = await supabase
      .from('memoranda')
      .select('*')
      .eq('organization_id', orgId)
      .in('status', ['pending', 'in_progress', 'snoozed'])
      .order('priority', { ascending: false })
      .order('due_date', { ascending: true })

    setMemos(data || [])
    setLoading(false)
  }

  async function updateMemoStatus(id: string, status: MemoStatus) {
    await supabase.from('memoranda').update({
      status,
      ...(status === 'done' ? { resolved_at: new Date().toISOString() } : {}),
    }).eq('id', id)
    loadMemos()
  }

  async function createMemo(formData: FormData) {
    const title = formData.get('title') as string
    const memo_type = formData.get('memo_type') as MemoType
    const priority = formData.get('priority') as PriorityLevel
    const due_date = formData.get('due_date') as string
    const description = formData.get('description') as string

    await supabase.from('memoranda').insert({
      organization_id: orgId,
      title,
      memo_type,
      priority: priority || 'medium',
      due_date: due_date || null,
      description: description || null,
      status: 'pending',
      created_by: user?.id,
    })

    setShowForm(false)
    loadMemos()
  }

  const filtered = memos.filter((m) => m.memo_type === activeTab)
  const deadlines = memos.filter((m) => m.memo_type === 'deadline' || m.memo_type === 'reminder')

  if (loading) return <p className="text-slate-500">Caricamento...</p>

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Memorandum</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 touch-target"
        >
          + Nuovo
        </button>
      </div>

      {/* Form nuovo memo */}
      {showForm && (
        <form
          action={createMemo}
          className="bg-white rounded-xl border border-slate-200 p-4 mb-6 space-y-3"
        >
          <input
            name="title"
            placeholder="Titolo"
            required
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <div className="grid grid-cols-3 gap-3">
            <select name="memo_type" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" defaultValue="estimate">
              {Object.entries(MEMO_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <select name="priority" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" defaultValue="medium">
              {Object.entries(PRIORITY_LEVELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <input name="due_date" type="date" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <textarea
            name="description"
            placeholder="Descrizione (opzionale)"
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
              Salva
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
              Annulla
            </button>
          </div>
        </form>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-4">
        {TABS.map((tab) => {
          const count = memos.filter((m) => m.memo_type === tab.key).length
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex-1 py-2 text-sm font-medium rounded-md transition-colors touch-target',
                activeTab === tab.key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {tab.label} {count > 0 && <span className="text-xs opacity-60">({count})</span>}
            </button>
          )
        })}
      </div>

      {/* Lista memo */}
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {filtered.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Nessun elemento in questa categoria</p>
        ) : (
          filtered.map((memo) => (
            <div key={memo.id} className="p-3 flex items-start gap-3">
              <button
                onClick={() => updateMemoStatus(memo.id, 'done')}
                className="mt-0.5 w-5 h-5 rounded border-2 border-slate-300 hover:border-green-500 hover:bg-green-50 flex-shrink-0 touch-target flex items-center justify-center"
                title="Segna come fatto"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">{memo.title}</p>
                {memo.description && (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{memo.description}</p>
                )}
                {memo.due_date && (
                  <p className={cn('text-xs mt-1', daysUntil(memo.due_date) < 0 ? 'text-red-600 font-medium' : 'text-slate-400')}>
                    {daysUntil(memo.due_date) < 0 ? `Scaduto il ${formatDate(memo.due_date)}` : `Scade il ${formatDate(memo.due_date)}`}
                  </p>
                )}
              </div>
              <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${PRIORITY_LEVELS[memo.priority]?.color}`}>
                {PRIORITY_LEVELS[memo.priority]?.label}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Scadenze e promemoria */}
      {deadlines.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-3">Scadenze & Promemoria</h2>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {deadlines.map((memo) => (
              <div key={memo.id} className="p-3 flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${MEMO_TYPES[memo.memo_type]?.color}`}>
                  {MEMO_TYPES[memo.memo_type]?.label}
                </span>
                <p className="text-sm font-medium text-slate-900 flex-1 truncate">{memo.title}</p>
                {memo.due_date && (
                  <span className={cn('text-xs', daysUntil(memo.due_date) < 0 ? 'text-red-600' : 'text-slate-500')}>
                    {formatDate(memo.due_date)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
