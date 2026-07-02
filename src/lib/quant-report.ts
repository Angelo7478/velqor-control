// ============================================================
// Standard Report Performance Velqor Quant
// Genera un report HTML stampabile (PDF) con metriche complete.
// Tutti i calcoli sono qui, in TS (verificabili). Output statico (no JS embedded).
// Versione "public" -> solo TIPOLOGIA strategia, MAI nomi/logiche.
// ============================================================

export interface ReportTrade {
  d: string          // data chiusura YYYY-MM-DD
  pl: number         // P/L netto della singola operazione
  type: string       // tipologia (Mean Reversion / Seasonal / Trend Following / Tattico)
  cls: string        // classe asset (Indici USA / Europa / Crypto / ...)
  phase?: string     // etichetta fase (lineage) per i divisori
  strat?: string     // nome strategia (solo report interni)
  lots?: number      // volume dell'operazione (per analisi position sizing)
  sid?: string       // chiave strategia (magic) per contare le strategie attive; mai mostrata
  nTrades?: number   // trade REALI rappresentati da questo campione (scheda mensile); default 1 (report per-trade)
}

export interface ReportPhase { label: string; base: number; pl: number; n: number }

export interface ReportOptions {
  title: string
  subtitle: string
  metaRight: string[]      // righe info a destra nell'header
  currency: 'EUR' | 'USD'
  base: number             // capitale iniziale
  swap: number             // somma swap (negativo)
  comm: number             // somma commissioni (negativo)
  isPublic: boolean
  badge?: string           // testo badge header (es. "PER IL GRUPPO" / "CONFIDENZIALE")
  targetPct?: number       // se presente, disegna la linea obiettivo (es. 10)
  phases?: ReportPhase[]   // riepilogo per fase (lineage)
  intro?: string           // box introduttivo (HTML semplice)
  groupNote?: string       // nota finale firmata
  costNote?: boolean       // includi nota CFD -> futures
  hideCostAnalysis?: boolean // backtest: i costi sono gia' nel P/L -> nascondi la tabella "lordo/pre-costi"
  sampleNoun?: string        // scheda a risoluzione mensile: ogni "trade" e' un campione strategia-mese -> 'mese'
  realTradesNote?: string    // nota col conteggio dei TRADE reali (la scheda mostra campioni mensili, non trade)
}

