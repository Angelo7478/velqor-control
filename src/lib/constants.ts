export const DIVISIONS = {
  real_estate: {
    label: 'Real Estate',
    slug: 'real-estate',
    color: 'bg-division-re',
    textColor: 'text-division-re',
    icon: '🏠',
    href: '/divisioni/real-estate',
  },
  quant: {
    label: 'Quant',
    slug: 'quant',
    color: 'bg-division-quant',
    textColor: 'text-division-quant',
    icon: '📈',
    href: '/divisioni/quant',
  },
  ai: {
    label: 'AI',
    slug: 'ai',
    color: 'bg-division-ai',
    textColor: 'text-division-ai',
    icon: '🤖',
    href: '/divisioni/ai',
  },
  engineering: {
    label: 'Engineering',
    slug: 'engineering',
    color: 'bg-division-eng',
    textColor: 'text-division-eng',
    icon: '⚙️',
    href: '/divisioni/engineering',
  },
} as const

export type DivisionKey = keyof typeof DIVISIONS

export const MEMO_TYPES = {
  estimate: { label: 'Da stimare', color: 'bg-blue-100 text-blue-800' },
  evaluate: { label: 'Da valutare', color: 'bg-amber-100 text-amber-800' },
  execute: { label: 'Da eseguire', color: 'bg-green-100 text-green-800' },
  reminder: { label: 'Promemoria', color: 'bg-gray-100 text-gray-800' },
  deadline: { label: 'Scadenza', color: 'bg-red-100 text-red-800' },
} as const

export const PRIORITY_LEVELS = {
  low: { label: 'Bassa', color: 'bg-gray-100 text-gray-600' },
  medium: { label: 'Media', color: 'bg-blue-100 text-blue-700' },
  high: { label: 'Alta', color: 'bg-orange-100 text-orange-700' },
  critical: { label: 'Critica', color: 'bg-red-100 text-red-700' },
} as const

export const PROJECT_STATUSES = {
  draft: { label: 'Bozza', color: 'bg-gray-100 text-gray-600' },
  active: { label: 'Attivo', color: 'bg-green-100 text-green-700' },
  on_hold: { label: 'In pausa', color: 'bg-yellow-100 text-yellow-700' },
  completed: { label: 'Completato', color: 'bg-blue-100 text-blue-700' },
  archived: { label: 'Archiviato', color: 'bg-gray-100 text-gray-400' },
} as const

export const TASK_STATUSES = {
  todo: { label: 'Da fare', color: 'bg-gray-100 text-gray-600' },
  in_progress: { label: 'In corso', color: 'bg-blue-100 text-blue-700' },
  blocked: { label: 'Bloccato', color: 'bg-red-100 text-red-700' },
  done: { label: 'Fatto', color: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Annullato', color: 'bg-gray-100 text-gray-400' },
} as const
