'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useAuth } from '@/stores/auth'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import type { Event, EventType } from '@/types/database'

const EVENT_COLORS: Record<EventType, string> = {
  meeting: 'bg-blue-500',
  inspection: 'bg-orange-500',
  deadline: 'bg-red-500',
  call: 'bg-green-500',
  task: 'bg-purple-500',
  auction: 'bg-amber-500',
}

const EVENT_LABELS: Record<EventType, string> = {
  meeting: 'Riunione',
  inspection: 'Sopralluogo',
  deadline: 'Scadenza',
  call: 'Chiamata',
  task: 'Task',
  auction: 'Asta',
}

export default function CalendarioPage() {
  const { membership, user } = useAuth()
  const [events, setEvents] = useState<Event[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)

  const supabase = createClient()
  const orgId = membership?.organization_id

  useEffect(() => {
    if (!orgId) return
    loadEvents()
  }, [orgId])

  async function loadEvents() {
    if (!orgId) return
    const { data } = await supabase
      .from('events')
      .select('*')
      .eq('organization_id', orgId)
      .gte('starts_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('starts_at')
      .limit(50)

    setEvents(data || [])
    setLoading(false)
  }

  async function createEvent(formData: FormData) {
    const title = formData.get('title') as string
    const event_type = formData.get('event_type') as EventType
    const starts_at = formData.get('starts_at') as string
    const ends_at = formData.get('ends_at') as string
    const location = formData.get('location') as string

    await supabase.from('events').insert({
      organization_id: orgId,
      title,
      event_type,
      starts_at: new Date(starts_at).toISOString(),
      ends_at: ends_at ? new Date(ends_at).toISOString() : null,
      location: location || null,
    })

    setShowForm(false)
    loadEvents()
  }

  // Group events by date
  const grouped = events.reduce<Record<string, Event[]>>((acc, event) => {
    const date = new Date(event.starts_at).toLocaleDateString('it-IT')
    if (!acc[date]) acc[date] = []
    acc[date].push(event)
    return acc
  }, {})

  const today = new Date().toLocaleDateString('it-IT')

  if (loading) return <p className="text-slate-500">Caricamento...</p>

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Calendario</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 touch-target"
        >
          + Evento
        </button>
      </div>

      {/* Form nuovo evento */}
      {showForm && (
        <form
          action={createEvent}
          className="bg-white rounded-xl border border-slate-200 p-4 mb-6 space-y-3"
        >
          <input
            name="title"
            placeholder="Titolo evento"
            required
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <select name="event_type" className="px-3 py-2 border border-slate-300 rounded-lg text-sm" defaultValue="meeting">
              {Object.entries(EVENT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <input
              name="location"
              placeholder="Luogo (opzionale)"
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">Inizio</label>
              <input name="starts_at" type="datetime-local" required className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500">Fine (opzionale)</label>
              <input name="ends_at" type="datetime-local" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Salva</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600">Annulla</button>
          </div>
        </form>
      )}

      {/* Lista eventi per giorno */}
      {Object.keys(grouped).length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <p className="text-slate-500">Nessun evento in programma</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([date, dayEvents]) => (
            <div key={date}>
              <h3 className={cn(
                'text-sm font-semibold mb-2 px-1',
                date === today ? 'text-blue-600' : 'text-slate-500'
              )}>
                {date === today ? 'Oggi' : date}
              </h3>
              <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
                {dayEvents.map((event) => (
                  <div key={event.id} className="p-3 flex items-start gap-3">
                    <div className={cn('w-2 h-2 rounded-full mt-1.5 flex-shrink-0', EVENT_COLORS[event.event_type])} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">{event.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-slate-500">
                          {new Date(event.starts_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                          {event.ends_at && ` - ${new Date(event.ends_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`}
                        </span>
                        {event.location && (
                          <span className="text-xs text-slate-400">· {event.location}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-slate-400">{EVENT_LABELS[event.event_type]}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
