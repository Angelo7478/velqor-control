import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// CORS: la function e invocata dal BROWSER (pulsante "Aggiorna regime" in Stato Sizing),
// quindi serve il preflight OPTIONS + Access-Control-Allow-Origin su ogni risposta.
// Senza il ramo OPTIONS il preflight eseguiva l'intero fetch Yahoo (~2s) per nulla e il
// POST non partiva mai (browser blocca per header CORS mancante).
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const MAP: Record<string, string> = {
  "US100.cash": "^NDX",
  "US500.cash": "^GSPC",
  "GER40.cash": "^GDAXI",
  "UKOIL.cash": "BZ=F",
  "BTCUSD": "BTC-USD",
  "USDCAD": "USDCAD=X",
  "USDJPY": "USDJPY=X",
}

Deno.serve(async (req: Request) => {
  // Preflight: early-return, non eseguire il lavoro.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )
  const updated: unknown[] = []
  for (const [sym, yt] of Object.entries(MAP)) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yt)}?interval=1d&range=1y`
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" } })
      if (!r.ok) { updated.push({ sym, error: `http ${r.status}` }); continue }
      const j = await r.json()
      const res = j?.chart?.result?.[0]
      const ts: number[] = res?.timestamp ?? []
      const q = res?.indicators?.quote?.[0] ?? {}
      const rows: Record<string, unknown>[] = []
      for (let i = 0; i < ts.length; i++) {
        if (q.close?.[i] == null) continue
        rows.push({
          symbol: sym,
          ts: new Date(ts[i] * 1000).toISOString().slice(0, 10),
          open_price: q.open?.[i] ?? null,
          high: q.high?.[i] ?? null,
          low: q.low?.[i] ?? null,
          close_price: q.close?.[i],
          volume: q.volume?.[i] != null ? Math.round(q.volume[i]) : null,
        })
      }
      if (rows.length) {
        const { error } = await supabase.from("qel_benchmarks").upsert(rows, { onConflict: "symbol,ts" })
        updated.push({ sym, bars: rows.length, latest: rows[rows.length - 1].ts, error: error?.message ?? null })
      } else {
        updated.push({ sym, bars: 0, error: "no rows" })
      }
    } catch (e) {
      updated.push({ sym, error: String(e) })
    }
  }
  let regime: string | null = null
  const { data: rg, error: rgErr } = await supabase.rpc("qel_refresh_regime")
  if (!rgErr) regime = rg as string
  return new Response(JSON.stringify({ ok: true, updated, regime, regime_error: rgErr?.message ?? null }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  })
})
