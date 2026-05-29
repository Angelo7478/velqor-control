'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import {
  QreSource, QreContent, QreTaxonomy, QreStrategyCandidate, QreChunk,
} from '@/types/database'
import QuantNav from '../quant-nav'

// ============================================================
// Quant Research — libreria della conoscenza (tabelle qre_*)
// Sola lettura. Pipeline: strategy_candidates -> Builder -> Benchmark -> Darwinex
// ============================================================

type View = 'strategie' | 'tassonomia' | 'fonti' | 'grezzo'

const VIEWS: { key: View; label: string; icon: string }[] = [
  { key: 'strategie', label: 'Strategie', icon: '🧪' },
  { key: 'tassonomia', label: 'Tassonomia / Sapere', icon: '📚' },
  { key: 'fonti', label: 'Fonti & Video', icon: '🎬' },
  { key: 'grezzo', label: 'Cerca nel grezzo', icon: '🔎' },
]

const CAND_STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: 'NON VALIDATA', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  queued: { label: 'In coda', cls: 'bg-blue-100 text-blue-700 border-blue-300' },
  testing: { label: 'In test (SQX)', cls: 'bg-violet-100 text-violet-700 border-violet-300' },
  validated: { label: 'Validata', cls: 'bg-green-100 text-green-700 border-green-300' },
  rejected: { label: 'Scartata', cls: 'bg-rose-100 text-rose-700 border-rose-300' },
  parked: { label: 'Parcheggiata', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
}
const CAND_STATUS_ORDER = ['new', 'queued', 'testing', 'validated', 'rejected', 'parked']

const CAT_LABEL: Record<string, { label: string; icon: string }> = {
  asset: { label: 'Asset', icon: '📈' },
  indicator: { label: 'Indicatori', icon: '📐' },
  logic_type: { label: 'Tipo logica', icon: '🧠' },
  edge_type: { label: 'Tipo edge', icon: '⚡' },
  timeframe: { label: 'Timeframe', icon: '⏱️' },
  pattern: { label: 'Pattern', icon: '🔺' },
  setup: { label: 'Setup', icon: '🎯' },
  concept: { label: 'Concetti', icon: '💡' },
  market_condition: { label: 'Condizione mercato', icon: '🌐' },
}

const tfLabel = (s: string) => s.replace(/^tf-/, '').toUpperCase()
const primaryEdge = (e: string | null) =>
  (e || '').split(/[/(]/)[0].trim().toLowerCase()

function videoUrlFrom(text: string | null | undefined): string | null {
  if (!text) return null
  const m = text.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/)
  return m ? `https://www.youtube.com/watch?v=${m[1]}` : null
}

function contentUrl(c: QreContent): string | null {
  if (c.metadata && typeof c.metadata.url === 'string') return c.metadata.url
  if (c.external_id) return `https://www.youtube.com/watch?v=${c.external_id}`
  return null
}

// escape per ilike (rimuove caratteri che romperebbero il filtro .or)
const sanitize = (q: string) => q.replace(/[,%()]/g, ' ').trim()

interface ChunkResult extends QreChunk {
  qre_content?: { title: string; external_id: string | null; metadata: Record<string, any> | null } | null
}

