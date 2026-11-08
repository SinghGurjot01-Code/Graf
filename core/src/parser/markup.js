/**
 * core/src/parser/markup.js
 * Zero-dependency HTML and DOM tokenizer for Graf Desktop.
 * Indexes element IDs (#id), classes (.class), <script src>, and <link rel="stylesheet">.
 */

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

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

export function parseMarkup(relPath, source, options = {}) {
  const lineOffset = options.lineOffset || 0;
  const fileId = options.fileId || `file:${relPath}`;
  const lineStarts = buildLineIndex(source);

  const nodes = [];
  const edges = [];
  const seenIds = new Set();
  const seenClasses = new Set();
  const seenImports = new Set();
  const domIds = new Set();
  const domClasses = new Set();

  let i = 0;
  const len = source.length;

  while (i < len) {
    const tagOpen = source.indexOf('<', i);
    if (tagOpen === -1) break;
    i = tagOpen;

    // 1. Skip HTML Comments: <!-- ... -->
    if (source.startsWith('<!--', i)) {
      const commentEnd = source.indexOf('-->', i + 4);
      i = commentEnd === -1 ? len : commentEnd + 3;
      continue;
    }

    // 2. Skip DOCTYPE, CDATA, and Declarations: <! ... >
    if (source.startsWith('<!', i)) {
      if (source.startsWith('<![CDATA[', i)) {
        const cdataEnd = source.indexOf(']]>', i + 9);
        i = cdataEnd === -1 ? len : cdataEnd + 3;
        continue;
      }
      const declEnd = source.indexOf('>', i + 2);
      i = declEnd === -1 ? len : declEnd + 1;
      continue;
    }

    // 3. Skip XML Processing Instructions: <? ... ?>
    if (source.startsWith('<?', i)) {
      const piEnd = source.indexOf('?>', i + 2);
      i = piEnd === -1 ? len : piEnd + 2;
      continue;
    }

    // 4. Skip Closing Tags: </tag>
    if (source.startsWith('</', i)) {
      const closeEnd = source.indexOf('>', i + 2);
      i = closeEnd === -1 ? len : closeEnd + 1;
      continue;
    }

    // 5. Opening or Void Tag: <tag ... >
    i++;
    const nameStart = i;
    while (i < len && /[a-zA-Z0-9_\-:]/.test(source[i])) {
      i++;
    }
    const rawTagName = source.slice(nameStart, i);
    const tagName = rawTagName.toLowerCase();

    if (!tagName) {
      continue;
    }

    const tagStartLine = getLineAt(lineStarts, tagOpen) + lineOffset;

    // 6. Scan Tag Attributes until unquoted '>'
    let inQuote = null;
    const attrMap = Object.create(null);
    let attrScanStart = i;

    while (i < len) {
      const c = source[i];
      if (inQuote) {
        if (c === inQuote) {
          inQuote = null;
        }
      } else if (c === '"' || c === "'") {
        inQuote = c;
      } else if (c === '>') {
        break;
      }
      i++;
    }

    const rawAttrs = source.slice(attrScanStart, i);
    if (i < len && source[i] === '>') {
      i++;
    }

    const attrRegex = /([a-zA-Z0-9_\-:]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let am;
    while ((am = attrRegex.exec(rawAttrs))) {
      const attrName = am[1].toLowerCase();
      const attrVal = am[2] !== undefined ? am[2] : (am[3] !== undefined ? am[3] : (am[4] !== undefined ? am[4] : ''));
      attrMap[attrName] = attrVal;
    }

    // 7. Script Tag Handling
    if (tagName === 'script') {
      const src = attrMap['src'];
      if (src) {
        const clean = cleanAssetPath(src);
        if (clean && !seenImports.has(clean)) {
          seenImports.add(clean);
          edges.push({
            src: fileId,
            dst: `module:${clean}`,
            type: 'imports',
            provenance: 'verified',
            confidence: 1
          });
        }
      }
      const scriptClose = source.toLowerCase().indexOf('</script>', i);
      if (scriptClose !== -1) {
        i = scriptClose + 9;
      }
      continue;
    }

    // 8. Style Tag Handling
    if (tagName === 'style') {
      const styleClose = source.toLowerCase().indexOf('</style>', i);
      if (styleClose !== -1) {
        i = styleClose + 8;
      }
      continue;
    }

    // 9. Stylesheet Link Tag Handling
    if (tagName === 'link') {
      const rel = (attrMap['rel'] || '').toLowerCase();
      const href = attrMap['href'];
      if (href && (rel.includes('stylesheet') || /\.css(\?.*)?$/i.test(href))) {
        const clean = cleanAssetPath(href);
        if (clean && !seenImports.has(clean)) {
          seenImports.add(clean);
          edges.push({
            src: fileId,
            dst: `module:${clean}`,
            type: 'imports',
            provenance: 'verified',
            confidence: 1
          });
        }
      }
      continue;
    }

    // 9.5 Body Tag Handling
    if (tagName === 'body') {
      const bodyNodeId = `dom:${relPath}#body`;
      if (!seenIds.has(bodyNodeId)) {
        seenIds.add(bodyNodeId);
        nodes.push({
          id: bodyNodeId,
          kind: 'dom',
          path: relPath,
          name: 'body',
          qualifiedName: 'body',
          tagName: 'body',
          domId: 'body',
          lineStart: tagStartLine,
          lineEnd: tagStartLine,
          summary: '<body> DOM element',
          provenance: 'verified',
          confidence: 1
        });
        edges.push({
          src: fileId,
          dst: bodyNodeId,
          type: 'defines',
          provenance: 'verified',
          confidence: 1
        });
      }
    }

    // 10. DOM ID Extraction
    const idVal = (attrMap['id'] || '').trim();
    if (idVal) {
      domIds.add(idVal);
      const nodeId = `dom:${relPath}#${idVal}`;
      if (!seenIds.has(nodeId)) {
        seenIds.add(nodeId);
        nodes.push({
          id: nodeId,
          kind: 'dom',
          path: relPath,
          name: `#${idVal}`,
          qualifiedName: `#${idVal}`,
          tagName,
          domId: idVal,
          lineStart: tagStartLine,
          lineEnd: tagStartLine,
          summary: `<${tagName} id="${idVal}"> DOM element`,
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

    // 11. DOM Class Extraction
    const classVal = (attrMap['class'] || attrMap['classname'] || '').trim();
    if (classVal) {
      const classes = classVal.split(/\s+/).filter(Boolean);
      for (const cls of classes) {
        domClasses.add(cls);
        const classNodeId = `dom:${relPath}#.class-${cls}`;
        if (!seenClasses.has(classNodeId)) {
          seenClasses.add(classNodeId);
          nodes.push({
            id: classNodeId,
            kind: 'dom',
            path: relPath,
            name: `.${cls}`,
            qualifiedName: `.${cls}`,
            className: cls,
            lineStart: tagStartLine,
            lineEnd: tagStartLine,
            summary: `class="${cls}" DOM class`,
            provenance: 'verified',
            confidence: 1
          });
          edges.push({
            src: fileId,
            dst: classNodeId,
            type: 'defines',
            provenance: 'verified',
            confidence: 1
          });
        }
      }
    }
  }

  return { nodes, edges, domIds, domClasses, parseOk: true };
}
