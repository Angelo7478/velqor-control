'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useAuth } from '@/stores/auth'
import { TASK_STATUSES, PRIORITY_LEVELS } from '@/lib/constants'
import { cn, formatDate, isOverdue } from '@/lib/utils'
import type { Task } from '@/types/database'

export default function TaskPage() {
  const { membership } = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState<'active' | 'done'>('active')
  const [loading, setLoading] = useState(true)

  const supabase = createClient()
  const orgId = membership?.organization_id

  useEffect(() => {
    if (!orgId) return
    loadTasks()
  }, [orgId, filter])

  async function loadTasks() {
    if (!orgId) return
    let query = supabase
      .from('tasks')
      .select('*')
      .eq('organization_id', orgId)

    if (filter === 'active') {
      query = query.in('status', ['todo', 'in_progress', 'blocked'])
    } else {
      query = query.eq('status', 'done')
    }

    const { data } = await query
      .order('priority', { ascending: false })
      .order('due_date', { ascending: true })
      .limit(100)

    setTasks(data || [])
    setLoading(false)
  }

  async function toggleTask(id: string, currentStatus: string) {
    const newStatus = currentStatus === 'done' ? 'todo' : 'done'
    await supabase.from('tasks').update({ status: newStatus }).eq('id', id)
    loadTasks()
  }

  if (loading) return <p className="text-slate-500">Caricamento...</p>

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Task</h1>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setFilter('active')}
          className={cn('px-3 py-1.5 rounded-full text-sm font-medium', filter === 'active' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600')}
        >
          Attivi ({filter === 'active' ? tasks.length : '...'})
        </button>
        <button
          onClick={() => setFilter('done')}
          className={cn('px-3 py-1.5 rounded-full text-sm font-medium', filter === 'done' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600')}
        >
          Completati
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {tasks.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Nessun task {filter === 'active' ? 'attivo' : 'completato'}</p>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="p-3 flex items-center gap-3">
              <button
                onClick={() => toggleTask(task.id, task.status)}
                className={cn(
                  'w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center touch-target',
                  task.status === 'done' ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-green-500'
                )}
              >
                {task.status === 'done' && '✓'}
              </button>
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm', task.status === 'done' ? 'line-through text-slate-400' : 'text-slate-900 font-medium')}>
                  {task.title}
                </p>
                {task.due_date && (
                  <p className={cn('text-xs mt-0.5', task.due_date && isOverdue(task.due_date) && task.status !== 'done' ? 'text-red-600' : 'text-slate-400')}>
                    Scade il {formatDate(task.due_date)}
                  </p>
                )}
              </div>
              <span className={`text-xs px-1.5 py-0.5 rounded ${PRIORITY_LEVELS[task.priority]?.color}`}>
                {PRIORITY_LEVELS[task.priority]?.label}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
