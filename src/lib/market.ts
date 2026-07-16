/**
 * Macro mercato della Control Room: CFD | FUTURE.
 *
 * NON confondere con `qel_strategies.catalog`, che e' il BROKER ('ftmo' | 'darwinex'):
 * i due assi sono ortogonali, perche' Darwinex ha SIA conti CFD SIA conti futures.
 *
 * Il valore vive in `qel_accounts.market_type` e `qel_strategies.market_type`
 * (migration 005, default 'cfd' = tutto lo storico) ed e' selezionato globalmente
 * dal toggle in Sidebar, tenuto in `@/stores/ui`.
 */
export type MarketType = 'cfd' | 'futures'

export const MARKET_TYPES: readonly MarketType[] = ['cfd', 'futures'] as const

export const MARKET_LABELS: Record<MarketType, string> = {
  cfd: 'CFD',
  futures: 'FUTURE',
}

/**
 * Tetto di capitale per pattern identico, per macro.
 *
 * FTMO conta $400k per trader/strategia sommando TUTTI i conti, e sospende se rileva
 * strategie tradate identicamente oltre il tetto (MASTER sez. 8). Su Darwinex/futures
 * quel vincolo NON esiste: `null` = nessun tetto, e l'aggregatore capitale va nascosto.
 */
export const PATTERN_CAP_USD: Record<MarketType, number | null> = {
  cfd: 400_000,
  futures: null,
}
