/**
 * core/src/parser/css.js
 * Zero-dependency CSS and SCSS parser for Graf Desktop.
 * Extracts selector rules, CSS variables (--var), SCSS variables ($var), and @import/@use/@forward.
 */

function buildLineIndex(source) {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }
  return lineStarts;
}

function getLineAt(lineStarts, index) {
  let low = 0, high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid] <= index) {
      if (mid === lineStarts.length - 1 || lineStarts[mid + 1] > index) {
        return mid + 1;
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return 1;
}

function cleanAssetPath(url) {
  return String(url || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .split(/[?#]/)[0]
    .trim();
}

function maskComments(source) {
  let out = '';
  let i = 0;
  const len = source.length;

  while (i < len) {
    const c = source[i];
    const n = source[i + 1];

    if (c === '/' && n === '*') {
      out += '  ';
      i += 2;
      while (i < len) {
        if (source[i] === '*' && source[i + 1] === '/') {
          out += '  ';
          i += 2;
          break;
        }
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }

    if (c === '/' && n === '/') {
      out += '  ';
      i += 2;
      while (i < len && source[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

function maskStrings(source) {
  let out = '';
  let i = 0;
  const len = source.length;

  while (i < len) {
    const c = source[i];

    if (c === '"' || c === "'") {
      const quote = c;
      out += ' ';
      i++;
      while (i < len) {
        const sc = source[i];
        if (sc === '\\') {
          out += ' ';
          i++;
          if (i < len) {
            out += source[i] === '\n' ? '\n' : ' ';
            i++;
          }
          continue;
        }
        if (sc === quote) {
          out += ' ';
          i++;
          break;
        }
        out += sc === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

function splitSelectors(raw) {
  const selectors = [];
  let cur = '';
  let depth = 0;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '(' || c === '[') {
      depth++;
      cur += c;
    } else if (c === ')' || c === ']') {
      if (depth > 0) depth--;
      cur += c;
    } else if (c === ',' && depth === 0) {
      const trimmed = cur.trim().replace(/\s+/g, ' ');
      if (trimmed) selectors.push(trimmed);
      cur = '';
    } else {
      cur += c;
    }
  }

  const lastTrimmed = cur.trim().replace(/\s+/g, ' ');
  if (lastTrimmed) selectors.push(lastTrimmed);

  return selectors;
}

export function parseCss(relPath, source, options = {}) {
  const lineOffset = options.lineOffset || 0;
  const fileId = options.fileId || `file:${relPath}`;
  const lineStarts = buildLineIndex(source);
  const noComments = maskComments(source);
  const clean = maskStrings(noComments);

  const nodes = [];
  const edges = [];
  const seenNodes = new Set();
  const seenImports = new Set();
  const selectorsSet = new Set();
  const variablesSet = new Set();

  // 1. Extract @import, @use, and @forward from noComments (strings intact)
  const importRegex = /@(import|use|forward)\s+(?:url\(\s*['"]?([^'"\)]+)['"]?\s*\)|['"]([^'"]+)['"])/g;
  let im;
  while ((im = importRegex.exec(noComments))) {
    const rawPath = im[2] || im[3];
    if (rawPath) {
      const cleanPath = cleanAssetPath(rawPath);
      if (cleanPath && !seenImports.has(cleanPath)) {
        seenImports.add(cleanPath);
        edges.push({
          src: fileId,
          dst: `module:${cleanPath}`,
          type: 'imports',
          provenance: 'verified',
          confidence: 1
        });
      }
    }
  }

  // 2. Extract CSS Custom Properties (--var) and SCSS Variables ($var)
  const varRegex = /(?:^|[;{\s])(--[a-zA-Z0-9_\-]+|\$[a-zA-Z0-9_\-]+)\s*:/g;
  let vm;
  while ((vm = varRegex.exec(clean))) {
    const varName = vm[1];
    const matchIdx = vm.index + vm[0].indexOf(varName);
    const line = getLineAt(lineStarts, matchIdx) + lineOffset;
    const isScssVar = varName.startsWith('$');
    const nodeId = `css:${relPath}#${varName}`;

    variablesSet.add(varName);
    if (!seenNodes.has(nodeId)) {
      seenNodes.add(nodeId);
      nodes.push({
        id: nodeId,
        kind: isScssVar ? 'scss-var' : 'css-var',
        path: relPath,
        name: varName,
        qualifiedName: varName,
        varName,
        isVariable: true,
        lineStart: line,
        lineEnd: line,
        summary: `${isScssVar ? 'SCSS' : 'CSS'} variable ${varName}`,
        provenance: 'verified',
        confidence: 1
      });
      edges.push({
        src: fileId,
        dst: nodeId,
        type: 'defines',
        provenance: 'verified',
        confidence: 1
      });
    }
  }

  // 3. Extract CSS Rules and Selectors
  let i = 0;
  const len = clean.length;
  let selectorBuffer = '';
  let selectorStartIdx = 0;

  while (i < len) {
    const c = clean[i];

    if (c === '{') {
      const openIdx = i;
      const rawHeader = noComments.slice(selectorStartIdx, openIdx).trim();

      let depth = 1;
      let j = i + 1;
      while (j < len && depth > 0) {
        if (clean[j] === '{') depth++;
        else if (clean[j] === '}') depth--;
        j++;
      }
      const closeIdx = j > openIdx + 1 ? (j <= len && depth === 0 ? j - 1 : len - 1) : openIdx;

      if (rawHeader) {
        if (rawHeader.startsWith('@keyframes') || rawHeader.startsWith('@-webkit-keyframes')) {
          const keyframeName = rawHeader.replace(/\s+/g, ' ');
          const lineStart = getLineAt(lineStarts, selectorStartIdx) + lineOffset;
          const lineEnd = getLineAt(lineStarts, closeIdx) + lineOffset;
          const nodeId = `css:${relPath}#${keyframeName}`;

          if (!seenNodes.has(nodeId)) {
            seenNodes.add(nodeId);
            nodes.push({
              id: nodeId,
              kind: 'css-rule',
              path: relPath,
              name: keyframeName,
              qualifiedName: keyframeName,
              lineStart,
              lineEnd,
              summary: `CSS rule ${keyframeName}`,
              provenance: 'verified',
              confidence: 1
            });
            edges.push({
              src: fileId,
              dst: nodeId,
              type: 'defines',
              provenance: 'verified',
              confidence: 1
            });
          }
          i = j;
          selectorBuffer = '';
          continue;
        }

        if (rawHeader.startsWith('@media') || rawHeader.startsWith('@supports') || rawHeader.startsWith('@container')) {
          i = openIdx + 1;
          selectorBuffer = '';
          continue;
        }

        if (rawHeader.startsWith('@font-face') || rawHeader.startsWith('@page')) {
          const ruleName = rawHeader.replace(/\s+/g, ' ');
          const lineStart = getLineAt(lineStarts, selectorStartIdx) + lineOffset;
          const lineEnd = getLineAt(lineStarts, closeIdx) + lineOffset;
          const nodeId = `css:${relPath}#${ruleName}`;

          if (!seenNodes.has(nodeId)) {
            seenNodes.add(nodeId);
            nodes.push({
              id: nodeId,
              kind: 'css-rule',
              path: relPath,
              name: ruleName,
              qualifiedName: ruleName,
              lineStart,
              lineEnd,
              summary: `CSS rule ${ruleName}`,
              provenance: 'verified',
              confidence: 1
            });
            edges.push({
              src: fileId,
              dst: nodeId,
              type: 'defines',
              provenance: 'verified',
              confidence: 1
            });
          }
          i = j;
          selectorBuffer = '';
          continue;
        }

        const selectors = splitSelectors(rawHeader);
        const lineStart = getLineAt(lineStarts, selectorStartIdx) + lineOffset;
        const lineEnd = getLineAt(lineStarts, closeIdx) + lineOffset;

        for (const sel of selectors) {
          if (!sel || sel === '{' || sel === ';') continue;
          selectorsSet.add(sel);
          const nodeId = `css:${relPath}#${sel}`;

          if (!seenNodes.has(nodeId)) {
            seenNodes.add(nodeId);
            nodes.push({
              id: nodeId,
              kind: 'css-rule',
              path: relPath,
              name: sel,
              qualifiedName: sel,
              selector: sel,
              lineStart,
              lineEnd,
              summary: `CSS rule ${sel}`,
              provenance: 'verified',
              confidence: 1
            });
            edges.push({
              src: fileId,
              dst: nodeId,
              type: 'defines',
              provenance: 'verified',
              confidence: 1
            });
          }
        }
      }

      if (depth > 0) {
        // Unclosed brace in malformed CSS
        break;
      }

      const innerHasNestedBrace = clean.slice(openIdx + 1, closeIdx).indexOf('{') !== -1;
      if (innerHasNestedBrace) {
        i = openIdx + 1;
      } else {
        i = j;
      }
      selectorBuffer = '';
      continue;
    } else if (c === '}') {
      selectorBuffer = '';
      i++;
      continue;
    } else if (c === ';') {
      selectorBuffer = '';
      i++;
      continue;
    } else {
      if (!selectorBuffer.trim() && !/\s/.test(c)) {
        selectorStartIdx = i;
      }
      selectorBuffer += c;
      i++;
    }
  }

  return { nodes, edges, selectors: selectorsSet, variables: variablesSet, parseOk: true };
}
