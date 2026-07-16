export function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(' ')
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date))
}

export function formatDateTime(date: string | Date) {
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export function isOverdue(date: string | Date) {
  return new Date(date) < new Date()
}

export function daysUntil(date: string | Date) {
  const diff = new Date(date).getTime() - new Date().getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

// Le chiamate supabase-js possono non risolversi MAI (deadlock del lock auth dopo idle/refresh
// token): senza un tetto la UI resta bloccata su "Salvataggio…". Ogni scrittura passa da qui.
export function withTimeout<T>(p: PromiseLike<T>, ms = 10000, label = 'Operazione'): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: nessuna risposta dopo ${ms / 1000}s — riprova`)), ms)
    ),
  ])
}
