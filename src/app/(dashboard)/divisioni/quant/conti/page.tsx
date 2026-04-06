'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { QelAccount } from '@/types/database'
import QuantNav from '../quant-nav'

function fmt(n: number | null, decimals = 2): string {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function timeAgo(dateStr: string | null): { text: string; isOnline: boolean; isWarning: boolean } {
  if (!dateStr) return { text: 'Mai sincronizzato', isOnline: false, isWarning: false }
  const diff = (Date.now() - new Date(dateStr).getTime()) / 60000 // minuti
  if (diff < 10) return { text: `${Math.round(diff)}m fa`, isOnline: true, isWarning: false }
  if (diff < 60) return { text: `${Math.round(diff)}m fa`, isOnline: false, isWarning: true }
  if (diff < 1440) return { text: `${Math.round(diff / 60)}h fa`, isOnline: false, isWarning: false }
  return { text: `${Math.round(diff / 1440)}g fa`, isOnline: false, isWarning: false }
}

export default function ContiConfigPage() {
  const [accounts, setAccounts] = useState<QelAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', server: '', login: '', investor_password: '', status: 'active', vps_name: '', mt5_terminal_path: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', broker: 'FTMO', account_size: '10000', currency: 'USD', server: '', login: '', investor_password: '', status: 'active' })
  const [addSaving, setAddSaving] = useState(false)
  const [addMsg, setAddMsg] = useState('')
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)

  useEffect(() => { loadAccounts() }, [])

  // Auto-refresh ogni 30 secondi per aggiornare le spie
  useEffect(() => {
    const interval = setInterval(loadAccounts, 30000)
    return () => clearInterval(interval)
  }, [])

  async function loadAccounts() {
    const supabase = createClient()
    const { data } = await supabase.from('qel_accounts').select('*').order('account_size')
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
      vps_name: acc.vps_name || '',
      mt5_terminal_path: acc.mt5_terminal_path || '',
    })
    setMsg('')
  }

  async function saveAccount() {
    if (!editing) return
    setSaving(true)
    setMsg('')
    try {
      const supabase = createClient()
      const { data, error } = await supabase.from('qel_accounts').update({
        name: form.name,
        server: form.server || null,
        login: form.login || null,
        investor_password: form.investor_password || null,
        status: form.status as QelAccount['status'],
        vps_name: form.vps_name || null,
        mt5_terminal_path: form.mt5_terminal_path || null,
      }).eq('id', editing).select()

      if (error) {
        setMsg(`Errore: ${error.message}`)
      } else if (!data || data.length === 0) {
        setMsg('Errore: nessun record aggiornato')
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
        setAddMsg('Errore: conto non creato')
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

  function copyCommand(cmd: string, id: string) {
    navigator.clipboard.writeText(cmd)
    setCopiedCmd(id)
    setTimeout(() => setCopiedCmd(null), 2000)
  }

  if (loading) return <p className="text-slate-500 p-4">Caricamento...</p>

  // Count online bridges
  const onlineCount = accounts.filter(a => {
    if (!a.last_sync_at) return false
    return (Date.now() - new Date(a.last_sync_at).getTime()) < 600000 // 10 min
  }).length

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <QuantNav />
        <div className="flex justify-between items-start mt-1">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Configurazione Conti</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {accounts.length} conti — {onlineCount}/{accounts.length} bridge online
            </p>
          </div>
          <button onClick={() => { setShowAdd(!showAdd); setAddMsg('') }}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 flex items-center gap-1.5">
            <span className="text-lg leading-none">+</span> Aggiungi conto
          </button>
        </div>
      </div>

      {/* Add Account Form */}
      {showAdd && (
        <div className="bg-violet-50 rounded-xl border border-violet-200 p-4">
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

      {/* Account Cards */}
      <div className="space-y-3">
        {accounts.map(acc => {
          const sync = timeAgo(acc.last_sync_at)
          const hasVps = !!acc.vps_name
          const launchCmd = hasVps ? `cd C:\\mt5-bridge && python launcher.py --vps ${acc.vps_name}` : ''
          const statusCmd = hasVps && acc.mt5_terminal_path ? `cd C:\\mt5-bridge && python bridge.py --mt5-path "${acc.mt5_terminal_path}" status` : ''

          return (
            <div key={acc.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {editing === acc.id ? (
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                    <div>
                      <label className="text-xs font-medium text-slate-500">VPS Name</label>
                      <input type="text" value={form.vps_name} onChange={e => setForm({...form, vps_name: e.target.value})}
                        placeholder="es. VPS_10K" className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500">MT5 Path</label>
                      <input type="text" value={form.mt5_terminal_path} onChange={e => setForm({...form, mt5_terminal_path: e.target.value})}
                        placeholder="C:\...\terminal64.exe" className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
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
                        className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={saveAccount} disabled={saving}
                      className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
                      {saving ? 'Salvataggio...' : 'Salva'}
                    </button>
                    <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">Annulla</button>
                    {msg && <span className={`text-sm ${msg.startsWith('Errore') ? 'text-red-600' : 'text-green-600'}`}>{msg}</span>}
                  </div>
                </div>
              ) : (
                <>
                  {/* Header con spia bridge */}
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* Bridge status indicator */}
                        <div className="relative" title={sync.isOnline ? `Bridge online — ${sync.text}` : `Bridge offline — ${sync.text}`}>
                          <div className={`w-3 h-3 rounded-full ${
                            sync.isOnline ? 'bg-green-500' :
                            sync.isWarning ? 'bg-amber-500' :
                            acc.last_sync_at ? 'bg-red-500' : 'bg-slate-300'
                          }`} />
                          {sync.isOnline && (
                            <div className="absolute inset-0 w-3 h-3 rounded-full bg-green-500 animate-ping opacity-50" />
                          )}
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-slate-900">{acc.name}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              acc.status === 'active' ? 'bg-green-100 text-green-700' :
                              acc.status === 'funded' ? 'bg-blue-100 text-blue-700' :
                              acc.status === 'inactive' || acc.status === 'breached' ? 'bg-slate-100 text-slate-500' :
                              'bg-amber-100 text-amber-700'
                            }`}>{acc.status}</span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-slate-400">
                            <span>Login: <span className="text-slate-600 font-mono">{acc.login || '—'}</span></span>
                            <span>Server: <span className="text-slate-600">{acc.server || '—'}</span></span>
                            <span>Capitale: <span className="text-slate-600">${fmt(acc.account_size, 0)}</span></span>
                            <span>Sync: <span className={`font-medium ${
                              sync.isOnline ? 'text-green-600' :
                              sync.isWarning ? 'text-amber-600' :
                              acc.last_sync_at ? 'text-red-600' : 'text-slate-400'
                            }`}>{sync.text}</span></span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button onClick={() => startEdit(acc)}
                          className="px-3 py-1.5 text-sm text-violet-600 hover:text-violet-800 border border-violet-200 rounded-lg hover:bg-violet-50">
                          Configura
                        </button>
                        <button onClick={() => deleteAccount(acc.id, acc.name)}
                          className="px-2 py-1.5 text-sm text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Elimina conto">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Quick stats */}
                    {acc.last_sync_at && (
                      <div className="flex gap-4 mt-3 pt-3 border-t border-slate-100">
                        <div className="text-center">
                          <p className="text-[10px] text-slate-400">Balance</p>
                          <p className="text-sm font-semibold text-slate-700">${fmt(acc.balance, 0)}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] text-slate-400">Equity</p>
                          <p className="text-sm font-semibold text-slate-700">${fmt(acc.equity, 0)}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] text-slate-400">Floating</p>
                          <p className={`text-sm font-semibold ${acc.floating_pl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {acc.floating_pl >= 0 ? '+' : ''}${fmt(acc.floating_pl)}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] text-slate-400">DD Totale</p>
                          <p className={`text-sm font-semibold ${
                            acc.total_dd_pct > 8 ? 'text-red-600' : acc.total_dd_pct > 5 ? 'text-amber-600' : 'text-slate-700'
                          }`}>{fmt(acc.total_dd_pct, 1)}%</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] text-slate-400">Max DD</p>
                          <p className={`text-sm font-semibold ${
                            acc.max_total_dd_pct > 8 ? 'text-red-600' : acc.max_total_dd_pct > 5 ? 'text-amber-600' : 'text-slate-700'
                          }`}>{fmt(acc.max_total_dd_pct, 1)}%</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* VPS & Bridge Info */}
                  {hasVps && (
                    <div className="bg-slate-50 border-t border-slate-200 px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-slate-500">VPS:</span>
                          <span className="text-xs font-mono text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                            {acc.vps_name}
                          </span>
                          {acc.mt5_terminal_path && (
                            <>
                              <span className="text-xs text-slate-400">|</span>
                              <span className="text-[10px] text-slate-400 truncate max-w-xs" title={acc.mt5_terminal_path}>
                                {acc.mt5_terminal_path}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Comandi PowerShell */}
                      <div className="space-y-1.5">
                        {launchCmd && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 w-12 shrink-0">Avvio:</span>
                            <code className="text-[10px] font-mono text-slate-600 bg-white px-2 py-1 rounded border border-slate-200 flex-1 truncate">
                              {launchCmd}
                            </code>
                            <button
                              onClick={() => copyCommand(launchCmd, `launch-${acc.id}`)}
                              className="text-[10px] px-2 py-1 text-violet-600 hover:bg-violet-50 rounded border border-violet-200 shrink-0"
                            >
                              {copiedCmd === `launch-${acc.id}` ? 'Copiato!' : 'Copia'}
                            </button>
                          </div>
                        )}
                        {statusCmd && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 w-12 shrink-0">Status:</span>
                            <code className="text-[10px] font-mono text-slate-600 bg-white px-2 py-1 rounded border border-slate-200 flex-1 truncate">
                              {statusCmd}
                            </code>
                            <button
                              onClick={() => copyCommand(statusCmd, `status-${acc.id}`)}
                              className="text-[10px] px-2 py-1 text-violet-600 hover:bg-violet-50 rounded border border-violet-200 shrink-0"
                            >
                              {copiedCmd === `status-${acc.id}` ? 'Copiato!' : 'Copia'}
                            </button>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400 w-12 shrink-0">Setup:</span>
                          <code className="text-[10px] font-mono text-slate-600 bg-white px-2 py-1 rounded border border-slate-200 flex-1 truncate">
                            cd C:\mt5-bridge && python setup.py
                          </code>
                          <button
                            onClick={() => copyCommand('cd C:\\mt5-bridge && python setup.py', `setup-${acc.id}`)}
                            className="text-[10px] px-2 py-1 text-violet-600 hover:bg-violet-50 rounded border border-violet-200 shrink-0"
                          >
                            {copiedCmd === `setup-${acc.id}` ? 'Copiato!' : 'Copia'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {!hasVps && acc.status === 'active' && (
                    <div className="bg-amber-50 border-t border-amber-200 px-4 py-2">
                      <p className="text-[10px] text-amber-700">
                        Bridge non configurato — Clicca &quot;Configura&quot; per impostare VPS e percorso MT5, oppure lancia <code className="bg-amber-100 px-1 rounded">python setup.py</code> sulla VPS
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
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

      {/* Quick Reference */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Setup Bridge — Quick Reference</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">
          <div>
            <p className="font-medium text-slate-700 mb-1">Prima installazione su una VPS:</p>
            <ol className="space-y-0.5 list-decimal list-inside text-[11px]">
              <li>Copia cartella <code className="bg-white px-1 rounded border">mt5-bridge</code> in <code className="bg-white px-1 rounded border">C:\mt5-bridge</code></li>
              <li>Apri MT5 e logga al conto (investor password)</li>
              <li><code className="bg-white px-1 rounded border">cd C:\mt5-bridge && python setup.py</code></li>
              <li>Il setup rileva MT5 e associa il conto</li>
              <li><code className="bg-white px-1 rounded border">python launcher.py --vps NOME_VPS</code></li>
            </ol>
          </div>
          <div>
            <p className="font-medium text-slate-700 mb-1">Spie bridge:</p>
            <div className="space-y-1 text-[11px]">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" /> Online — sync &lt; 10 min
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Warning — sync 10-60 min
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500" /> Offline — sync &gt; 60 min
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-slate-300" /> Mai sincronizzato
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
