'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Toast = { kind: 'success' | 'error'; text: string }

// Toast minimale per gli esiti di salvataggio (nessuna dipendenza esterna): mostra il
// messaggio — incluso l'errore Supabase testuale — in basso a destra e sparisce da solo.
export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const showToast = useCallback((kind: Toast['kind'], text: string) => {
    if (timer.current) clearTimeout(timer.current)
    setToast({ kind, text })
    timer.current = setTimeout(() => setToast(null), 8000)
  }, [])
  const toastNode = toast ? (
    <div role="alert" onClick={() => setToast(null)}
      className={`fixed bottom-4 right-4 z-50 max-w-md px-4 py-3 rounded-xl shadow-lg text-sm text-white cursor-pointer ${toast.kind === 'error' ? 'bg-red-600' : 'bg-green-600'}`}>
      {toast.text}
    </div>
  ) : null
  return { showToast, toastNode }
}