export default function ResearchPage() {
  const [sources, setSources] = useState<QreSource[]>([])
  const [content, setContent] = useState<QreContent[]>([])
  const [taxonomy, setTaxonomy] = useState<QreTaxonomy[]>([])
  const [candidates, setCandidates] = useState<QreStrategyCandidate[]>([])
  const [chunksTotal, setChunksTotal] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [view, setView] = useState<View>('strategie')
  const [query, setQuery] = useState('')

  // filtri (multi-select)
  const [selCats, setSelCats] = useState<Set<string>>(new Set())
  const [selAssets, setSelAssets] = useState<Set<string>>(new Set())
  const [selTfs, setSelTfs] = useState<Set<string>>(new Set())
  const [selEdges, setSelEdges] = useState<Set<string>>(new Set())
  const [selStatuses, setSelStatuses] = useState<Set<string>>(new Set())

  // dettaglio drawer
  const [detail, setDetail] = useState<
    | { kind: 'candidate'; data: QreStrategyCandidate }
    | { kind: 'taxonomy'; data: QreTaxonomy }
    | null
  >(null)

  // ricerca grezzo (live)
  const [rawResults, setRawResults] = useState<ChunkResult[]>([])
  const [rawLoading, setRawLoading] = useState(false)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const [src, cnt, tax, cand, chk] = await Promise.all([
        supabase.from('qre_sources').select('*').order('created_at'),
        supabase.from('qre_content').select('*').order('title'),
        supabase.from('qre_taxonomy').select('*').order('category').order('name'),
        supabase.from('qre_strategy_candidates').select('*').order('confidence_score', { ascending: false }),
        supabase.from('qre_chunks').select('id', { count: 'exact', head: true }),
      ])
      if (src.error) throw src.error
      if (cnt.error) throw cnt.error
      if (tax.error) throw tax.error
      if (cand.error) throw cand.error
      setSources(src.data || [])
      setContent(cnt.data || [])
      setTaxonomy(tax.data || [])
      setCandidates(cand.data || [])
      setChunksTotal(chk.count || 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function searchChunks(raw: string) {
    const q = sanitize(raw)
    if (!q) { setRawResults([]); return }
    setRawLoading(true)
    try {
      const supabase = createClient()
      const { data, error: e } = await supabase
        .from('qre_chunks')
        .select('*, qre_content(title, external_id, metadata)')
        .or(`chunk_text.ilike.%${q}%,summary.ilike.%${q}%,topic.ilike.%${q}%`)
        .limit(60)
      if (e) throw e
      setRawResults((data as ChunkResult[]) || [])
    } catch {
      setRawResults([])
    } finally {
      setRawLoading(false)
    }
  }

  // ricerca grezzo quando si entra nel tab o cambia la query
  useEffect(() => {
    if (view === 'grezzo') {
      const t = setTimeout(() => searchChunks(query), 250)
      return () => clearTimeout(t)
    }
  }, [view, query])

  // ---- opzioni filtri (data-driven) ----
  const categories = useMemo(
    () => [...new Set(taxonomy.map(t => t.category))].sort((a, b) => a.localeCompare(b)),
    [taxonomy]
  )
  const assetOptions = useMemo(() => {
    const s = new Set<string>()
    taxonomy.filter(t => t.category === 'asset').forEach(t => s.add(t.slug))
    candidates.forEach(c => (c.assets || []).forEach(a => s.add(a)))
    return [...s].sort()
  }, [taxonomy, candidates])
  const tfOptions = useMemo(() => {
    const s = new Set<string>()
    taxonomy.filter(t => t.category === 'timeframe').forEach(t => s.add(t.slug))
    candidates.forEach(c => (c.timeframes || []).forEach(t => s.add(t)))
    return [...s].sort()
  }, [taxonomy, candidates])
  const edgeOptions = useMemo(
    () => [...new Set(candidates.map(c => primaryEdge(c.edge_type)).filter(Boolean))].sort(),
    [candidates]
  )

  const q = query.trim().toLowerCase()
  const hit = (s?: string | null) => !q || (!!s && s.toLowerCase().includes(q))

  // ---- candidate filtrate ----
  const filteredCandidates = useMemo(() => candidates.filter(c => {
    if (q && !(hit(c.name) || hit(c.description) || hit(c.logic_summary) || hit(c.notes) || hit(c.edge_type))) return false
    if (selAssets.size && !(c.assets || []).some(a => selAssets.has(a))) return false
    if (selTfs.size && !(c.timeframes || []).some(t => selTfs.has(t))) return false
    if (selEdges.size && !selEdges.has(primaryEdge(c.edge_type))) return false
    if (selStatuses.size && !selStatuses.has(c.status)) return false
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [candidates, q, selAssets, selTfs, selEdges, selStatuses])

  // ---- tassonomia filtrata + raggruppata ad albero ----
  const filteredTaxonomy = useMemo(() => taxonomy.filter(t => {
    if (selCats.size && !selCats.has(t.category)) return false
    if (selAssets.size && t.category === 'asset' && !selAssets.has(t.slug)) return false
    if (selTfs.size && t.category === 'timeframe' && !selTfs.has(t.slug)) return false
    if (q && !(hit(t.name) || hit(t.description) || hit(t.slug))) return false
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [taxonomy, selCats, selAssets, selTfs, q])

  const taxByCategory = useMemo(() => {
    const map = new Map<string, QreTaxonomy[]>()
    filteredTaxonomy.forEach(t => {
      if (!map.has(t.category)) map.set(t.category, [])
      map.get(t.category)!.push(t)
    })
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filteredTaxonomy])

  // ---- contenuti filtrati (fonti & video) ----
  const filteredContent = useMemo(() => content.filter(c =>
    !q || hit(c.title) || hit(c.content_type) || hit(c.status)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [content, q])

  // ---- KPI ----
  const candByStatus = useMemo(() => {
    const m: Record<string, number> = {}
    candidates.forEach(c => { m[c.status] = (m[c.status] || 0) + 1 })
    return m
  }, [candidates])

  const hasAnyFilter = selCats.size || selAssets.size || selTfs.size || selEdges.size || selStatuses.size
  function clearFilters() {
    setSelCats(new Set()); setSelAssets(new Set()); setSelTfs(new Set())
    setSelEdges(new Set()); setSelStatuses(new Set())
  }
  function toggle(set: Set<string>, setter: (s: Set<string>) => void, val: string) {
    const next = new Set(set)
    if (next.has(val)) next.delete(val); else next.add(val)
    setter(next)
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Intestazione */}
      <div>
        <QuantNav />
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mt-1">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Quant Research</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Libreria della conoscenza quant. Pipeline: candidate &rarr; Builder &rarr; Benchmark &rarr; Darwinex.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm">
          Errore caricamento: {error}
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon="🎬" label="Fonti" value={sources.length} sub={`${content.length} video`} />
        <KpiCard icon="📚" label="Tassonomia" value={taxonomy.length} sub={`${categories.length} categorie`} />
        <KpiCard icon="🧪" label="Strategie" value={candidates.length} sub={`${candByStatus['new'] || 0} non validate`} />
        <KpiCard icon="🔎" label="Segmenti" value={chunksTotal} sub={chunksTotal === 0 ? 'in elaborazione' : 'indicizzati'} />
      </div>

      {/* Barra di ricerca globale */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Cerca strategie, concetti, indicatori, video, trascrizioni..."
          className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">✕</button>
        )}
      </div>

      {/* Tab viste */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 overflow-x-auto">
        {VIEWS.map(v => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`flex-1 min-w-fit whitespace-nowrap py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              view === v.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <span className="mr-1">{v.icon}</span>{v.label}
          </button>
        ))}
      </div>

      {/* Filtri contestuali */}
      {(view === 'strategie' || view === 'tassonomia') && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
          {view === 'tassonomia' && (
            <FilterGroup label="Categoria">
              {categories.map(c => (
                <Chip key={c} active={selCats.has(c)} onClick={() => toggle(selCats, setSelCats, c)}>
                  {CAT_LABEL[c]?.icon} {CAT_LABEL[c]?.label || c}
                </Chip>
              ))}
            </FilterGroup>
          )}
          <FilterGroup label="Asset">
            {assetOptions.map(a => (
              <Chip key={a} active={selAssets.has(a)} onClick={() => toggle(selAssets, setSelAssets, a)}>
                {a.toUpperCase()}
              </Chip>
            ))}
          </FilterGroup>
          {view === 'strategie' && (
            <>
              <FilterGroup label="Timeframe">
                {tfOptions.map(t => (
                  <Chip key={t} active={selTfs.has(t)} onClick={() => toggle(selTfs, setSelTfs, t)}>
                    {tfLabel(t)}
                  </Chip>
                ))}
              </FilterGroup>
              {edgeOptions.length > 0 && (
                <FilterGroup label="Edge">
                  {edgeOptions.map(e => (
                    <Chip key={e} active={selEdges.has(e)} onClick={() => toggle(selEdges, setSelEdges, e)}>
                      {e}
                    </Chip>
                  ))}
                </FilterGroup>
              )}
              <FilterGroup label="Stato">
                {CAND_STATUS_ORDER.map(s => (
                  <Chip key={s} active={selStatuses.has(s)} onClick={() => toggle(selStatuses, setSelStatuses, s)}>
                    {CAND_STATUS[s].label}
                  </Chip>
                ))}
              </FilterGroup>
            </>
          )}
          {hasAnyFilter ? (
            <button onClick={clearFilters} className="text-xs text-violet-600 hover:text-violet-800 underline">
              Pulisci filtri
            </button>
          ) : null}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm">Caricamento libreria...</div>
      ) : (
        <>
          {/* ===== VISTA STRATEGIE ===== */}
          {view === 'strategie' && (
            filteredCandidates.length === 0 ? (
              <EmptyState text="Nessuna strategia candidata con questi filtri." />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {filteredCandidates.map(c => {
                  const st = CAND_STATUS[c.status] || CAND_STATUS.new
                  const conf = Math.round((c.confidence_score || 0) * 100)
                  return (
                    <button
                      key={c.id}
                      onClick={() => setDetail({ kind: 'candidate', data: c })}
                      className="text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-violet-300 hover:shadow-sm transition"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-slate-900 leading-snug">{c.name}</h3>
                        <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${st.cls}`}>
                          {st.label}
                        </span>
                      </div>
                      {c.logic_summary && (
                        <p className="text-xs text-slate-500 mt-1.5 line-clamp-2">{c.logic_summary}</p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-2.5">
                        {(c.assets || []).map(a => <Pill key={a} tone="slate">{a.toUpperCase()}</Pill>)}
                        {(c.timeframes || []).map(t => <Pill key={t} tone="blue">{tfLabel(t)}</Pill>)}
                        {c.edge_type && <Pill tone="violet">{primaryEdge(c.edge_type)}</Pill>}
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-violet-500 rounded-full" style={{ width: `${conf}%` }} />
                        </div>
                        <span className="text-[11px] text-slate-500 tabular-nums">conf. {conf}%</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          )}

          {/* ===== VISTA TASSONOMIA ===== */}
          {view === 'tassonomia' && (
            taxByCategory.length === 0 ? (
              <EmptyState text="Nessuna voce con questi filtri." />
            ) : (
              <div className="space-y-3">
                {taxByCategory.map(([cat, items]) => (
                  <div key={cat} className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span>{CAT_LABEL[cat]?.icon || '🏷️'}</span>
                      <h3 className="font-semibold text-slate-900">{CAT_LABEL[cat]?.label || cat}</h3>
                      <span className="text-xs text-slate-400">{items.length}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                      {items.map(t => (
                        <button
                          key={t.id}
                          onClick={() => setDetail({ kind: 'taxonomy', data: t })}
                          className="text-left rounded-lg border border-slate-200 bg-slate-50 hover:bg-white hover:border-violet-300 transition p-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-slate-800">{t.name}</span>
                            <span className="text-[10px] font-mono text-slate-400 shrink-0">{t.slug}</span>
                          </div>
                          {t.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{t.description}</p>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* ===== VISTA FONTI & VIDEO ===== */}
          {view === 'fonti' && (
            <div className="space-y-3">
              {sources.map(s => (
                <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🎬</span>
                      <div>
                        <h3 className="font-semibold text-slate-900">{s.name}</h3>
                        <p className="text-xs text-slate-500">
                          {s.author ? `${s.author} · ` : ''}{s.type.replace(/_/g, ' ')}
                          {s.metadata?.corpus_total ? ` · corpus ${s.metadata.corpus_total}` : ''}
                        </p>
                      </div>
                    </div>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs px-2.5 py-1 rounded-md border border-slate-200 text-violet-600 hover:bg-violet-50 shrink-0">
                        Apri canale ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}

              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="font-semibold text-slate-900">Video catalogati</h3>
                  <span className="text-xs text-slate-400">{filteredContent.length}</span>
                </div>
                {filteredContent.length === 0 ? (
                  <EmptyState text="Nessun video con questa ricerca." compact />
                ) : (
                  <div className="space-y-2">
                    {filteredContent.map(c => {
                      const url = contentUrl(c)
                      const pending = !c.raw_text || c.metadata?.raw_text_pending
                      return (
                        <div key={c.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 leading-snug">{c.title}</p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              <Pill tone={pending ? 'amber' : 'green'}>{pending ? 'in elaborazione' : c.status}</Pill>
                              {c.language && <Pill tone="slate">{c.language.toUpperCase()}</Pill>}
                              {c.content_type && <Pill tone="slate">{c.content_type}</Pill>}
                            </div>
                          </div>
                          {url && (
                            <a href={url} target="_blank" rel="noopener noreferrer"
                              className="text-xs px-2.5 py-1 rounded-md border border-slate-200 text-violet-600 hover:bg-violet-50 shrink-0">
                              YouTube ↗
                            </a>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {chunksTotal === 0 && (
                  <p className="text-xs text-slate-400 mt-3">
                    Trascrizioni complete e segmenti (chunk) verranno indicizzati da un job successivo.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ===== VISTA CERCA NEL GREZZO ===== */}
          {view === 'grezzo' && (
            <div className="space-y-3">
              {chunksTotal === 0 ? (
                <EmptyState text="Nessun segmento ancora indicizzato. La ricerca full-text sulle trascrizioni sarà attiva quando il job di ingestione caricherà i chunk." />
              ) : !query.trim() ? (
                <EmptyState text="Digita sopra per cercare nelle trascrizioni." />
              ) : rawLoading ? (
                <div className="text-center py-10 text-slate-400 text-sm">Ricerca...</div>
              ) : rawResults.length === 0 ? (
                <EmptyState text={`Nessun risultato per "${query}".`} />
              ) : (
                <div className="space-y-2">
                  {rawResults.map(r => {
                    const vid = r.qre_content?.external_id
                    const ts = r.metadata?.start_seconds
                    const url = vid
                      ? `https://www.youtube.com/watch?v=${vid}${ts ? `&t=${Math.floor(ts)}s` : ''}`
                      : null
                    return (
                      <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs font-medium text-slate-600">{r.qre_content?.title || 'Video'}</span>
                          {url && (
                            <a href={url} target="_blank" rel="noopener noreferrer"
                              className="text-[11px] text-violet-600 hover:underline shrink-0">
                              vai al punto ↗
                            </a>
                          )}
                        </div>
                        {r.topic && <Pill tone="violet">{r.topic}</Pill>}
                        <p className="text-sm text-slate-700 mt-1.5 line-clamp-4">{r.summary || r.chunk_text}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ===== DRAWER DETTAGLIO ===== */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDetail(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative w-full max-w-md bg-white h-full shadow-xl overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                {detail.kind === 'candidate' ? 'Strategia candidata' : 'Voce tassonomia'}
              </span>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {detail.kind === 'candidate' ? (
              <CandidateDetail c={detail.data} />
            ) : (
              <TaxonomyDetail t={detail.data} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Sub-componenti
// ============================================================

function KpiCard({ icon, label, value, sub }: { icon: string; label: string; value: number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <span className="text-2xl font-bold text-slate-900 tabular-nums">{value}</span>
      </div>
      <div className="text-[10px] uppercase text-slate-400 mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase text-slate-400 w-16 shrink-0">{label}</span>
      {children}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border transition ${
        active
          ? 'bg-violet-600 text-white border-violet-600'
          : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'
      }`}
    >
      {children}
    </button>
  )
}

function Pill({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'blue' | 'violet' | 'green' | 'amber' }) {
  const map: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600',
    blue: 'bg-blue-100 text-blue-700',
    violet: 'bg-violet-100 text-violet-700',
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-800',
  }
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${map[tone]}`}>{children}</span>
}

function EmptyState({ text, compact }: { text: string; compact?: boolean }) {
  return (
    <div className={`text-center text-slate-400 text-sm ${compact ? 'py-6' : 'py-16'}`}>
      {text}
    </div>
  )
}

function CandidateDetail({ c }: { c: QreStrategyCandidate }) {
  const st = CAND_STATUS[c.status] || CAND_STATUS.new
  const conf = Math.round((c.confidence_score || 0) * 100)
  const video = videoUrlFrom(c.notes)
  const inPipeline = c.status === 'queued' || c.status === 'testing'
  return (
    <div className="p-5 space-y-4">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">{c.name}</h2>
          <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
        </div>
        {c.description && <p className="text-sm text-slate-500 mt-1">{c.description}</p>}
      </div>

      <div className="flex flex-wrap gap-1">
        {(c.assets || []).map(a => <Pill key={a} tone="slate">{a.toUpperCase()}</Pill>)}
        {(c.timeframes || []).map(t => <Pill key={t} tone="blue">{tfLabel(t)}</Pill>)}
        {c.edge_type && <Pill tone="violet">{c.edge_type}</Pill>}
      </div>

      <div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-violet-500 rounded-full" style={{ width: `${conf}%` }} />
          </div>
          <span className="text-xs text-slate-500 tabular-nums">confidenza {conf}%</span>
        </div>
      </div>

      {c.logic_summary && (
        <Section title="Logica">
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.logic_summary}</p>
        </Section>
      )}
      {c.notes && (
        <Section title="Note">
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.notes}</p>
        </Section>
      )}

      {c.status === 'new' && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          Candidata <strong>non validata</strong>: deve passare SQX (Monte Carlo / OOS / Walk Forward Matrix) prima di entrare in pipeline.
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {video && (
          <a href={video} target="_blank" rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded-md border border-slate-200 text-violet-600 hover:bg-violet-50">
            Video sorgente ↗
          </a>
        )}
        {inPipeline && (
          <>
            <a href="/divisioni/quant/builder"
              className="text-xs px-3 py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700">
              Apri nel Builder →
            </a>
            <a href="/divisioni/quant"
              className="text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50">
              Benchmark →
            </a>
          </>
        )}
      </div>

      {(c.source_chunk_ids?.length || 0) > 0 && (
        <p className="text-[11px] text-slate-400">{c.source_chunk_ids!.length} segmenti sorgente collegati</p>
      )}
    </div>
  )
}

function TaxonomyDetail({ t }: { t: QreTaxonomy }) {
  return (
    <div className="p-5 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span>{CAT_LABEL[t.category]?.icon || '🏷️'}</span>
          <span className="text-xs text-slate-400">{CAT_LABEL[t.category]?.label || t.category}</span>
        </div>
        <h2 className="text-lg font-bold text-slate-900 mt-1">{t.name}</h2>
        <span className="text-xs font-mono text-slate-400">{t.slug}</span>
      </div>
      {t.description && (
        <Section title="Descrizione">
          <p className="text-sm text-slate-700">{t.description}</p>
        </Section>
      )}
      {t.metadata && Object.keys(t.metadata).length > 0 && (
        <Section title="Metadata">
          <pre className="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-2 overflow-x-auto">
            {JSON.stringify(t.metadata, null, 2)}
          </pre>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">{title}</h4>
      {children}
    </div>
  )
}