// ---- helpers numerici ----
function pctile(arr: number[], q: number): number {
  if (arr.length === 0) return 0
  const a = [...arr].sort((x, y) => x - y)
  const i = (a.length - 1) * q
  const lo = Math.floor(i), hi = Math.ceil(i)
  return a[lo] + (a[hi] - a[lo]) * (i - lo)
}
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildReportHtml(tradesIn: ReportTrade[], o: ReportOptions): string {
  const cur = o.currency === 'EUR' ? '€' : '$'
  const smp = o.sampleNoun || 'operazione'                       // singolare (scheda: 'mese')
  const oc = 'Oper.'                                             // header colonna conteggio (trade reali)
  const T = [...tradesIn].filter(t => t.d).sort((a, b) => a.d.localeCompare(b.d))
  const BASE = o.base
  const fmt = (n: number) => (n < 0 ? '-' : '') + cur + Math.abs(n).toLocaleString('it-IT', { maximumFractionDigits: 0 })
  const pc = (n: number, d = 1) => (n >= 0 ? '+' : '') + n.toFixed(d) + '%'
  const clsN = (n: number) => n >= 0 ? 'pos' : 'neg'

  // ---- equity, drawdown, base stats ----
  let cum = BASE, peak = BASE, wins = 0, gp = 0, gl = 0, best = -Infinity, worst = Infinity, maxddV = 0, maxdd = 0
  const eq: { e: number; d: string; p?: string }[] = [{ e: BASE, d: T.length ? T[0].d : '', p: T.length ? T[0].phase : undefined }]
  const dds: number[] = []
  for (const t of T) {
    cum += t.pl
    if (cum > peak) peak = cum
    const dd = peak > 0 ? (peak - cum) / peak * 100 : 0
    dds.push(dd)
    if (peak - cum > maxddV) { maxddV = peak - cum; maxdd = dd }
    eq.push({ e: cum, d: t.d, p: t.phase })
    if (t.pl > 0) { wins++; gp += t.pl } else { gl += Math.abs(t.pl) }
    if (t.pl > best) best = t.pl
    if (t.pl < worst) worst = t.pl
  }
  const n = T.length
  const net = cum - BASE
  const wr = n > 0 ? wins / n * 100 : 0
  const losses = n - wins
  const pf = gl > 0 ? gp / gl : (gp > 0 ? 99 : 0)
  const avgt = n > 0 ? net / n : 0
  const aw = wins > 0 ? gp / wins : 0
  const al = losses > 0 ? gl / losses : 0
  const payoff = al > 0 ? aw / al : 0
  if (best === -Infinity) best = 0
  if (worst === Infinity) worst = 0

  // consecutivi
  let cw = 0, clo = 0, mcw = 0, mcl = 0
  for (const t of T) {
    if (t.pl > 0) { cw++; clo = 0; if (cw > mcw) mcw = cw } else { clo++; cw = 0; if (clo > mcl) mcl = clo }
  }

  // distribuzione (skew, kurtosi, VaR, CVaR, tail)
  const pls = T.map(t => t.pl)
  const mean = n > 0 ? net / n : 0
  const variance = n > 0 ? pls.reduce((a, b) => a + (b - mean) ** 2, 0) / n : 0
  const sd = Math.sqrt(variance)
  const skew = sd > 0 && n > 0 ? pls.reduce((a, b) => a + ((b - mean) / sd) ** 3, 0) / n : 0
  const kurt = sd > 0 && n > 0 ? pls.reduce((a, b) => a + ((b - mean) / sd) ** 4, 0) / n - 3 : 0
  const var95 = pctile(pls, 0.05)
  const tailArr = pls.filter(x => x <= var95)
  const cvar = tailArr.length > 0 ? tailArr.reduce((a, b) => a + b, 0) / tailArr.length : 0
  const tail = var95 !== 0 ? Math.abs(pctile(pls, 0.95)) / Math.abs(var95) : 0
  const ulcer = dds.length > 0 ? Math.sqrt(dds.reduce((a, b) => a + b * b, 0) / dds.length) : 0
  const timeInDD = dds.length > 0 ? dds.filter(x => x > 0.01).length / dds.length * 100 : 0

  // periodo & annualizzato
  const d0 = T.length ? new Date(T[0].d) : new Date()
  const d1 = T.length ? new Date(T[n - 1].d) : new Date()
  const days = Math.max(1, (d1.getTime() - d0.getTime()) / 864e5)
  const totRet = BASE > 0 ? net / BASE : 0
  const annRet = (Math.pow(1 + totRet, 365 / days) - 1) * 100

  // giornaliero
  const dayMap: Record<string, number> = {}
  for (const t of T) dayMap[t.d] = (dayMap[t.d] || 0) + t.pl
  const dvals = Object.values(dayMap)
  const bestDay = dvals.length ? Math.max(...dvals) : 0
  const worstDay = dvals.length ? Math.min(...dvals) : 0
  const posDays = dvals.filter(x => x > 0).length
  const tDays = dvals.length

  // trade REALI (per i conteggi): t.nTrades se presente (scheda mensile), altrimenti 1 (report per-trade)
  const realN = T.reduce((a, t) => a + (t.nTrades ?? 1), 0)
  // mensile — n = campioni mensili (per le stat); nt = trade reali (per il conteggio a schermo)
  const mm: Record<string, { pl: number; n: number; w: number; nt: number }> = {}
  for (const t of T) { const m = t.d.slice(0, 7); if (!mm[m]) mm[m] = { pl: 0, n: 0, w: 0, nt: 0 }; mm[m].pl += t.pl; mm[m].n++; mm[m].nt += (t.nTrades ?? 1); if (t.pl > 0) mm[m].w++ }
  const months = Object.keys(mm).sort()
  const mret = months.map(m => BASE > 0 ? mm[m].pl / BASE * 100 : 0)
  const mMean = mret.length ? mret.reduce((a, b) => a + b, 0) / mret.length : 0
  const mStd = mret.length ? Math.sqrt(mret.reduce((a, b) => a + (b - mMean) ** 2, 0) / mret.length) : 0
  const dnegArr = mret.filter(r => r < 0)
  const dStd = mret.length ? Math.sqrt(dnegArr.reduce((a, b) => a + b * b, 0) / mret.length) : 0
  const sharpe = mStd > 0 ? mMean / mStd * Math.sqrt(12) : 0
  const sortino = dStd > 0 ? mMean / dStd * Math.sqrt(12) : 99
  const volAnn = mStd * Math.sqrt(12)
  const posM = mret.filter(r => r > 0).length
  const bestM = mret.length ? Math.max(...mret) : 0
  const worstM = mret.length ? Math.min(...mret) : 0
  const recovery = maxddV > 0 ? net / maxddV : 99
  const calmar = maxdd > 0 ? annRet / maxdd : 99

  // ---- raggruppamenti ----
  function group(key: 'type' | 'cls' | 'strat') {
    const g: Record<string, { pl: number; n: number; w: number; nt: number }> = {}
    for (const t of T) {
      const k = (key === 'strat' ? (t.strat || 'Manuale') : t[key]) as string
      if (!g[k]) g[k] = { pl: 0, n: 0, w: 0, nt: 0 }
      g[k].pl += t.pl; g[k].n++; g[k].nt += (t.nTrades ?? 1); if (t.pl > 0) g[k].w++
    }
    return Object.keys(g).sort((a, b) => g[b].pl - g[a].pl)
      .map(k => ({ k, n: g[k].n, nt: g[k].nt, wr: g[k].n > 0 ? g[k].w / g[k].n * 100 : 0, pl: g[k].pl, quota: net !== 0 ? g[k].pl / net * 100 : 0 }))
  }
  const TC: Record<string, string> = { 'Mean Reversion': '#7c3aed', 'Seasonal': '#0d9488', 'Trend Following': '#f59e0b', 'Tattico': '#94a3b8' }

  // ---- SVG equity ----
  let chart = '<p style="font-size:11px;color:#94a3b8">Dati insufficienti.</p>'
  if (eq.length > 1) {
    const w = 840, h = 260, pl = 66, pr = 20, pt = 16, pb = 28
    const vals = eq.map(p => p.e)
    const mn = Math.min(...vals), mx = Math.max(...vals)
    const sp = (mx - mn) || 1, lo = mn - sp * 0.06, hi = mx + sp * 0.06
    const sx = (i: number) => pl + (i / (eq.length - 1)) * (w - pl - pr)
    const sy = (v: number) => h - pb - ((v - lo) / (hi - lo)) * (h - pb - pt)
    let grid = ''
    for (let i = 0; i <= 5; i++) { const v = lo + (hi - lo) * i / 5; const y = sy(v); grid += `<line x1="${pl}" y1="${y.toFixed(1)}" x2="${w - pr}" y2="${y.toFixed(1)}" stroke="#eef2f7"/><text x="${pl - 7}" y="${(y + 3).toFixed(1)}" font-size="9" fill="#94a3b8" text-anchor="end">${cur}${(v / 1000).toFixed(0)}k</text>` }
    let xl = ''
    for (let j = 0; j < 6; j++) { const i = Math.round(j * (eq.length - 1) / 5); xl += `<text x="${sx(i).toFixed(1)}" y="${h - 8}" font-size="9" fill="#94a3b8" text-anchor="${j === 0 ? 'start' : j === 5 ? 'end' : 'middle'}">${eq[i].d.slice(2)}</text>` }
    const pts = eq.map((p, i) => `${sx(i).toFixed(1)},${sy(p.e).toFixed(1)}`).join(' ')
    const area = `${sx(0).toFixed(1)},${(h - pb).toFixed(1)} ${pts} ${sx(eq.length - 1).toFixed(1)},${(h - pb).toFixed(1)}`
    let dividers = ''
    for (let i = 1; i < eq.length; i++) {
      if (eq[i].p && eq[i].p !== eq[i - 1].p) { const x = sx(i); dividers += `<line x1="${x.toFixed(1)}" y1="${pt}" x2="${x.toFixed(1)}" y2="${h - pb}" stroke="#f59e0b" stroke-dasharray="4 3"/><text x="${(x + 3).toFixed(1)}" y="${pt + 9}" font-size="8.5" fill="#b45309" font-weight="600">${esc(eq[i].p || '')}</text>` }
    }
    const baseY = sy(BASE)
    let tgt = ''
    if (o.targetPct) { const ty = sy(BASE * (1 + o.targetPct / 100)); tgt = `<line x1="${pl}" y1="${ty.toFixed(1)}" x2="${w - pr}" y2="${ty.toFixed(1)}" stroke="#16a34a" stroke-dasharray="4 3" opacity=".5"/><text x="${w - pr}" y="${(ty - 3).toFixed(1)}" font-size="8" fill="#16a34a" text-anchor="end">obiettivo +${o.targetPct}%</text>` }
    chart = `<svg viewBox="0 0 ${w} ${h}" style="width:100%">${grid}<line x1="${pl}" y1="${baseY.toFixed(1)}" x2="${w - pr}" y2="${baseY.toFixed(1)}" stroke="#cbd5e1" stroke-dasharray="2 2"/>${tgt}<line x1="${pl}" y1="${pt}" x2="${pl}" y2="${h - pb}" stroke="#cbd5e1"/><line x1="${pl}" y1="${h - pb}" x2="${w - pr}" y2="${h - pb}" stroke="#cbd5e1"/><polygon points="${area}" fill="#7c3aed" opacity=".06"/><polyline points="${pts}" fill="none" stroke="#7c3aed" stroke-width="2"/>${dividers}${xl}<text x="${(w - pr).toFixed(1)}" y="${(sy(eq[eq.length - 1].e) - 5).toFixed(1)}" font-size="11" fill="#7c3aed" font-weight="700" text-anchor="end">${fmt(eq[eq.length - 1].e)}</text></svg>`
  }

  // ---- tabelle ----
  const kpiCards: [string, string, string, string][] = [
    ['Rendimento Netto', pc(totRet * 100), fmt(net), clsN(net)],
    ['Annualizzato (CAGR)', pc(annRet), 'proiezione', clsN(annRet)],
    ['Sharpe Ratio', sharpe.toFixed(2), 'mensile, ann.', clsN(sharpe - 1)],
    ['Max Drawdown', pc(-maxdd), fmt(-maxddV), 'neg'],
  ]
  const perf: [string, string][] = [
    ['Rendimento totale netto', pc(totRet * 100)],
    ['Rendimento annualizzato (CAGR)', pc(annRet)],
    ['Rendimento medio mensile', pc(mMean, 2)],
    [o.sampleNoun === 'mese' ? 'Operazioni (trade reali)' : 'Operazioni totali', `${realN} (${months.length ? (realN / months.length).toFixed(0) : 0}/mese)`],
    ['Win rate', `${wr.toFixed(1)}% (${wins}/${n})`],
    ['Profit factor', pf.toFixed(2)],
    ['Payoff ratio', payoff.toFixed(2)],
    [`Expectancy / ${smp}`, fmt(avgt)],
    ['Vincita media', fmt(aw)],
    ['Perdita media', fmt(-al)],
    [`Miglior / peggior ${smp}`, `${fmt(best)} / ${fmt(worst)}`],
    ['Max vincite / perdite consec.', `${mcw} / ${mcl}`],
    ['Mesi profittevoli', `${posM}/${months.length} (${months.length ? (posM / months.length * 100).toFixed(0) : 0}%)`],
    ['Miglior / peggior mese', `${pc(bestM, 1)} / ${pc(worstM, 1)}`],
    ['Giorni operativi positivi', `${posDays}/${tDays} (${tDays ? (posDays / tDays * 100).toFixed(0) : 0}%)`],
  ]
  const risk: [string, string][] = [
    ['Max drawdown', `${pc(-maxdd)} (${fmt(-maxddV)})`],
    ['Volatilita annualizzata', `${volAnn.toFixed(1)}%`],
    ['Sharpe ratio (ann.)', sharpe.toFixed(2)],
    ['Sortino ratio (ann.)', sortino > 50 ? '∞' : sortino.toFixed(2)],
    ['Calmar ratio', calmar > 50 ? '∞' : calmar.toFixed(2)],
    ['Recovery factor', recovery.toFixed(2)],
    ['Ulcer index', ulcer.toFixed(2)],
    ['% tempo in drawdown', `${timeInDD.toFixed(0)}%`],
    [`VaR 95% (${smp})`, fmt(var95)],
    ['CVaR 95% (coda)', fmt(cvar)],
    ['Tail ratio (95/5)', tail.toFixed(2)],
    ['Skewness / Kurtosis', `${skew.toFixed(2)} / ${kurt.toFixed(2)}`],
    ['Miglior / peggior giornata', `${fmt(bestDay)} / ${fmt(worstDay)}`],
    ['Max DD vs limite FTMO (10%)', `${maxdd.toFixed(1)}% / 10,0%`],
    ['Margine sotto limite', `${(10 - maxdd).toFixed(1)} punti`],
  ]
  const row2 = (rows: [string, string][]) => rows.map(x => `<tr><td>${x[0]}</td><td class="r b">${x[1]}</td></tr>`).join('')

  // mensile
  let mc = 0
  const maxAbs = Math.max(1, ...months.map(m => Math.abs(mm[m].pl)))
  const monthlyRows = months.map(m => {
    const ob = mm[m]; mc += ob.pl; const r = BASE > 0 ? ob.pl / BASE * 100 : 0; const bw = Math.abs(ob.pl) / maxAbs * 120
    return `<tr><td class="b">${m}</td><td class="r b ${clsN(r)}">${pc(r, 2)}</td><td class="r ${clsN(ob.pl)}">${fmt(ob.pl)}</td><td class="r">${pc(BASE > 0 ? mc / BASE * 100 : 0, 1)}</td><td class="r">${ob.nt}</td><td class="r">${(ob.w / ob.n * 100).toFixed(0)}%</td><td><span class="bar" style="width:${bw.toFixed(0)}px;background:${ob.pl >= 0 ? '#16a34a' : '#dc2626'}"></span></td></tr>`
  }).join('') + `<tr style="border-top:2px solid #e2e8f0"><td class="b">TOTALE</td><td class="r b ${clsN(net)}">${pc(totRet * 100, 1)}</td><td class="r b ${clsN(net)}">${fmt(net)}</td><td class="r"></td><td class="r b">${realN}</td><td class="r">${wr.toFixed(0)}%</td><td></td></tr>`

  const allocRows = (rows: ReturnType<typeof group>, color: boolean) => rows.map(r =>
    `<tr><td>${color ? `<span class="bar" style="width:9px;background:${TC[r.k] || '#cbd5e1'}"></span> ` : ''}${esc(r.k)}</td><td class="r">${r.nt}</td><td class="r">${r.wr.toFixed(0)}%</td><td class="r b ${clsN(r.pl)}">${fmt(r.pl)}</td><td class="r">${r.quota.toFixed(1)}%</td></tr>`).join('')

  // costi
  const gross = net - o.swap - o.comm
  const totCost = o.swap + o.comm
  const costRatio = gross !== 0 ? Math.abs(totCost) / gross * 100 : 0
  const costRows: [string, string, string][] = [
    ['Profitto lordo (pre-costi)', fmt(gross), ''],
    ['Costi di finanziamento (swap)', fmt(o.swap), `${gross !== 0 ? (Math.abs(o.swap) / gross * 100).toFixed(2) : '0'}%`],
    ['Commissioni', fmt(o.comm), `${gross !== 0 ? (Math.abs(o.comm) / gross * 100).toFixed(2) : '0'}%`],
    ['Costi totali', fmt(totCost), `${costRatio.toFixed(2)}%`],
    ['Profitto netto', fmt(net), ''],
  ]
  const costHtml = '<thead><tr><th>Voce</th><th class="r">Importo</th><th class="r">% su lordo</th></tr></thead><tbody>' +
    costRows.map((x, i) => `<tr${i === 4 ? ' style="border-top:2px solid #e2e8f0"' : ''}><td class="${i === 4 ? 'b' : ''}">${x[0]}</td><td class="r b ${x[1].includes('-') ? 'neg' : ''}">${x[1]}</td><td class="r">${x[2]}</td></tr>`).join('') + '</tbody>'

  // fasi (lineage)
  const phaseHtml = o.phases && o.phases.length > 1
    ? `<div class="sec">Riepilogo per Fase</div><table><thead><tr><th>Fase</th><th class="r">Capitale</th><th class="r">P/L</th><th class="r">Saldo</th><th class="r">Rendim.</th><th class="r">${oc}</th></tr></thead><tbody>${o.phases.map(p => `<tr><td>${esc(p.label)}</td><td class="r">${fmt(p.base)}</td><td class="r b ${clsN(p.pl)}">${(p.pl >= 0 ? '+' : '') + fmt(p.pl)}</td><td class="r b">${fmt(p.base + p.pl)}</td><td class="r ${clsN(p.pl)}">${pc(p.base > 0 ? p.pl / p.base * 100 : 0, 1)}</td><td class="r">${p.n}</td></tr>`).join('')}</tbody></table>` : ''

  const costNoteHtml = o.costNote
    ? `<div class="sec">Perche i costi pesano: l'inefficienza dei CFD</div><div class="method">I costi incidono per il <b>${costRatio.toFixed(1)}% del lordo</b>, quasi tutti <b>swap</b> (finanziamento overnight). Non e un difetto delle strategie: e la dimostrazione concreta dell'<b>inefficienza strutturale dei CFD</b>, gli strumenti su cui opera la stragrande maggioranza dei trader retail. Il dato che conta: <b>anche pagando questa tassa, il netto e ${pc(totRet * 100, 1)}</b>, segno di un edge solido. La direzione sono i <b>future CME</b> (E-mini/Micro): costi trasparenti e molto piu bassi, <b>nessuno swap giornaliero</b> (solo roll trimestrale). Sui future i ${fmt(Math.abs(o.swap))} di swap di questo periodo semplicemente non esisterebbero.</div>` : ''

  const stratSection = (!o.isPublic && T.some(t => t.strat))
    ? `<div class="sec">Per Strategia</div><table><thead><tr><th>Strategia</th><th class="r">${oc}</th><th class="r">Win%</th><th class="r">Contributo</th><th class="r">Quota</th></tr></thead><tbody>${allocRows(group('strat'), false)}</tbody></table>` : ''

  // Evoluzione strategie attive & position sizing (per mese) — per valutare il dynamic sizing nel tempo
  const hasLots = T.some(t => (t.lots || 0) > 0)
  let sizingHtml = ''
  if (hasLots) {
    const sm: Record<string, { strats: Set<string>; n: number; nt: number; lots: number; pl: number }> = {}
    for (const t of T) {
      const m = t.d.slice(0, 7)
      if (!sm[m]) sm[m] = { strats: new Set<string>(), n: 0, nt: 0, lots: 0, pl: 0 }
      if (t.sid) sm[m].strats.add(t.sid)
      sm[m].n++; sm[m].nt += (t.nTrades ?? 1); sm[m].lots += t.lots || 0; sm[m].pl += t.pl
    }
    const sMonths = Object.keys(sm).sort()
    const activeCounts = sMonths.map(m => sm[m].strats.size)
    const minA = activeCounts.length ? Math.min(...activeCounts) : 0
    const maxA = activeCounts.length ? Math.max(...activeCounts) : 0
    const avgA = activeCounts.length ? activeCounts.reduce((a, b) => a + b, 0) / activeCounts.length : 0
    const totalDistinct = new Set(T.filter(t => t.sid).map(t => t.sid)).size
    const szRows = sMonths.map(m => {
      const ob = sm[m]
      const avgLot = ob.n > 0 ? ob.lots / ob.n : 0
      const lotsPerStrat = ob.strats.size > 0 ? ob.lots / ob.strats.size : 0
      return `<tr><td class="b">${m}</td><td class="r b">${ob.strats.size}</td><td class="r">${ob.nt}</td><td class="r">${ob.lots.toFixed(2)}</td><td class="r">${avgLot.toFixed(2)}</td><td class="r">${lotsPerStrat.toFixed(2)}</td><td class="r ${clsN(ob.pl)}">${fmt(ob.pl)}</td></tr>`
    }).join('')
    sizingHtml = `<div class="sec">Evoluzione Strategie Attive &amp; Position Sizing</div>` +
      `<div class="method" style="margin-bottom:8px">Monitoraggio cadenzato del numero di strategie attive e del dimensionamento (lotti) mese per mese. Serve a valutare nel tempo gli effetti del <b>dynamic position sizing</b> applicato periodicamente al portafoglio: come variano i motori attivi, il volume e il lotto medio, e l'impatto sul P/L. Nel periodo: <b>${minA}-${maxA} strategie attive/mese</b> (media ${avgA.toFixed(1)}), ${totalDistinct} distinte complessive.</div>` +
      `<table><thead><tr><th>Mese</th><th class="r">Strat. attive</th><th class="r">${oc}</th><th class="r">Lotti tot.</th><th class="r">Lotto medio</th><th class="r">Lotti/strat.</th><th class="r">P/L</th></tr></thead><tbody>${szRows}</tbody></table>`
  }

  const methodTxt = 'Operativita basata su un <b>portafoglio multi-strategia sistematico</b>, governato da regole, su indici azionari, energia, valute e crypto. Stili complementari (mean reversion, stagionalita, trend following, breakout) combinati per de-correlazione e validati su backtest fuori campione (walk-forward, Monte Carlo, stress test di regime) e su operativita live. Gestione del rischio istituzionale: <b>dimensionamento a budget di drawdown ripartito per l\'MC95</b> di ogni strategia, pesato per robustezza e risultati live, con guardrail rigidi (perdita giornaliera max 5%, totale max 10%).'

  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>${esc(o.title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;color:#1e293b;max-width:920px;margin:0 auto;padding:36px 42px;font-size:11.5px;line-height:1.5}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:16px}
.logo{font-size:23px;font-weight:800;letter-spacing:-.5px;color:#0f172a}.logo span{color:#7c3aed}.logo .tag{font-size:9px;letter-spacing:3px;color:#94a3b8;font-weight:600;margin-top:2px}
h1{font-size:19px;margin:14px 0 2px;color:#0f172a;font-weight:700}.sub{font-size:11px;color:#64748b}
.meta{text-align:right;font-size:10px;color:#64748b;line-height:1.7}
.conf{display:inline-block;background:#7c3aed;color:#fff;font-size:8px;letter-spacing:1.5px;padding:2px 8px;border-radius:3px;margin-bottom:6px}
.intro{background:linear-gradient(135deg,#f5f3ff,#eef2ff);border:1px solid #ddd6fe;border-radius:12px;padding:15px 18px;margin:18px 0;font-size:11.5px;color:#4c1d95;line-height:1.6}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}
.kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:11px 13px}
.kpi .l{font-size:8.5px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8}.kpi .v{font-size:20px;font-weight:800;font-family:'SF Mono',Monaco,monospace;margin-top:3px}.kpi .s{font-size:9.5px;color:#64748b}
.sec{font-size:12px;font-weight:700;color:#0f172a;margin:22px 0 7px;padding-bottom:4px;border-bottom:1px solid #e2e8f0;text-transform:uppercase;letter-spacing:.03em}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:10.8px}
th{color:#94a3b8;text-transform:uppercase;font-size:8.5px;letter-spacing:.04em}
td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}td.b{font-weight:700}
.pos{color:#16a34a}.neg{color:#dc2626}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.bar{height:9px;border-radius:2px;display:inline-block;vertical-align:middle}
.method{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:13px 15px;font-size:10.5px;color:#475569;line-height:1.65}
.note{background:#fafafa;border-left:3px solid #7c3aed;border-radius:0 8px 8px 0;padding:13px 16px;font-size:11px;color:#334155;line-height:1.7}
.disc{margin-top:22px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:8.5px;color:#94a3b8;line-height:1.6}
.foot{margin-top:8px;font-size:8.5px;color:#cbd5e1;text-align:center}
@media print{.no-print{display:none}body{padding:6px}.kpi .v{font-size:18px}}
</style></head><body>
<div class="head"><div>
<div class="logo">VELQOR<span> Quant</span><div class="tag">SYSTEMATIC TRADING</div></div>
<h1>${esc(o.title)}</h1><div class="sub">${esc(o.subtitle)}</div>
<div class="sub">Periodo: ${T.length ? T[0].d : '-'} → ${T.length ? T[n - 1].d : '-'} · ${Math.round(days)} giorni · ${months.length} mesi · ${realN} operazioni</div>
</div><div class="meta">${o.badge ? `<div class="conf">${esc(o.badge)}</div><br>` : ''}${o.metaRight.map(esc).join('<br>')}</div></div>
${o.intro ? `<div class="intro">${o.intro}</div>` : ''}
<div class="kpis">${kpiCards.map(x => `<div class="kpi"><div class="l">${x[0]}</div><div class="v ${x[3]}">${x[1]}</div><div class="s">${x[2]}</div></div>`).join('')}</div>
<div class="sec">Curva Equity</div><div style="background:#fcfcfd;border:1px solid #e2e8f0;border-radius:10px;padding:12px 8px 4px">${chart}</div>
${phaseHtml}
<div class="grid2"><div><div class="sec">Metriche di Performance</div><table><tbody>${row2(perf)}</tbody></table></div><div><div class="sec">Metriche di Rischio</div><table><tbody>${row2(risk)}</tbody></table></div></div>
<div class="sec">Rendimento Mese per Mese</div><table><thead><tr><th>Mese</th><th class="r">Rendimento</th><th class="r">P/L</th><th class="r">Cumulato</th><th class="r">${oc}</th><th class="r">Win%</th><th></th></tr></thead><tbody>${monthlyRows}</tbody></table>
${sizingHtml}
<div class="grid2"><div><div class="sec">Per Tipologia</div><table><thead><tr><th>Tipologia</th><th class="r">${oc}</th><th class="r">Win%</th><th class="r">Contributo</th><th class="r">Quota</th></tr></thead><tbody>${allocRows(group('type'), true)}</tbody></table></div><div><div class="sec">Per Classe di Asset</div><table><thead><tr><th>Classe</th><th class="r">${oc}</th><th class="r">Win%</th><th class="r">Contributo</th><th class="r">Quota</th></tr></thead><tbody>${allocRows(group('cls'), false)}</tbody></table></div></div>
${stratSection}
${o.hideCostAnalysis
    ? `<div class="sec">Costi di Transazione</div><div class="note">P/L al <b>netto dei costi reali FTMO</b> (spread e commissioni): sono gia' inclusi nei backtest a 1 lotto. Nessuna voce lordo/pre-costi: il netto e' ${fmt(net)}.</div>`
    : `<div class="sec">Analisi Costi di Transazione</div><table>${costHtml}</table>`}
${costNoteHtml}
<div class="sec">Metodologia &amp; Gestione del Rischio</div><div class="method">${methodTxt}</div>
${o.groupNote ? `<div class="sec">Una nota</div><div class="note">${o.groupNote}</div>` : ''}
<div style="margin-top:12px" class="no-print"><button onclick="window.print()" style="padding:8px 18px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">Stampa / Salva PDF</button></div>
<div class="disc">AVVERTENZA SUL RISCHIO. Documento a finalita esclusivamente informative, non costituisce consulenza finanziaria ne offerta di investimento. Risultati da operativita reale su conto FTMO, al netto dei costi di transazione (swap e commissioni). Le performance passate non sono indicative ne garanzia di risultati futuri. Il trading sistematico comporta rischio elevato di perdita del capitale. Le metriche annualizzate sono proiezioni su periodo limitato.</div>
<div class="foot">VELQOR Quant · Systematic Trading · documento generato dal sistema di monitoraggio</div>
</body></html>`
}
