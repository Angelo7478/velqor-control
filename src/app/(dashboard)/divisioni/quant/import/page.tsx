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
  const [strategies, setStrategies] = useState<{ id: string; magic: number }[]>([])
  const [progress, setProgress] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const supabase = createClient()
    const [accRes, stratRes] = await Promise.all([
      supabase.from('qel_accounts').select('*').order('name'),
      supabase.from('qel_strategies').select('id,magic'),
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

    const headerRow = bestTable.rows[0]
    if (!headerRow) return []
    const rawHeaders = Array.from(headerRow.cells).map(c => cleanKey(c.textContent || ''))
    const headers = deduplicateHeaders(rawHeaders)

    const rows: Record<string, string>[] = []
    for (let i = 1; i < bestTable.rows.length; i++) {
      const cells = bestTable.rows[i].cells
      if (cells.length < 3) continue
      const row: Record<string, string> = {}
      headers.forEach((h, j) => { row[h] = cells[j]?.textContent?.trim() || '' })
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
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setCsvText(text)
      const rows = parseCSV(text)
      setParsedRows(rows)
      setPreview(rows.slice(0, 5))
      setResult(null)
    }
    reader.readAsText(file)
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

    // FTMO Italian + English + generic column names
    const openTime = row['apri'] || row['open time'] || row['open_time'] || row['opentime'] || row['time'] || row['open date'] || row['data apertura'] || ''
    const closeTime = row['chiudi'] || row['close time'] || row['close_time'] || row['closetime'] || row['close date'] || row['data chiusura'] || ''
    const symbol = row['simbolo'] || row['symbol'] || row['instrument'] || row['strumento'] || ''
    const direction = row['tipologia'] || row['action'] || row['type'] || row['direction'] || row['tipo'] || row['side'] || ''
    const profit = row['profitto'] || row['profit'] || row['p/l'] || row['pnl'] || ''
    const commission = row['commissioni'] || row['commissione'] || row['commission'] || row['comm'] || ''
    const swap = row['swap'] || ''
    const ticket = row['ticket'] || row['order'] || row['deal'] || row['position'] || row['id'] || ''
    const sl = row['sl'] || row['stop loss'] || row['stoploss'] || ''
    const tp = row['tp'] || row['take profit'] || row['takeprofit'] || ''
    const pips = row['pips'] || ''
    const durationCol = row['durata del trade in secondi'] || row['duration'] || ''

    // Open price: "prezzo" (first occurrence, or deduped as just "prezzo")
    const openPrice = row['prezzo'] || row['open price'] || row['open_price'] || row['openprice'] || row['prezzo apertura'] || ''

    // Close price: "prezzo_2" (second occurrence via dedup), or explicit close price columns
    let closePrice = row['prezzo_2'] || row['prezzo chiusura'] || row['close price'] || row['close_price'] || row['closeprice'] || ''

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

    if (!symbol || !openTime) return null

    // Parse direction
    let dir: 'buy' | 'sell' = 'buy'
    const dirLower = direction.toLowerCase()
    if (dirLower.includes('sell') || dirLower.includes('short') || dirLower === 's' || dirLower === '1') {
      dir = 'sell'
    }

    const profitNum = parseFloat(profit) || 0
    const commNum = parseFloat(commission) || 0
    const swapNum = parseFloat(swap) || 0
    const netProfit = profitNum + commNum + swapNum
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
      commission: commNum,
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

  if (loading) return <p className="text-slate-500 p-4">Caricamento...</p>

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <a href="/divisioni/quant/conti" className="text-sm text-violet-600 hover:text-violet-800">&larr; Torna a Conti</a>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">Import Trade da CSV</h1>
        <p className="text-sm text-slate-500 mt-1">Importa lo storico completo da FTMO, MT5 o qualsiasi CSV</p>
      </div>

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
    </div>
  )
}
