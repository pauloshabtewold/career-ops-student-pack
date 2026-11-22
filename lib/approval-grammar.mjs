// The student's batch approval in their own words. One grammar for every batch kind keeps the reply short:
// "approve all", "all except 3, 7", "submit all", "submit 1,3", "send all", "send 1,4".
const VERB = '(?:approve|submit|send)';
const LIST = '(\\d+(?:\\s*(?:,|and)\\s*\\d+)*)';
const FORMS = [
  { re: new RegExp(`^${VERB}\\s+all$`), kind: 'all' },
  { re: new RegExp(`^(?:${VERB}\\s+)?all\\s+(?:except|but)\\s+${LIST}$`), kind: 'except' },
  { re: new RegExp(`^${VERB}\\s+${LIST}$`), kind: 'only' },
];

const numbers = (list) => list.split(/\s*(?:,|and)\s*/).map(Number);

// Returns { items: [n...] } or { error } naming the part that did not parse or the item out of range.
export function parse(reply, itemCount) {
  const text = String(reply ?? '').trim().toLowerCase().replace(/[.!]+$/, '').replace(/\s+/g, ' ');
  const all = Array.from({ length: itemCount }, (_, i) => i + 1);
  for (const { re, kind } of FORMS) {
    const m = re.exec(text);
    if (!m) continue;
    if (kind === 'all') return { items: all };
    const listed = numbers(m[1]);
    const bad = listed.filter((n) => !Number.isInteger(n) || n < 1 || n > itemCount);
    if (bad.length) return { error: `item ${bad.join(', ')} is not in this batch of ${itemCount}` };
    const set = new Set(listed);
    return { items: kind === 'except' ? all.filter((n) => !set.has(n)) : [...set].sort((a, b) => a - b) };
  }
  return { error: `could not read "${String(reply ?? '').trim()}"; reply like "approve all", "all except 3, 7" or "submit 1,3"` };
}
