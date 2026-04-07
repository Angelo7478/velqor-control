'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { TOOLTIP_CONTENT, type TooltipKey } from '@/lib/tooltip-content'

interface Props {
  metricKey: TooltipKey
  className?: string
}

export default function InfoTooltip({ metricKey, className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const content = TOOLTIP_CONTENT[metricKey]
  if (!content) return null

  const calcCoords = useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const popW = Math.min(320, window.innerWidth - 16) // max width, 8px margin each side
    const popH = 240 // estimated max height

    // Prefer below the button
    let top = rect.bottom + 8
    let left = rect.left + rect.width / 2 - popW / 2

    // If overflows bottom, show above
    if (top + popH > window.innerHeight - 8) {
      top = rect.top - popH - 8
    }
    // If still overflows top, just show below and let it scroll
    if (top < 8) top = 8

    // Clamp left to viewport
    if (left < 8) left = 8
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8

    setCoords({ top, left })
  }, [])

  useEffect(() => {
    if (!open) return
    calcCoords()

    function handleClickOutside(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function handleScroll() {
      setOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [open, calcCoords])

  const popupWidth = Math.min(320, typeof window !== 'undefined' ? window.innerWidth - 16 : 320)

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className={`ml-1 w-4 h-4 rounded-full bg-slate-200 hover:bg-violet-200 text-slate-500 hover:text-violet-700 text-[10px] font-bold inline-flex items-center justify-center transition-colors shrink-0 ${className}`}
        aria-label={`Info: ${content.title}`}
        type="button"
      >
        ?
      </button>

      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: popupWidth,
            zIndex: 9999,
          }}
          className="bg-slate-900 text-white rounded-xl shadow-2xl border border-slate-700 p-4 text-xs leading-relaxed"
        >
          <div className="flex items-start justify-between mb-2">
            <h4 className="font-semibold text-sm text-violet-300">{content.title}</h4>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white text-lg leading-none ml-2 -mt-1">&times;</button>
          </div>

          <p className="text-slate-300 mb-2">{content.description}</p>

          {content.formula && (
            <div className="bg-slate-800 rounded-lg px-3 py-2 mb-2 font-mono text-[11px] text-violet-200 break-all">
              {content.formula}
            </div>
          )}

          {content.example && (
            <div className="text-slate-400 border-t border-slate-700 pt-2 mt-2">
              <span className="text-slate-500 font-medium">Esempio: </span>
              {content.example}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
