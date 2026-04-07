export interface TooltipEntry {
  title: string
  description: string
  formula?: string
  example?: string
}

export type TooltipKey =
  | 'sharpe' | 'sortino' | 'calmar' | 'recovery_factor' | 'profit_factor'
  | 'kelly' | 'half_kelly' | 'optimal_f' | 'hrp'
  | 'fitness' | 'pendulum' | 'win_rate' | 'expectancy'
  | 'max_dd' | 'return_dd' | 'alpha' | 'payoff'
  | 'ror' | 'dd_budget' | 'correlation'
  | 'monte_carlo' | 'equity_curve' | 'regime'
  | 'margin_utilization' | 'margin_per_trade'
  | 'sizing_advisor'

export const TOOLTIP_CONTENT: Record<TooltipKey, TooltipEntry> = {
  sharpe: {
    title: 'Sharpe Ratio',
    description: 'Misura il rendimento aggiustato per il rischio. Quanto guadagni per ogni unita di rischio assunta. Valori >1 sono buoni, >2 eccellenti, >3 rari nel trading reale.',
    formula: 'Sharpe = (rendimento medio - risk-free) / deviazione std',
    example: 'Se guadagni in media 2% al mese con volatilita 1.5%, Sharpe annualizzato = (2/1.5) * sqrt(12) = 4.62',
  },
  sortino: {
    title: 'Sortino Ratio',
    description: 'Come lo Sharpe, ma considera solo la volatilita al ribasso (le perdite). Piu rilevante per il trading perche non penalizza i mesi con guadagni eccezionali.',
    formula: 'Sortino = rendimento medio / downside deviation',
    example: 'Un Sortino di 5 indica che il rendimento medio e 5 volte superiore alla volatilita negativa.',
  },
  calmar: {
    title: 'Calmar Ratio',
    description: 'Rapporto tra rendimento annualizzato e drawdown massimo. Indica quanti anni servirebbero per recuperare dal peggior drawdown storico. Valori >2 sono buoni.',
    formula: 'Calmar = CAGR / Max Drawdown',
    example: 'CAGR 23%, Max DD 2.81% → Calmar = 8.2 (eccellente, recupero in ~1.5 mesi).',
  },
  recovery_factor: {
    title: 'Recovery Factor',
    description: 'Rapporto tra profitto netto totale e drawdown massimo. Indica quante volte il profitto copre la peggiore perdita. Valori >3 indicano buona resilienza.',
    formula: 'Recovery Factor = Profitto Netto / Max Drawdown',
    example: 'Profitto $720, Max DD $320 → RF = 2.25 (il profitto copre 2.25 volte il peggior DD).',
  },
  profit_factor: {
    title: 'Profit Factor',
    description: 'Rapporto tra la somma dei guadagni e la somma delle perdite. Se >1 il sistema e profittevole. Valori tra 1.5 e 2.5 sono tipici di buoni sistemi.',
    formula: 'PF = somma vincite / somma perdite',
    example: 'Vincite totali $1500, perdite totali $750 → PF = 2.0 (per ogni $1 perso, ne guadagni $2).',
  },
  kelly: {
    title: 'Kelly Criterion',
    description: 'Formula che calcola la frazione ottimale del capitale da rischiare per massimizzare la crescita geometrica nel lungo periodo. Mai usare il Kelly pieno in pratica — troppo aggressivo.',
    formula: 'f* = W - (1-W)/R dove W=win rate, R=payoff ratio',
    example: 'Win rate 65%, payoff 1.5 → f* = 0.65 - 0.35/1.5 = 41.7%. In pratica si usa Half-Kelly (20.8%).',
  },
  half_kelly: {
    title: 'Half-Kelly',
    description: 'Meta del Kelly pieno. Riduce la varianza del ~75% sacrificando solo il ~25% del rendimento atteso. E il compromesso standard nel trading professionale.',
    formula: 'Half-Kelly = f* / 2',
    example: 'Kelly pieno 41.7% → Half-Kelly 20.8%. Crescita piu lenta ma molto piu stabile.',
  },
  optimal_f: {
    title: 'Optimal-f',
    description: 'Variante del Kelly di Ralph Vince. Calcola la frazione ottimale basandosi sul peggior trade storico anziche sulla media. Piu conservativo del Kelly classico.',
    formula: 'Optimal-f = (max trade / -worst trade) * kelly',
  },
  hrp: {
    title: 'HRP (Hierarchical Risk Parity)',
    description: 'Metodo di allocazione che usa le correlazioni tra strategie per distribuire il rischio. A differenza di Markowitz, non richiede inversione della matrice di covarianza e gestisce meglio portafogli reali.',
    example: 'Il budget DD viene prima diviso tra famiglie (RSI2, Seasonal, Trend), poi equi-distribuito dentro ogni famiglia.',
  },
  fitness: {
    title: 'Fitness Score',
    description: 'Punteggio 0-100 che valuta la salute complessiva di una strategia. Combina win rate (25%), contenimento DD (30%), expectancy (25%), payoff (10%) e confidenza statistica (10%).',
    example: 'Una strategia con WR 65%, DD basso, expectancy positiva e 100+ trade ottiene ~75/100.',
  },
  pendulum: {
    title: 'Pendulum',
    description: 'Moltiplicatore di sizing dinamico basato sulla fase attuale della strategia. Riduce al peak (0.85x), mantiene nella media (1.0x), aumenta in drawdown se l\'edge e validato (fino a 1.3x).',
    example: 'Strategia in DD del 3% con edge confermato → pendulum 1.15x (sizing leggermente aggressivo per sfruttare la mean reversion).',
  },
  win_rate: {
    title: 'Win Rate',
    description: 'Percentuale di trade chiusi in profitto. Da solo non indica se un sistema e buono — serve abbinarlo al payoff ratio. Un WR del 40% con payoff 3:1 e meglio di un WR 80% con payoff 0.3:1.',
    formula: 'Win Rate = trade vincenti / trade totali * 100',
  },
  expectancy: {
    title: 'Expectancy',
    description: 'Guadagno medio atteso per ogni trade. E il valore piu importante: se positivo, il sistema ha un edge statistico. Considera sia win rate che payoff ratio.',
    formula: 'E = (WR * avg_win) - ((1-WR) * avg_loss)',
    example: 'WR 60%, avg win $50, avg loss $40 → E = 0.6*50 - 0.4*40 = $14 per trade.',
  },
  max_dd: {
    title: 'Max Drawdown',
    description: 'Massima perdita dal picco di equity al punto piu basso, prima di un nuovo massimo. E il rischio peggiore realizzato. Per le prop firm FTMO: limite 5% giornaliero, 10% totale.',
    example: 'Equity picco $10,700, scende a $10,380 → DD = $320 (2.99%).',
  },
  return_dd: {
    title: 'Return/DD',
    description: 'Rapporto tra rendimento percentuale e drawdown massimo. Indica l\'efficienza rischio-rendimento. Valori >10 sono buoni, >30 eccellenti.',
    formula: 'R/DD = rendimento % / max drawdown %',
    example: 'Rendimento 7.19%, DD 2.81% → R/DD = 2.56 (valore modesto, servono piu mesi).',
  },
  alpha: {
    title: 'Alpha vs Buy-and-Hold',
    description: 'Rendimento in eccesso della strategia rispetto al semplice buy-and-hold del sottostante. Se positivo, la strategia aggiunge valore rispetto a tenere l\'asset. Se negativo, avresti fatto meglio a non fare nulla.',
    formula: 'Alpha = rendimento strategia - rendimento buy-and-hold',
    example: 'Strategia +12%, SP500 nello stesso periodo +8% → Alpha = +4%.',
  },
  payoff: {
    title: 'Payoff Ratio (Reward/Risk)',
    description: 'Rapporto tra guadagno medio dei trade vincenti e perdita media dei perdenti. Un payoff >1 significa che quando vinci, guadagni piu di quando perdi.',
    formula: 'Payoff = media vincite / media perdite',
    example: 'Media vincita $80, media perdita $50 → Payoff = 1.6:1.',
  },
  ror: {
    title: 'Risk of Ruin',
    description: 'Probabilita statistica di raggiungere il livello di rovina (default 10% per prop firm). Deve essere <5% per operare tranquillamente. Si basa su win rate, payoff e sizing.',
    formula: 'RoR = ((1-edge)/(1+edge))^(capital/risk_per_trade)',
    example: 'Con Kelly sizing corretto, RoR tipico = 0.1-2%.',
  },
  dd_budget: {
    title: 'DD Budget',
    description: 'Il drawdown massimo allocato a ciascuna strategia nel portafoglio. La somma dei DD budget individuali non deve superare il limite totale del conto (es. 10% per FTMO).',
    example: 'Budget totale 8% su 16 strategie → ~0.5% per strategia. Le strategie piu forti ricevono piu budget via HRP.',
  },
  correlation: {
    title: 'Correlazione',
    description: 'Misura quanto due strategie si muovono insieme. Va da -1 (opposta) a +1 (identica). Strategie con correlazione <0.5 diversificano bene. Usiamo Pearson su P/L giornaliero dove ci sono almeno 10 giorni di overlap.',
    example: 'RSI2 SP500 StdDev e RSI2 SP500 BB: correlazione ~0.7 (alta, stessa logica). RSI2 SP500 e BTC Trend: correlazione ~0.1 (bassa, diversificano).',
  },
  monte_carlo: {
    title: 'Monte Carlo',
    description: 'Simulazione che ricampiona casualmente i trade reali per generare migliaia di possibili percorsi di equity. Mostra la distribuzione dei risultati possibili, non solo il caso storico.',
    example: 'Con 500 trade e 10,000 simulazioni: il 95% dei percorsi ha DD <4.5%, il 5% peggiore ha DD >6%.',
  },
  equity_curve: {
    title: 'Equity Curve',
    description: 'Grafico del valore del conto nel tempo, calcolato sommando progressivamente il P/L di ogni trade chiuso. Una curva crescente e regolare indica un edge stabile.',
  },
  regime: {
    title: 'Regime di Mercato',
    description: 'Fase attuale del mercato: trending, ranging o alta volatilita. Le strategie mean reversion funzionano meglio in range, le trend following in trend. Un mismatch regime-strategia spiega perdite temporanee senza edge rotto.',
  },
  margin_utilization: {
    title: 'Utilizzo Margine',
    description: 'Percentuale del capitale impegnata come margine per le posizioni aperte. Un utilizzo troppo alto riduce il margine libero disponibile per nuove operazioni e aumenta il rischio di margin call. Per FTMO, mantenere sotto il 50% e ideale.',
    formula: 'Utilizzo % = (somma margini per posizione / equity base) * 100',
    example: 'Equity $10,000, 3 strategie con margine totale $2,500 → utilizzo 25%. Margine libero = $7,500.',
  },
  margin_per_trade: {
    title: 'Margine per Posizione',
    description: 'Capitale richiesto dal broker per mantenere una posizione aperta. Dipende dal simbolo, dalla leva e dal valore nozionale. Leva FTMO: 1:100 (Forex), 1:20 (Indici), 1:10 (Commodities), 1:2 (Crypto).',
    formula: 'Margine = lotti * dimensione contratto * prezzo * (1 / leva)',
    example: 'US500.cash 0.10 lotti, prezzo 5800: nozionale = $580. Con leva 1:20, margine = $29.',
  },
  sizing_advisor: {
    title: 'Sizing Advisor',
    description: 'Analizza fitness, pendulum, salute e regime di ogni strategia per suggerire aggiustamenti al sizing. I suggerimenti vanno dal +30% (edge forte in recovery) al -30% (DD elevato) fino alla pausa (strategia rotta). Sistema a regole deterministico basato sui dati reali vs test.',
    example: 'Strategia con fitness 85/100 in fase drawdown ma edge confermato: pendulum +20%. Strategia con DD 2x test e P/L negativo: riduzione 30%.',
  },
}
