// Third-party verification: public myfxbook URLs keyed by MT5 login.
// Shared between Builder report and Monthly report. Extend when new
// live-tracked accounts go public. Migrate to qel_accounts.myfxbook_url
// when the list grows past ~3 entries.

// Keys are MT5 account LOGINs (qel_accounts.login), NOT myfxbook IDs.
// The number embedded in the URL path (e.g. /11531537) is the myfxbook-side
// account id, not the MT5 login — easy to confuse.
export const MYFXBOOK_BY_LOGIN: Record<string, string> = {
  '540238990': 'https://www.myfxbook.com/members/AngeloPasian/ftmo-challenge-10k/11531537',
}

export function myfxbookUrlFor(login: string | null | undefined): string | null {
  if (!login) return null
  return MYFXBOOK_BY_LOGIN[login] ?? null
}
