// The verdict-line grammar the model writes: TRIAGE: <verdict> | <url> | <score>[/5] | <reason>.
// Read by scripts/apply-triage.mjs (parsing a results file) and scripts/daily-triage.mjs (keeping only well-formed lines).
export const VERDICT_RE = /^TRIAGE:\s*(PASS|MARGINAL|FAIL|SKIP|EXPIRED|BROWSER)\s*\|\s*(\S+)\s*\|\s*([\d.]+)(?:\/5)?\s*\|\s*([^|]*)/;
