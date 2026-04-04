'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelAccount } from '@/types/database'

function fmt(n: number | null, decimals = 2): string {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export default function ContiConfigPage() {
  const [accounts, setAccounts] = useState<QelAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', server: '', login: '', investor_password: '', status: 'active' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', broker: 'FTMO', account_size: '10000', currency: 'USD', server: '', login: '', investor_password: '', status: 'active' })
  const [addSaving, setAddSaving] = useState(false)
  const [addMsg, setAddMsg] = useState('')

  useEffect(() => { loadAccounts() }, [])

  async function loadAccounts() {
    const supabase = createClient()
    const { data } = await supabase.from('qel_accounts').select('*').order('name')
    setAccounts(data || [])
    setLoading(false)
  }

  function startEdit(acc: QelAccount) {
    setEditing(acc.id)
    setForm({
      name: acc.name,
      server: acc.server || '',
      login: acc.login || '',
      investor_password: acc.investor_password || '',
      status: acc.status,
    })
    setMsg('')
  }

  async function saveAccount() {
    if (!editing) return
    setSaving(true)
    setMsg('')

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout — riprova')), 10000)
    )

    try {
      const supabase = createClient()
      const updatePromise = supabase.from('qel_accounts').update({
        name: form.name,
        server: form.server || null,
        login: form.login || null,
        investor_password: form.investor_password || null,
        status: form.status as QelAccount['status'],
      }).eq('id', editing).select()

      const { data, error } = await Promise.race([updatePromise, timeout])

      if (error) {
        setMsg(`Errore: ${error.message}`)
      } else if (!data || data.length === 0) {
        setMsg('Errore: nessun record aggiornato (controlla permessi)')
      } else {
        setMsg('Salvato!')
        setEditing(null)
        await loadAccounts()
      }
    } catch (e) {
      setMsg(`Errore: ${e instanceof Error ? e.message : 'sconosciuto'}`)
    } finally {
      setSaving(false)
    }
  }

  async function createAccount() {
    if (!addForm.name.trim()) { setAddMsg('Inserisci un nome'); return }
    setAddSaving(true)
    setAddMsg('')
    try {
      const supabase = createClient()
      // Get org_id from existing account or use default
      const orgId = accounts.length > 0 ? accounts[0].org_id : 'a0000000-0000-0000-0000-000000000001'
      const { data, error } = await supabase.from('qel_accounts').insert({
        org_id: orgId,
        name: addForm.name.trim(),
        broker: addForm.broker || 'FTMO',
        account_size: Number(addForm.account_size) || 10000,
        currency: addForm.currency || 'USD',
        server: addForm.server || null,
        login: addForm.login || null,
        investor_password: addForm.investor_password || null,
        status: addForm.status as QelAccount['status'],
        max_daily_loss_pct: 5,
        max_total_loss_pct: 10,
        profit_target_pct: 10,
        balance: Number(addForm.account_size) || 10000,
        equity: Number(addForm.account_size) || 10000,
        floating_pl: 0,
        margin_used: 0,
        daily_dd_pct: 0,
        total_dd_pct: 0,
      }).select()

      if (error) {
        setAddMsg(`Errore: ${error.message}`)
      } else if (!data || data.length === 0) {
        setAddMsg('Errore: conto non creato (controlla permessi)')
      } else {
        setAddMsg('Conto creato!')
        setShowAdd(false)
        setAddForm({ name: '', broker: 'FTMO', account_size: '10000', currency: 'USD', server: '', login: '', investor_password: '', status: 'active' })
        await loadAccounts()
      }
    } catch (e) {
      setAddMsg(`Errore: ${e instanceof Error ? e.message : 'sconosciuto'}`)
    } finally {
      setAddSaving(false)
    }
  }

  async function deleteAccount(id: string, name: string) {
    if (!confirm(`Eliminare il conto "${name}"? Tutti i dati associati verranno persi.`)) return
    const supabase = createClient()
    const { error } = await supabase.from('qel_accounts').delete().eq('id', id)
    if (error) {
      setMsg(`Errore eliminazione: ${error.message}`)
    } else {
      await loadAccounts()
    }
  }

  if (loading) return <p className="text-slate-500 p-4">Caricamento...</p>

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <a href="/divisioni/quant" className="text-sm text-violet-600 hover:text-violet-800">&larr; Torna a Quant</a>
        <div className="flex justify-between items-start mt-2">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Configurazione Conti FTMO</h1>
            <p className="text-sm text-slate-500 mt-1">Inserisci login e investor password MT5 per attivare il monitoraggio</p>
          </div>
          <button onClick={() => { setShowAdd(!showAdd); setAddMsg('') }}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 flex items-center gap-1.5">
            <span className="text-lg leading-none">+</span> Aggiungi conto
          </button>
        </div>
      </div>

      {/* Add Account Form */}
      {showAdd && (
        <div className="bg-violet-50 rounded-xl border border-violet-200 p-4 mb-4">
          <h3 className="text-sm font-semibold text-violet-700 mb-3">Nuovo conto</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500">Nome conto *</label>
                <input type="text" value={addForm.name} onChange={e => setAddForm({...addForm, name: e.target.value})}
                  placeholder="es. FTMO 50K #2" className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">Broker</label>
                <input type="text" value={addForm.broker} onChange={e => setAddForm({...addForm, broker: e.target.value})}
                  className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">Capitale ($)</label>
                <input type="number" value={addForm.account_size} onChange={e => setAddForm({...addForm, account_size: e.target.value})}
                  className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">Status</label>
                <select value={addForm.status} onChange={e => setAddForm({...addForm, status: e.target.value})}
                  className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm">
                  <option value="active">Active</option>
                  <option value="challenge">Challenge</option>
                  <option value="verification">Verification</option>
                  <option value="funded">Funded</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500">Server MT5</label>
                <input type="text" value={addForm.server} onChange={e => setAddForm({...addForm, server: e.target.value})}
                  placeholder="es. FTMO-Server3" className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">Login MT5</label>
                <input type="text" value={addForm.login} onChange={e => setAddForm({...addForm, login: e.target.value})}
                  placeholder="es. 12345678" className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">Investor Password</label>
                <input type="password" value={addForm.investor_password} onChange={e => setAddForm({...addForm, investor_password: e.target.value})}
                  placeholder="Password read-only" className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={createAccount} disabled={addSaving}
                className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
                {addSaving ? 'Creazione...' : 'Crea conto'}
              </button>
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">Annulla</button>
              {addMsg && <span className={`text-sm ${addMsg.startsWith('Errore') ? 'text-red-600' : 'text-green-600'}`}>{addMsg}</span>}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {accounts.map(acc => (
          <div key={acc.id} className="bg-white rounded-xl border border-slate-200 p-4">
            {editing === acc.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500">Nome conto</label>
                    <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                      className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500">Status</label>
                    <select value={form.status} onChange={e => setForm({...form, status: e.target.value})}
                      className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm">
                      <option value="active">Active</option>
                      <option value="challenge">Challenge</option>
                      <option value="verification">Verification</option>
                      <option value="funded">Funded</option>
                      <option value="inactive">Inactive</option>
                      <option value="breached">Breached</option>
                      <option value="payout">Payout</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500">Server MT5</label>
                    <input type="text" value={form.server} onChange={e => setForm({...form, server: e.target.value})}
                      placeholder="es. FTMO-Server3" className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500">Login MT5</label>
                    <input type="text" value={form.login} onChange={e => setForm({...form, login: e.target.value})}
                      placeholder="es. 12345678" className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500">Investor Password</label>
                    <input type="password" value={form.investor_password} onChange={e => setForm({...form, investor_password: e.target.value})}
                      placeholder="Password read-only" className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={saveAccount} disabled={saving}
                    className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
                    {saving ? 'Salvataggio...' : 'Salva'}
                  </button>
                  <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">Annulla</button>
                  {msg && <span className="text-sm text-green-600">{msg}</span>}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900">{acc.name}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      acc.status === 'active' ? 'bg-green-100 text-green-700' :
                      acc.status === 'inactive' ? 'bg-slate-100 text-slate-500' :
                      'bg-amber-100 text-amber-700'
                    }`}>{acc.status}</span>
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-slate-400">
                    <span>Server: {acc.server || 'Non configurato'}</span>
                    <span>Login: {acc.login || 'Non configurato'}</span>
                    <span>Password: {acc.investor_password ? '********' : 'Non configurata'}</span>
                  </div>
                  {acc.last_sync_at && (
                    <p className="text-xs text-slate-400 mt-1">Ultimo sync: {new Date(acc.last_sync_at).toLocaleString('it-IT')}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => startEdit(acc)}
                    className="px-3 py-1.5 text-sm text-violet-600 hover:text-violet-800 border border-violet-200 rounded-lg hover:bg-violet-50">
                    Configura
                  </button>
                  <button onClick={() => deleteAccount(acc.id, acc.name)}
                    className="px-2 py-1.5 text-sm text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Elimina conto">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {accounts.length === 0 && !showAdd && (
        <div className="bg-slate-50 rounded-xl border border-dashed border-slate-300 p-8 text-center">
          <p className="text-sm text-slate-500 mb-3">Nessun conto configurato</p>
          <button onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700">
            + Aggiungi il primo conto
          </button>
        </div>
      )}

      <div className="mt-6 bg-violet-50 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-violet-700 mb-2">Come funziona il monitoraggio</h3>
        <ol className="text-xs text-violet-600 space-y-1 list-decimal list-inside">
          <li>Aggiungi un conto con il pulsante qui sopra</li>
          <li>Inserisci server, login e investor password MT5</li>
          <li>Avvia il bridge Python sul VPS — si connette via investor (sola lettura)</li>
          <li>Ogni 5 minuti il bridge legge: balance, equity, posizioni aperte, trade chiusi</li>
          <li>I dati vengono pushati su Supabase e visualizzati nella sezione Quant</li>
          <li>Nessun rischio: accesso read-only, nessuna operazione di trading</li>
        </ol>
      </div>
    </div>
  )
}
