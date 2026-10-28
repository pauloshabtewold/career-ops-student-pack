// Read-only extractor for the Handshake job-search list. The student runs it in the browser console on a results
// page they opened themselves. It reads the visible job cards only: no clicks, no navigation, no requests.
// {{TITLE_REGEX}} is the preset's include rule and {{MAX_PAGES}} is the page cap (scripts/budget.mjs allows 4 per search).
// Each card link carries the job id; the card text lists company, title, details, location and age.
// Rows are stored as TSV (id, company, title, location, age) in window.__hs and copied to the clipboard.
(() => {
  const MAX_PAGES = {{MAX_PAGES}};
  const TITLE = new RegExp('{{TITLE_REGEX}}', 'i');
  const links = [...document.querySelectorAll('a[href*="/job-search/"]')].filter((a) => /\/job-search\/\d+/.test(a.getAttribute('href')));
  const rows = links
    .map((a) => {
      let n = a;
      // The anchor itself is empty; the card text lives on an ancestor a few levels up.
      for (let i = 0; i < 6 && n.parentElement && !(n.innerText || '').trim(); i++) n = n.parentElement;
      const lines = (n.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const dot = lines.lastIndexOf('∙');
      const id = a.getAttribute('href').match(/\/job-search\/(\d+)/)[1];
      return [id, lines[0] || '', lines[1] || '', dot > 0 ? lines[dot - 1] : '', lines[lines.length - 1] || ''].map((s) => s.replace(/[\t\n]/g, ' '));
    })
    .filter((r) => TITLE.test(r[2]));
  window.__hs = rows.map((r) => r.join('\t')).join('\n');
  if (navigator.clipboard) navigator.clipboard.writeText(window.__hs);
  return `${links.length} cards, ${rows.length} matching titles (stop after ${MAX_PAGES} pages per search)`;
})();
