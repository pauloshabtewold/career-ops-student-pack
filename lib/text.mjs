// First non-empty line of a child's output or error text, cut to fit one report line.
export const oneLine = (text, max = 160) => String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, max) ?? '';
