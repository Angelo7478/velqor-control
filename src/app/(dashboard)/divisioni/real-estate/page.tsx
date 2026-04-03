'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useAuth } from '@/stores/auth'
import { formatDate } from '@/lib/utils'

interface REProperty {
  id: string
  title: string
  address: string | null
  city: string | null
  status: string
  price: number | null
  created_at: string
}

interface REAuction {
  id: string
  title: string
  tribunal: string | null
  base_price: number | null
  auction_date: string | null
  status: string
  created_at: string
}

export default function RealEstatePage() {
  const { membership } = useAuth()
  const [properties, setProperties] = useState<REProperty[]>([])
  const [auctions, setAuctions] = useState<REAuction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const supabase = createClient()

    const [propRes, auctRes] = await Promise.all([
      supabase.from('re_properties').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('re_auctions').select('*').order('auction_date', { ascending: true }).limit(20),
    ])

    setProperties(propRes.data || [])
    setAuctions(auctRes.data || [])
    setLoading(false)
  }

  if (loading) return <p className="text-slate-500">Caricamento...</p>

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">🏠 Real Estate</h1>
        <p className="text-sm text-slate-500 mt-1">Divisione immobiliare — aste giudiziarie e deal flow</p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <div className="bg-orange-50 rounded-xl p-4">
          <p className="text-2xl font-bold text-orange-700">{properties.length}</p>
          <p className="text-sm text-orange-600">Immobili</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-4">
          <p className="text-2xl font-bold text-amber-700">{auctions.length}</p>
          <p className="text-sm text-amber-600">Aste</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <p className="text-2xl font-bold text-green-700">
            {auctions.filter(a => a.auction_date && new Date(a.auction_date) > new Date()).length}
          </p>
          <p className="text-sm text-green-600">Aste future</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-2xl font-bold text-blue-700">
            {properties.filter(p => p.status === 'active').length}
          </p>
          <p className="text-sm text-blue-600">Attivi</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Immobili */}
        <section>
          <h2 className="text-lg font-semibold text-slate-900 mb-3">Immobili</h2>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {properties.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Nessun immobile registrato</p>
            ) : (
              properties.map((prop) => (
                <div key={prop.id} className="p-3">
                  <p className="text-sm font-medium text-slate-900">{prop.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {prop.city && <span className="text-xs text-slate-500">{prop.city}</span>}
                    {prop.price && <span className="text-xs text-slate-500">· {prop.price.toLocaleString('it-IT')} EUR</span>}
                    <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{prop.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Aste */}
        <section>
          <h2 className="text-lg font-semibold text-slate-900 mb-3">Aste</h2>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {auctions.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Nessuna asta registrata</p>
            ) : (
              auctions.map((auction) => (
                <div key={auction.id} className="p-3">
                  <p className="text-sm font-medium text-slate-900">{auction.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {auction.tribunal && <span className="text-xs text-slate-500">{auction.tribunal}</span>}
                    {auction.base_price && <span className="text-xs text-slate-500">· Base: {auction.base_price.toLocaleString('it-IT')} EUR</span>}
                    {auction.auction_date && <span className="text-xs text-slate-400">· {formatDate(auction.auction_date)}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
