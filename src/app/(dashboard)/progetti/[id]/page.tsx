'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useAuth } from '@/stores/auth'
import { DIVISIONS, PROJECT_STATUSES, TASK_STATUSES, PRIORITY_LEVELS } from '@/lib/constants'
import { formatDate } from '@/lib/utils'
import type { Project, Task, Note } from '@/types/database'

export default function ProgettoDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { membership, user } = useAuth()
  const [project, setProject] = useState<Project | null>(null)
  const [subProjects, setSubProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [newTask, setNewTask] = useState('')
  const [newNote, setNewNote] = useState('')

  const supabase = createClient()

  useEffect(() => {
    if (!id) return
    loadAll()
  }, [id])

  async function loadAll() {
    const [projRes, subRes, taskRes, noteRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('projects').select('*').eq('parent_project_id', id).order('created_at'),
      supabase.from('tasks').select('*').eq('project_id', id).order('priority', { ascending: false }).order('created_at'),
      supabase.from('notes').select('*').eq('entity_type', 'project').eq('entity_id', id).order('created_at', { ascending: false }).limit(20),
    ])

    setProject(projRes.data)
    setSubProjects(subRes.data || [])
    setTasks(taskRes.data || [])
    setNotes(noteRes.data || [])
  }

  async function addTask() {
    if (!newTask.trim() || !project) return
    await supabase.from('tasks').insert({
      organization_id: project.organization_id,
      project_id: id,
      title: newTask,
      status: 'todo',
      priority: 'medium',
      assigned_to: user?.id,
    })
    setNewTask('')
    loadAll()
  }

  async function toggleTask(taskId: string, currentStatus: string) {
    const newStatus = currentStatus === 'done' ? 'todo' : 'done'
    await supabase.from('tasks').update({ status: newStatus }).eq('id', taskId)
    loadAll()
  }

  async function addNote() {
    if (!newNote.trim() || !project) return
    await supabase.from('notes').insert({
      organization_id: project.organization_id,
      author_id: user?.id,
      content: newNote,
      entity_type: 'project',
      entity_id: id,
      source: 'human',
    })
    setNewNote('')
    loadAll()
  }

  if (!project) return <p className="text-slate-500">Caricamento...</p>

  const div = DIVISIONS[project.module as keyof typeof DIVISIONS]

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/progetti" className="text-sm text-blue-600 hover:underline mb-2 inline-block">&larr; Progetti</Link>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{div?.icon || '📁'}</span>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{project.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs px-2 py-0.5 rounded-full ${PROJECT_STATUSES[project.status]?.color}`}>
                {PROJECT_STATUSES[project.status]?.label}
              </span>
              <span className="text-xs text-slate-400">{div?.label}</span>
              {project.start_date && <span className="text-xs text-slate-400">· dal {formatDate(project.start_date)}</span>}
              {project.budget && <span className="text-xs text-slate-400">· {project.budget.toLocaleString('it-IT')} EUR</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Sotto-progetti */}
        {subProjects.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">Sotto-progetti</h2>
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
              {subProjects.map((sp) => (
                <Link key={sp.id} href={`/progetti/${sp.id}`} className="p-3 flex items-center gap-3 hover:bg-slate-50">
                  <span className="text-sm font-medium text-slate-900 flex-1">{sp.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${PROJECT_STATUSES[sp.status]?.color}`}>
                    {PROJECT_STATUSES[sp.status]?.label}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Tasks */}
        <section>
          <h2 className="text-lg font-semibold text-slate-900 mb-3">Task</h2>
          <div className="bg-white rounded-xl border border-slate-200">
            {/* Add task */}
            <div className="p-3 border-b border-slate-100 flex gap-2">
              <input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTask()}
                placeholder="Aggiungi task..."
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <button onClick={addTask} className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">+</button>
            </div>

            {/* Task list */}
            <div className="divide-y divide-slate-100">
              {tasks.length === 0 ? (
                <p className="p-3 text-sm text-slate-500">Nessun task</p>
              ) : (
                tasks.map((task) => (
                  <div key={task.id} className="p-3 flex items-center gap-3">
                    <button
                      onClick={() => toggleTask(task.id, task.status)}
                      className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center touch-target ${
                        task.status === 'done' ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-green-500'
                      }`}
                    >
                      {task.status === 'done' && '✓'}
                    </button>
                    <span className={`text-sm flex-1 ${task.status === 'done' ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                      {task.title}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${PRIORITY_LEVELS[task.priority]?.color}`}>
                      {PRIORITY_LEVELS[task.priority]?.label}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Note */}
        <section>
          <h2 className="text-lg font-semibold text-slate-900 mb-3">Note</h2>
          <div className="bg-white rounded-xl border border-slate-200">
            <div className="p-3 border-b border-slate-100 flex gap-2">
              <input
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addNote()}
                placeholder="Aggiungi nota..."
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <button onClick={addNote} className="px-3 py-2 bg-slate-700 text-white text-sm rounded-lg hover:bg-slate-800">+</button>
            </div>
            <div className="divide-y divide-slate-100">
              {notes.length === 0 ? (
                <p className="p-3 text-sm text-slate-500">Nessuna nota</p>
              ) : (
                notes.map((note) => (
                  <div key={note.id} className="p-3">
                    <p className="text-sm text-slate-700">{note.content}</p>
                    <p className="text-xs text-slate-400 mt-1">{formatDate(note.created_at)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
