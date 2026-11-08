// Tiny, dependency-free line highlighter for the read-only source viewer. Output is always HTML-escaped.
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const KW = {
  js: 'import export from default const let var function return if else for while do switch case break continue new class extends async await try catch finally throw typeof instanceof in of this super null undefined true false static get set yield delete void interface type enum implements public private protected readonly',
  py: 'import from as def class return if elif else for while in not and or is None True False try except finally raise with lambda pass break continue yield async await global nonlocal self',
  java: 'import package class interface enum extends implements public private protected static final void return if else for while do switch case break continue new try catch finally throw throws this super null true false abstract synchronized instanceof int long double float boolean char byte short String var'
};
const LANG = { javascript: 'js', typescript: 'js', jsx: 'js', tsx: 'js', python: 'py', java: 'java' };
const sets = Object.fromEntries(Object.entries(KW).map(([k, v]) => [k, new Set(v.split(' '))]));
const span = (cls, text) => `<span class="tk-${cls}">${esc(text)}</span>`;

export function highlightLines(lines, language) {
  const lang = LANG[language] || null;
  if (language === 'yaml' || language === 'dotenv') {
    return lines.map(line => {
      if (/^\s*#/.test(line)) return span('c', line);
      const m = line.match(/^(\s*-?\s*)([\w.\-\/]+)(\s*[:=])(.*)$/);
      return m ? `${esc(m[1])}${span('k', m[2])}${esc(m[3])}${span('s', m[4])}` : esc(line);
    });
  }
  if (!lang) return lines.map(esc);
  const kw = sets[lang];
  let inBlock = false;
  const tokenRe = lang === 'py'
    ? /(#.*$)|("""|'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d[\d_.]*\b)|([A-Za-z_]\w*)/g
    : /(\/\/.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)/g;
  return lines.map(line => {
    let out = ''; let pos = 0;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) return span('c', line);
      out += span('c', line.slice(0, end + 2)); pos = end + 2; inBlock = false;
    }
    const rest = line.slice(pos); let last = 0; let m;
    tokenRe.lastIndex = 0;
    // Handle /* … */ block comments for C-like languages before the token pass.
    const blockStart = lang !== 'py' ? rest.indexOf('/*') : -1;
    const scan = blockStart >= 0 ? rest.slice(0, blockStart) : rest;
    while ((m = tokenRe.exec(scan))) {
      out += esc(scan.slice(last, m.index)); last = m.index + m[0].length;
      if (m[1]) out += span('c', m[1]);
      else if (m[2]) out += span('s', m[2]);
      else if (m[3]) out += span('n', m[3]);
      else if (kw.has(m[4])) out += span('k', m[4]);
      else if (/^\s*\(/.test(scan.slice(last))) out += span('f', m[4]);
      else out += esc(m[4]);
    }
    out += esc(scan.slice(last));
    if (blockStart >= 0) {
      const tail = rest.slice(blockStart); const close = tail.indexOf('*/', 2);
      if (close === -1) { out += span('c', tail); inBlock = true; } else out += span('c', tail.slice(0, close + 2)) + esc(tail.slice(close + 2));
    }
    return out;
  });
}
