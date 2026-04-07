'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelAccount } from '@/types/database'

// Normalize header/key strings — remove BOM, non-breaking spaces, zero-width chars
function cleanKey(s: string): string {
  return s.replace(/[\u00A0\u200B\u200C\u200D\uFEFF\u200E\u200F\r\n]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// Deduplicate headers: "prezzo", "prezzo" → "prezzo", "prezzo_2"
function deduplicateHeaders(headers: string[]): string[] {
  const counts: Record<string, number> = {}
  return headers.map(h => {
    if (counts[h] !== undefined) {
      counts[h]++
      return `${h}_${counts[h]}`
    }
    counts[h] = 1
    return h
  })
}

export default function ImportTradePage() {
  const [accounts, setAccounts] = useState<QelAccount[]>([])
  const [selectedAccount, setSelectedAccount] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [csvText, setCsvText] = useState('')
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([])
  const [preview, setPreview] = useState<Record<string, string>[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)
  const [strategies, setStrategies] = useState<{ id: string; magic: number; name: string | null }[]>([])
  const [progress, setProgress] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // --- Import mode toggle ---
  const [importMode, setImportMode] = useState<'trades' | 'sqx_tests'>('trades')

  // --- SQX Test import state ---
  const [sqxText, setSqxText] = useState('')
  const [sqxParsed, setSqxParsed] = useState<{ magic: number; strategyId: string; strategyName: string; trades: number; winPct: number; payoff: number; expectancy: number; maxDd: number; retDd: number; mc95Dd: number; stability: number; avgWin: number; avgLoss: number; maxConsecLoss: number; worstTrade: number; ulcerIndex: number; exposurePct: number; overlapMed: number; overlapMax: number }[]>([])
  const [sqxImporting, setSqxImporting] = useState(false)
  const [sqxResult, setSqxResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)
  const [sqxProgress, setSqxProgress] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const supabase = createClient()
    const [accRes, stratRes] = await Promise.all([
      supabase.from('qel_accounts').select('*').order('name'),
      supabase.from('qel_strategies').select('id,magic,name'),
    ])
    setAccounts(accRes.data || [])
    setStrategies(stratRes.data || [])
    setLoading(false)
  }

  function parseHTML(html: string): Record<string, string>[] {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const tables = doc.querySelectorAll('table')
    if (tables.length === 0) return []

    let bestTable = tables[0]
    for (const t of tables) {
      if (t.rows.length > bestTable.rows.length) bestTable = t
    }

    // Find header row: first row with 5+ cells containing trade-related keywords
    // MT5 HTML has ~7 title/metadata rows before the actual header
    let headerIdx = 0
    const tradeKeywords = ['time', 'symbol', 'profit', 'position', 'type', 'volume', 'price', 'deal', 'order', 'swap', 'commission', 'simbolo', 'profitto', 'prezzo']
    for (let r = 0; r < Math.min(bestTable.rows.length, 20); r++) {
      const cells = bestTable.rows[r].cells
      if (cells.length < 5) continue
      const text = Array.from(cells).map(c => (c.textContent || '').toLowerCase()).join(' ')
      if (tradeKeywords.some(kw => text.includes(kw))) {
        headerIdx = r
        break
      }
    }

    const headerRow = bestTable.rows[headerIdx]
    if (!headerRow) return []
    // Skip hidden cells in header too
    const rawHeaders = Array.from(headerRow.cells)
      .filter(c => !c.classList.contains('hidden'))
      .map(c => cleanKey(c.textContent || ''))
    const headers = deduplicateHeaders(rawHeaders)

    const rows: Record<string, string>[] = []
    let hasDataRows = false
    for (let i = headerIdx + 1; i < bestTable.rows.length; i++) {
      const cells = bestTable.rows[i].cells
      // Section boundary: spacer/header row after data started → stop
      if (cells.length < 3) {
        if (hasDataRows) break
        continue
      }
      if (cells[0].tagName === 'TH') {
        if (hasDataRows) break
        continue
      }
      hasDataRows = true
      const row: Record<string, string> = {}
      let mt5Strategy = ''
      let hIdx = 0
      for (let c = 0; c < cells.length; c++) {
        if (cells[c].classList.contains('hidden')) {
          mt5Strategy = cells[c].textContent?.trim() || ''
          continue // skip hidden, don't advance header index
        }
        if (hIdx < headers.length) {
          row[headers[hIdx]] = cells[c].textContent?.trim() || ''
        }
        hIdx++
      }
      if (mt5Strategy) row['_mt5_strategy'] = mt5Strategy
      rows.push(row)
    }
    return rows
  }

  function parseCSV(text: string): Record<string, string>[] {
    if (text.trim().startsWith('<') || text.includes('<table') || text.includes('<tr')) {
      return parseHTML(text)
    }

    const lines = text.trim().split('\n')
    if (lines.length < 2) return []

    const firstLine = lines[0]
    const sep = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ','

    const rawHeaders = lines[0].split(sep).map(h => cleanKey(h.replace(/^["']|["']$/g, '')))
    const headers = deduplicateHeaders(rawHeaders)
    const rows: Record<string, string>[] = []

    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(sep).map(v => v.trim().replace(/^["']|["']$/g, ''))
      if (vals.length < 3) continue
      const row: Record<string, string> = {}
      headers.forEach((h, j) => { row[h] = vals[j] || '' })
      rows.push(row)
    }
    return rows
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Detect UTF-16LE BOM (FF FE) before reading text
    const bomReader = new FileReader()
    bomReader.onload = (ev) => {
      const buf = ev.target?.result as ArrayBuffer
      const bom = new Uint8Array(buf, 0, 2)
      const isUtf16LE = bom[0] === 0xFF && bom[1] === 0xFE

      const textReader = new FileReader()
      textReader.onload = (ev2) => {
        const text = ev2.target?.result as string
        setCsvText(text)
        const rows = parseCSV(text)
        setParsedRows(rows)
        setPreview(rows.slice(0, 5))
        setResult(null)
      }
      textReader.readAsText(file, isUtf16LE ? 'utf-16le' : 'utf-8')
    }
    bomReader.readAsArrayBuffer(file.slice(0, 2))
  }

  function handlePaste(text: string) {
    setCsvText(text)
    const rows = parseCSV(text)
    setParsedRows(rows)
    setPreview(rows.slice(0, 5))
    setResult(null)
  }

  // Map CSV columns to our trade fields
  function mapRow(rawRow: Record<string, string>, headers: string[], volumeIsLots: boolean): Record<string, unknown> | null {
    // Normalize all keys
    const row: Record<string, string> = {}
    for (const [k, v] of Object.entries(rawRow)) {
      row[cleanKey(k)] = v
    }

    // Normalize MT5 dot-dates (2025.01.15 14:30:00 → 2025-01-15 14:30:00)
    const fixDate = (d: string) => d.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3')

    // FTMO Italian + English + MT5 HTML column names
    // MT5 HTML has duplicate columns: time/time_2, price/price_2 (via deduplicateHeaders)
    const openTime = fixDate(row['apri'] || row['open time'] || row['open_time'] || row['opentime'] || row['time'] || row['open date'] || row['data apertura'] || '')
    const closeTime = fixDate(row['chiudi'] || row['close time'] || row['close_time'] || row['closetime'] || row['time_2'] || row['close date'] || row['data chiusura'] || '')
    const symbol = row['simbolo'] || row['symbol'] || row['instrument'] || row['strumento'] || ''
    const direction = row['tipologia'] || row['action'] || row['type'] || row['direction'] || row['tipo'] || row['side'] || ''
    const profit = row['profitto'] || row['profit'] || row['p/l'] || row['pnl'] || ''
    const commission = row['commissioni'] || row['commissione'] || row['commission'] || row['comm'] || row['fee'] || ''
    const swap = row['swap'] || ''
    const ticket = row['ticket'] || row['order'] || row['deal'] || row['position'] || row['id'] || ''
    const sl = row['sl'] || row['s/l'] || row['s / l'] || row['stop loss'] || row['stoploss'] || ''
    const tp = row['tp'] || row['t/p'] || row['t / p'] || row['take profit'] || row['takeprofit'] || ''
    const pips = row['pips'] || ''
    const durationCol = row['durata del trade in secondi'] || row['duration'] || ''
    const comment = row['comment'] || row['commento'] || ''

    // Open price: "prezzo" (first occurrence), or MT5 "price"
    const openPrice = row['prezzo'] || row['open price'] || row['open_price'] || row['openprice'] || row['prezzo apertura'] || row['price'] || ''

    // Close price: deduped "prezzo_2"/"price_2", or explicit close price columns
    let closePrice = row['prezzo_2'] || row['price_2'] || row['prezzo chiusura'] || row['close price'] || row['close_price'] || row['closeprice'] || ''

    let magic = row['magic'] || row['magic number'] || row['magic_number'] || row['expert id'] || ''
    let lots = row['lotti'] || row['lots'] || row['size'] || ''
    const volume = row['volume'] || ''

    // Volume handling: depends on CSV format
    if (volumeIsLots) {
      // FTMO Trading Journal export: volume = actual lot size
      if (volume && !lots) lots = volume
    } else {
      // Other FTMO format: volume might be magic number (small integers like 3, 8, 12)
      const volumeNum = parseFloat(volume)
      if (volume && volumeNum > 0 && volumeNum <= 50 && Number.isInteger(volumeNum) && !magic) {
        magic = volume
        lots = ''
      } else if (volume && !lots) {
        lots = volume
      }
    }

    // Positional close price fallback: column right after 'chiudi'
    if (!closePrice && headers.length > 9) {
      const chiudiIdx = headers.indexOf('chiudi')
      if (chiudiIdx >= 0 && chiudiIdx + 1 < headers.length) {
        const nextCol = headers[chiudiIdx + 1]
        const nextVal = row[nextCol]
        if (nextVal && !isNaN(parseFloat(nextVal))) {
          closePrice = nextVal
        }
      }
    }

    // Skip MT5 balance/deposit/withdrawal rows (no symbol)
    if (!symbol || !openTime) return null
    const symbolLower = symbol.toLowerCase()
    if (symbolLower === 'balance' || symbolLower === 'credit' || symbolLower === 'deposit' || symbolLower === 'withdrawal') return null

    // Parse direction
    let dir: 'buy' | 'sell' = 'buy'
    const dirLower = direction.toLowerCase()
    if (dirLower.includes('sell') || dirLower.includes('short') || dirLower === 's' || dirLower === '1') {
      dir = 'sell'
    }

    const profitNum = parseFloat(profit) || 0
    const commNum = parseFloat(commission) || 0
    const feeNum = parseFloat(row['fee'] || '') || 0
    const swapNum = parseFloat(swap) || 0
    const netProfit = profitNum + commNum + feeNum + swapNum
    const lotsNum = parseFloat(lots) || 0
    const magicNum = parseInt(magic) || 0
    const ticketNum = parseInt(ticket) || Math.floor(Date.parse(openTime) / 1000 + Math.random() * 10000)

    // Duration: use column if available, otherwise calculate
    let durationSeconds: number | null = null
    if (durationCol && !isNaN(parseInt(durationCol))) {
      durationSeconds = parseInt(durationCol)
    } else if (openTime && closeTime) {
      const openDt = new Date(openTime)
      const closeDt = new Date(closeTime)
      if (!isNaN(openDt.getTime()) && !isNaN(closeDt.getTime())) {
        durationSeconds = Math.floor((closeDt.getTime() - openDt.getTime()) / 1000)
      }
    }

    return {
      ticket: ticketNum,
      magic: magicNum || null,
      symbol,
      direction: dir,
      lots: lotsNum,
      open_price: parseFloat(openPrice) || 0,
      close_price: parseFloat(closePrice) || null,
      sl: parseFloat(sl) || null,
      tp: parseFloat(tp) || null,
      open_time: openTime,
      close_time: closeTime || null,
      profit: profitNum,
      commission: commNum + feeNum,
      swap: swapNum,
      net_profit: netProfit,
      duration_seconds: durationSeconds,
      is_open: !closeTime,
    }
  }

  async function importTrades() {
    if (!selectedAccount) { setResult({ imported: 0, skipped: 0, errors: ['Seleziona un conto'] }); return }
    const rows = parsedRows
    if (rows.length === 0) { setResult({ imported: 0, skipped: 0, errors: ['Nessuna riga trovata nel CSV'] }); return }

    setImporting(true)
    setResult(null)
    setProgress('Analisi dati...')
    const supabase = createClient()
    const stratMap = new Map(strategies.map(s => [s.magic, s.id]))

    let imported = 0
    let skipped = 0
    const errors: string[] = []

    const allHeaders = rows.length > 0 ? Object.keys(rows[0]).map(cleanKey) : []

    // Pre-scan: detect if 'volume' column contains lot sizes (decimals) or magic numbers (integers)
    const volumeKey = Object.keys(rows[0] || {}).find(k => cleanKey(k) === 'volume')
    let volumeIsLots = false
    if (volumeKey) {
      const hasDecimals = rows.some(r => {
        const v = parseFloat(r[volumeKey] || '')
        return v > 0 && !Number.isInteger(v)
      })
      volumeIsLots = hasDecimals
    }

    console.log('=== IMPORT ===', { rows: rows.length, headers: allHeaders, volumeIsLots })

    const trades: Record<string, unknown>[] = []
    for (const row of rows) {
      const mapped = mapRow(row, allHeaders, volumeIsLots)
      if (!mapped) { skipped++; continue }
      mapped.account_id = selectedAccount
      if (mapped.magic && stratMap.has(mapped.magic as number)) {
        mapped.strategy_id = stratMap.get(mapped.magic as number)
      }
      trades.push(mapped)
    }

    if (trades.length === 0) {
      setResult({ imported: 0, skipped, errors: ['Nessun trade valido trovato. Verifica che il CSV contenga colonne: Ticket, Apri, Simbolo, Prezzo, Profitto'] })
      setImporting(false)
      setProgress('')
      return
    }

    // Upsert in batches of 50 with try/catch
    const batchSize = 50
    const totalBatches = Math.ceil(trades.length / batchSize)

    for (let i = 0; i < trades.length; i += batchSize) {
      const batchNum = Math.floor(i / batchSize) + 1
      setProgress(`Batch ${batchNum}/${totalBatches} (${Math.min(i + batchSize, trades.length)}/${trades.length} trade)...`)

      const batch = trades.slice(i, i + batchSize)
      try {
        const { error } = await supabase.from('qel_trades').upsert(batch, { onConflict: 'account_id,ticket' })
        if (error) {
          console.error('Batch error:', error)
          errors.push(`Batch ${batchNum}: ${error.message}`)
        } else {
          imported += batch.length
        }
      } catch (err) {
        console.error('Batch exception:', err)
        errors.push(`Batch ${batchNum}: ${err instanceof Error ? err.message : 'Errore rete'}`)
      }
    }

    setResult({ imported, skipped, errors })
    setImporting(false)
    setProgress('')
  }

  // --- SQX Test parsing ---
  const SQX_HEADER_MAP: Record<string, string> = {
    'magic': 'magic', 'trades': 'trades', 'win%': 'winPct', 'win %': 'winPct',
    'avgwin': 'avgWin', 'avg win': 'avgWin', 'avgloss': 'avgLoss', 'avg loss': 'avgLoss',
    'payoff': 'payoff', 'expectancy': 'expectancy', 'loss consec max': 'maxConsecLoss',
    'worsttrade': 'worstTrade', 'worst trade': 'worstTrade', 'maxdd': 'maxDd', 'max dd': 'maxDd',
    'ret/dd': 'retDd', 'mc95%dd': 'mc95Dd', 'mc95% dd': 'mc95Dd', 'mc 95% dd': 'mc95Dd',
    'stability': 'stability', 'ulcer index %': 'ulcerIndex', 'ulcer index': 'ulcerIndex',
    'exposure %': 'exposurePct', 'exposure': 'exposurePct',
    'overlapmed': 'overlapMed', 'overlap med': 'overlapMed',
    'overlapmax': 'overlapMax', 'overlap max': 'overlapMax',
  }

  function parseSqxMetriche(text: string) {
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length < 2) return []
    // Detect separator
    const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
    const rawHeaders = lines[0].split(sep).map(h => h.replace(/"/g, '').trim())
    const headerMap: number[] = [] // index in rawHeaders for each mapped field
    const fieldNames: string[] = []
    rawHeaders.forEach((h, idx) => {
      const key = cleanKey(h)
      if (SQX_HEADER_MAP[key]) {
        headerMap.push(idx)
        fieldNames.push(SQX_HEADER_MAP[key])
      }
    })

    const stratMap = new Map(strategies.map(s => [s.magic, { id: s.id, name: s.name || `M${s.magic}` }]))
    const results: typeof sqxParsed = []
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(sep).map(c => c.replace(/"/g, '').trim())
      const obj: Record<string, number> = {}
      fieldNames.forEach((field, idx) => {
        const val = cells[headerMap[idx]] || ''
        obj[field] = parseFloat(val.replace(',', '.').replace('%', '')) || 0
      })
      const magic = Math.round(obj.magic || 0)
      if (magic === 0) continue
      const strat = stratMap.get(magic)
      if (!strat) continue
      results.push({
        magic,
        strategyId: strat.id,
        strategyName: strat.name,
        trades: Math.round(obj.trades || 0),
        winPct: obj.winPct || 0,
        payoff: obj.payoff || 0,
        expectancy: obj.expectancy || 0,
        maxDd: Math.abs(obj.maxDd || 0),
        retDd: obj.retDd || 0,
        mc95Dd: Math.abs(obj.mc95Dd || 0),
        stability: obj.stability || 0,
        avgWin: Math.abs(obj.avgWin || 0),
        avgLoss: Math.abs(obj.avgLoss || 0),
        maxConsecLoss: Math.round(obj.maxConsecLoss || 0),
        worstTrade: obj.worstTrade || 0,
        ulcerIndex: obj.ulcerIndex || 0,
        exposurePct: obj.exposurePct || 0,
        overlapMed: obj.overlapMed || 0,
        overlapMax: obj.overlapMax || 0,
      })
    }
    return results
  }

  function handleSqxPaste(text: string) {
    setSqxText(text)
    setSqxResult(null)
    const parsed = parseSqxMetriche(text)
    setSqxParsed(parsed)
  }

  async function importSqxTests() {
    if (sqxParsed.length === 0) return
    setSqxImporting(true)
    setSqxResult(null)
    const supabase = createClient()
    let imported = 0
    let skipped = 0
    const errors: string[] = []
    const today = new Date().toISOString().slice(0, 10)

    for (const row of sqxParsed) {
      setSqxProgress(`Importando M${row.magic} ${row.strategyName}...`)
      try {
        // Insert into qel_strategy_tests
        const { error: insertErr } = await supabase.from('qel_strategy_tests').insert({
          strategy_id: row.strategyId,
          test_type: 'wfm',
          test_date: today,
          trades: row.trades,
          win_pct: row.winPct,
          payoff: row.payoff,
          expectancy: row.expectancy,
          max_dd: row.maxDd,
          ret_dd: row.retDd,
          mc95_dd: row.mc95Dd,
          stability: row.stability,
          parameters: {
            avg_win: row.avgWin,
            avg_loss: row.avgLoss,
            max_consec_loss: row.maxConsecLoss,
            worst_trade: row.worstTrade,
            ulcer_index: row.ulcerIndex,
            exposure_pct: row.exposurePct,
            overlap_med: row.overlapMed,
            overlap_max: row.overlapMax,
          },
          notes: `Import SQX ${today}`,
        })
        if (insertErr) { errors.push(`M${row.magic}: ${insertErr.message}`); skipped++; continue }

        // Update qel_strategies.test_* with latest values
        const { error: updateErr } = await supabase.from('qel_strategies').update({
          test_trades: row.trades,
          test_win_pct: row.winPct,
          test_payoff: row.payoff,
          test_expectancy: row.expectancy,
          test_max_dd: row.maxDd,
          test_ret_dd: row.retDd,
          test_mc95_dd: row.mc95Dd,
          test_stability: row.stability,
          test_avg_win: row.avgWin,
          test_avg_loss: row.avgLoss,
          test_max_consec_loss: row.maxConsecLoss,
          test_worst_trade: row.worstTrade,
          test_ulcer_index: row.ulcerIndex,
          test_exposure_pct: row.exposurePct,
          test_overlap_med: row.overlapMed,
          test_overlap_max: row.overlapMax,
        }).eq('id', row.strategyId)
        if (updateErr) errors.push(`M${row.magic} update: ${updateErr.message}`)

        imported++
      } catch (err) {
        errors.push(`M${row.magic}: ${err instanceof Error ? err.message : 'Errore'}`)
        skipped++
      }
    }

    setSqxResult({ imported, skipped, errors })
    setSqxImporting(false)
    setSqxProgress('')
  }

  if (loading) return <p className="text-slate-500 p-4">Caricamento...</p>

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <a href="/divisioni/quant/conti" className="text-sm text-violet-600 hover:text-violet-800">&larr; Torna a Conti</a>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">
          {importMode === 'trades' ? 'Import Trade da CSV' : 'Import Test SQX'}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {importMode === 'trades'
            ? 'Importa lo storico completo da FTMO, MT5 o qualsiasi CSV'
            : 'Importa risultati Walk Forward Matrix e Monte Carlo da SQX'}
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 mb-4">
        <button onClick={() => setImportMode('trades')}
          className={`px-4 py-2 text-sm rounded-lg border transition ${importMode === 'trades' ? 'bg-violet-50 border-violet-300 text-violet-700 font-medium' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
          Trade
        </button>
        <button onClick={() => setImportMode('sqx_tests')}
          className={`px-4 py-2 text-sm rounded-lg border transition ${importMode === 'sqx_tests' ? 'bg-violet-50 border-violet-300 text-violet-700 font-medium' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
          Test SQX
        </button>
      </div>

      {/* ===================== SQX TESTS MODE ===================== */}
      {importMode === 'sqx_tests' ? (
        <>
          {/* SQX: Paste area */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">1. Incolla i dati SQX (Metriche)</h3>
            <textarea value={sqxText}
              onChange={e => handleSqxPaste(e.target.value)}
              placeholder={"Apri QEL_MASTER.xlsx → sheet Metriche → seleziona tutte le righe → Ctrl+C → incolla qui\n\nFormato atteso (separato da tab/virgola/punto e virgola):\nMagic\tTrades\tWin%\tPayoff\tExpectancy\tMaxDD\tMC95%DD\t..."}
              className="w-full h-40 px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono resize-y" />
            <p className="text-xs text-slate-400 mt-1">
              Colonne riconosciute: Magic, Trades, Win%, AvgWin, AvgLoss, Payoff, Expectancy, Loss Consec Max, WorstTrade, MaxDD, Ret/DD, MC95%DD, Stability, Ulcer Index %, Exposure %, OverlapMed, OverlapMax
            </p>
          </div>

          {/* SQX: Preview */}
          {sqxParsed.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">
                2. Anteprima ({sqxParsed.length} strategie trovate)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th className="text-left py-1.5 px-2 font-medium">Magic</th>
                      <th className="text-left py-1.5 px-2 font-medium">Strategia</th>
                      <th className="text-right py-1.5 px-2 font-medium">Trade</th>
                      <th className="text-right py-1.5 px-2 font-medium">Win%</th>
                      <th className="text-right py-1.5 px-2 font-medium">Payoff</th>
                      <th className="text-right py-1.5 px-2 font-medium">Expectancy</th>
                      <th className="text-right py-1.5 px-2 font-medium">MaxDD</th>
                      <th className="text-right py-1.5 px-2 font-medium">MC95%DD</th>
                      <th className="text-right py-1.5 px-2 font-medium">Ret/DD</th>
                      <th className="text-right py-1.5 px-2 font-medium">Stability</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sqxParsed.map(r => (
                      <tr key={r.magic}>
                        <td className="py-1.5 px-2 font-mono text-slate-600">M{r.magic}</td>
                        <td className="py-1.5 px-2 text-slate-800 truncate max-w-[160px]">{r.strategyName}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{r.trades}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{r.winPct.toFixed(1)}%</td>
                        <td className="py-1.5 px-2 text-right font-mono">{r.payoff.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right font-mono">${r.expectancy.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-red-600">${r.maxDd.toFixed(0)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-red-600">${r.mc95Dd.toFixed(0)}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{r.retDd.toFixed(1)}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{r.stability.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SQX: Import button */}
          {sqxParsed.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
              <div className="flex items-center gap-3">
                <button onClick={importSqxTests} disabled={sqxImporting}
                  className="px-6 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
                  {sqxImporting ? 'Importazione...' : `Importa ${sqxParsed.length} test WFM`}
                </button>
                {sqxImporting && sqxProgress && <span className="text-sm text-violet-600 animate-pulse">{sqxProgress}</span>}
              </div>
              <p className="text-xs text-slate-400 mt-2">Inserisce in qel_strategy_tests + aggiorna qel_strategies.test_*</p>
            </div>
          )}

          {/* SQX: Result */}
          {sqxResult && (
            <div className={`rounded-xl border p-4 mb-4 ${sqxResult.errors.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
              <h3 className={`text-sm font-semibold mb-2 ${sqxResult.errors.length > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                Risultato import test
              </h3>
              <div className="flex gap-4 text-sm">
                <span className="text-green-700 font-medium">{sqxResult.imported} importati</span>
                {sqxResult.skipped > 0 && <span className="text-slate-500">{sqxResult.skipped} saltati</span>}
                {sqxResult.errors.length > 0 && <span className="text-red-600">{sqxResult.errors.length} errori</span>}
              </div>
              {sqxResult.errors.length > 0 && (
                <div className="mt-2 text-xs text-red-600 space-y-1">
                  {sqxResult.errors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
            </div>
          )}

          {/* SQX: Help */}
          <div className="bg-violet-50 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-violet-700 mb-2">Come esportare da SQX</h3>
            <ol className="text-xs text-violet-600 space-y-1 list-decimal list-inside">
              <li>Apri <strong>QEL_MASTER.xlsx</strong> in Excel/Google Sheets</li>
              <li>Vai al foglio <strong>Metriche</strong></li>
              <li>Seleziona tutte le righe (header + dati) con Ctrl+A</li>
              <li>Copia con Ctrl+C</li>
              <li>Torna qui e incolla con Ctrl+V nel box sopra</li>
            </ol>
            <p className="text-xs text-violet-500 mt-2">Ogni import crea un nuovo snapshot storico nella tabella qel_strategy_tests e aggiorna i campi test_* sulle strategie.</p>
          </div>
        </>
      ) : (
      <>
      {/* ===================== TRADES MODE (original) ===================== */}

      {/* Step 1: Select account */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">1. Seleziona il conto</h3>
        <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
          <option value="">— Scegli conto —</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name} ({a.broker} · ${Number(a.account_size).toLocaleString()})</option>
          ))}
        </select>
      </div>

      {/* Step 2: Upload CSV */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">2. Carica il CSV</h3>
        <div className="space-y-3">
          <div>
            <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,.html,.htm" onChange={handleFile}
              className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100" />
            <p className="text-xs text-slate-400 mt-1">Supporta: CSV, TSV, HTML (export FTMO)</p>
          </div>
          <div className="text-center text-xs text-slate-400">oppure incolla qui sotto (tabella HTML o testo CSV)</div>
          <textarea value={csvText}
            onChange={e => handlePaste(e.target.value)}
            onPaste={e => {
              const html = e.clipboardData.getData('text/html')
              if (html && html.includes('<t')) {
                e.preventDefault()
                handlePaste(html)
              }
            }}
            placeholder="Copia la tabella trade da FTMO e incollala qui (Ctrl+V)&#10;&#10;Oppure CSV:&#10;Open Time,Close Time,Symbol,Action,Volume,Open Price,Close Price,Commission,Swap,Profit,Magic"
            className="w-full h-32 px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono resize-y" />
        </div>
      </div>

      {/* Preview */}
      {preview.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">
            3. Anteprima ({parsedRows.length} righe trovate)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  {Object.keys(preview[0]).slice(0, 12).map(h => (
                    <th key={h} className="text-left py-1.5 px-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.map((row, i) => (
                  <tr key={i}>
                    {Object.values(row).slice(0, 12).map((v, j) => (
                      <td key={j} className="py-1.5 px-2 text-slate-700 truncate max-w-[120px]">{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.length < parsedRows.length && (
            <p className="text-xs text-slate-400 mt-2">Mostrate prime 5 righe di {parsedRows.length}</p>
          )}
        </div>
      )}

      {/* Import button */}
      {preview.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
          <div className="flex items-center gap-3">
            <button onClick={importTrades} disabled={importing || !selectedAccount}
              className="px-6 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
              {importing ? `Importazione...` : `Importa ${parsedRows.length} trade`}
            </button>
            {!selectedAccount && <span className="text-sm text-amber-600">Seleziona prima un conto</span>}
            {importing && progress && <span className="text-sm text-violet-600 animate-pulse">{progress}</span>}
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`rounded-xl border p-4 mb-4 ${result.errors.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
          <h3 className={`text-sm font-semibold mb-2 ${result.errors.length > 0 ? 'text-amber-700' : 'text-green-700'}`}>
            Risultato import
          </h3>
          <div className="flex gap-4 text-sm">
            <span className="text-green-700 font-medium">{result.imported} importati</span>
            {result.skipped > 0 && <span className="text-slate-500">{result.skipped} saltati</span>}
            {result.errors.length > 0 && <span className="text-red-600">{result.errors.length} errori</span>}
          </div>
          {result.errors.length > 0 && (
            <div className="mt-2 text-xs text-red-600 space-y-1">
              {result.errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}
        </div>
      )}

      {/* Help */}
      <div className="bg-violet-50 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-violet-700 mb-2">Come importare da FTMO</h3>
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-violet-700 mb-1">Metodo 1: Copia-incolla (piu facile)</p>
            <ol className="text-xs text-violet-600 space-y-1 list-decimal list-inside">
              <li>Vai su <strong>app.ftmo.com</strong> &rarr; il tuo conto &rarr; <strong>Metriche</strong></li>
              <li>Seleziona tutta la tabella trade con il mouse</li>
              <li>Ctrl+C per copiare</li>
              <li>Torna qui, seleziona il conto, clicca nel box e Ctrl+V</li>
            </ol>
          </div>
          <div>
            <p className="text-xs font-medium text-violet-700 mb-1">Metodo 2: File CSV</p>
            <ol className="text-xs text-violet-600 space-y-1 list-decimal list-inside">
              <li>Su FTMO, vai al <strong>Trading Journal</strong></li>
              <li>Clicca su <strong>Export CSV</strong></li>
              <li>Torna qui e carica il file .csv</li>
            </ol>
          </div>
          <div className="text-xs text-violet-500">
            <p className="font-medium mb-1">Colonne riconosciute automaticamente:</p>
            <p>Ticket, Apri/Chiudi, Simbolo, Tipologia, Volume, Prezzo (open+close), Profitto, Commissioni, Swap, Pips, SL, TP, Magic</p>
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  )
}
