// Report-line helpers for the scripts that print child-step results.
// oneLine: first non-empty line of a child's output or error text, cut to fit one report line.
// stepErrorText: the line for a failed child step, from stderr, then stdout, then the error message.
export const oneLine = (text, max = 160) => String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, max) ?? '';
export const stepErrorText = (err) => oneLine(err.stderr || err.stdout || err.message) || 'failed';
