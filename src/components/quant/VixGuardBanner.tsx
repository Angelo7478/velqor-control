'use client'

// Guardia crash VIX — banner condiviso (Overview + Builder).
// Overlay VIX term structure (soglie DERIVATE dal backtest, PTF_SIM/vix_overlay.py). ratio = ^VIX/^VIX3M.
// Advisory: dial suggerito sul cluster LONG (short tenuti pieni). Azione MANUALE (Angelo spegne gli EA a mano).
// Fonte dati: qel_vix_term (edge function refresh-vix, cron 22:15 UTC lun-ven).

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { fmt } from '@/lib/quant-utils'

export function vixState(ratio: number | null): { label: string; longDial: number; color: string; cadence: string } {
  if (ratio == null) return { label: 'n/d', longDial: 1, color: 'slate', cadence: '—' }
  if (ratio >= 1.03) return { label: 'STRESS (backwardation)', longDial: 0, color: 'red', cadence: 'intraday' }
  if (ratio >= 0.98) return { label: 'Allarme alto', longDial: 0.33, color: 'orange', cadence: 'giornaliera' }
  if (ratio >= 0.97) return { label: 'Allarme', longDial: 0.66, color: 'amber', cadence: 'ogni 2 giorni' }
  return { label: 'Contango (calma)', longDial: 1, color: 'green', cadence: 'settimanale' }
}

export type VixTerm = { ratio: number; ts: string; vix: number; vix3m: number }

export default function VixGuardBanner() {
  const [vix, setVix] = useState<VixTerm | null>(null)

  useEffect(() => {
    let mounted = true
    const supabase = createClient()
    supabase.from('qel_vix_term').select('ts,vix,vix3m,ratio').order('ts', { ascending: false }).limit(1)
      .then(({ data }) => {
        const vr = ((data as { ts: string; vix: number; vix3m: number; ratio: number }[]) || [])[0]
        if (mounted && vr) setVix({ ratio: Number(vr.ratio), ts: vr.ts, vix: Number(vr.vix), vix3m: Number(vr.vix3m) })
      })
    return () => { mounted = false }
  }, [])

  if (!vix) return null
  const vs = vixState(vix.ratio)
  const c = { green: 'bg-green-50 border-green-200 text-green-800', amber: 'bg-amber-50 border-amber-200 text-amber-800', orange: 'bg-orange-50 border-orange-200 text-orange-800', red: 'bg-red-50 border-red-300 text-red-800', slate: 'bg-slate-50 border-slate-200 text-slate-600' }[vs.color]
  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-1 border rounded-xl p-3 text-sm ${c}`}>
      <span className="font-semibold">Guardia crash VIX: {vs.label}</span>
      <span>ratio ^VIX/^VIX3M <b>{fmt(vix.ratio, 3)}</b> <span className="text-xs opacity-70">(VIX {fmt(vix.vix, 1)} / VIX3M {fmt(vix.vix3m, 1)})</span></span>
      <span>Size LONG suggerita <b>{(vs.longDial * 100).toFixed(0)}%</b> <span className="text-xs opacity-70">(short pieni)</span></span>
      <span className="text-xs opacity-70">controllo {vs.cadence} · ultimo dato {vix.ts}</span>
      {vs.longDial < 1 && <span className="text-xs font-medium">⚠ Backwardation: valuta di ridurre/spegnere i LONG a mano (gli short guadagnano nei selloff)</span>}
    </div>
  )
}
