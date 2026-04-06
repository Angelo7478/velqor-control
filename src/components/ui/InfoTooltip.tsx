'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { TOOLTIP_CONTENT, type TooltipKey } from '@/lib/tooltip-content'

interface Props {
  metricKey: TooltipKey
  className?: string
}

export default function InfoTooltip({ metricKey, className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<'bottom' | 'top' | 'left' | 'right'>('bottom')
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const content = TOOLTIP_CONTENT[metricKey]
  if (!content) return null

  const calcPosition = useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const spaceRight = window.innerWidth - rect.right

    if (spaceBelow > 260) setPosition('bottom')
    else if (spaceAbove > 260) setPosition('top')
    else if (spaceRight > 320) setPosition('right')
    else setPosition('left')
  }, [])

  useEffect(() => {
    if (!open) return
    calcPosition()

    function handleClickOutside(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, calcPosition])

  const posClasses: Record<string, string> = {
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  }

  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="ml-1 w-4 h-4 rounded-full bg-slate-200 hover:bg-violet-200 text-slate-500 hover:text-violet-700 text-[10px] font-bold flex items-center justify-center transition-colors"
        aria-label={`Info: ${content.title}`}
        type="button"
      >
        ?
      </button>

      {open && (
        <div
          ref={popRef}
          className={`absolute z-50 ${posClasses[position]} w-72 sm:w-80 bg-slate-900 text-white rounded-xl shadow-xl border border-slate-700 p-4 text-xs leading-relaxed`}
        >
          <div className="flex items-start justify-between mb-2">
            <h4 className="font-semibold text-sm text-violet-300">{content.title}</h4>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white text-base leading-none ml-2">&times;</button>
          </div>

          <p className="text-slate-300 mb-2">{content.description}</p>

          {content.formula && (
            <div className="bg-slate-800 rounded-lg px-3 py-2 mb-2 font-mono text-[11px] text-violet-200">
              {content.formula}
            </div>
          )}

          {content.example && (
            <div className="text-slate-400 border-t border-slate-700 pt-2 mt-2">
              <span className="text-slate-500 font-medium">Esempio: </span>
              {content.example}
            </div>
          )}
        </div>
      )}
    </span>
  )
}
