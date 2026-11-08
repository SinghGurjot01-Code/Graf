/**
 * core/src/parser/sfc.js
 * Single-File Component (SFC) extractor for Vue (.vue) and Svelte (.svelte) files.
 * Splits <template>, <script>, and <style> blocks with 100% exact line number preservation.
 */

import { parseJsAst } from './js-ast.js';
import { parseMarkup } from './markup.js';
import { parseCss } from './css.js';

function lineAtOffset(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
}

function extractBlocks(source, tagName) {
  const blocks = [];
  const regex = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  let m;

  while ((m = regex.exec(source))) {
    const rawAttrs = m[1];
    const content = m[2];
    const matchStart = m.index;
    const openTagEnd = matchStart + m[0].indexOf('>') + 1;
    const contentStartLine = lineAtOffset(source, openTagEnd);

    const attrs = Object.create(null);
    const attrRegex = /([a-zA-Z0-9_\-:]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let am;
    while ((am = attrRegex.exec(rawAttrs))) {
      const k = am[1].toLowerCase();
      const v = am[2] !== undefined ? am[2] : (am[3] !== undefined ? am[3] : (am[4] !== undefined ? am[4] : ''));
      attrs[k] = v;
    }

    blocks.push({
      tagName: tagName.toLowerCase(),
      attrs,
      content,
      startOffset: openTagEnd,
      startLine: contentStartLine,
      rawTag: m[0]
    });
  }

  return blocks;
}

function padLines(code, targetLine) {
  const padCount = Math.max(0, targetLine - 1);
  return '\n'.repeat(padCount) + code;
}

export function parseSfc(relPath, source, delegates = {}) {
  const ext = relPath.slice(relPath.lastIndexOf('.')).toLowerCase();
  const isVue = ext === '.vue';
  const isSvelte = ext === '.svelte';
  const fileId = `file:${relPath}`;

  const jsParser = delegates.parseJsAst || parseJsAst;
  const htmlParser = delegates.parseMarkup || parseMarkup;
  const cssParser = delegates.parseCss || parseCss;

  const allNodes = [];
  const allEdges = [];
  const allImports = [];
  const allExports = [];
  const allUnresolvedCalls = [];
  const allDomQueries = [];

  if (isVue) {
    // 1. Vue <template> blocks
    const templateBlocks = extractBlocks(source, 'template');
    for (const b of templateBlocks) {
      const padded = padLines(b.content, b.startLine);
      const res = htmlParser(relPath, padded, { fileId });
      if (res.nodes) allNodes.push(...res.nodes);
      if (res.edges) allEdges.push(...res.edges);
    }

    // 2. Vue <script> blocks (supports dual standard <script> and <script setup>)
    const scriptBlocks = extractBlocks(source, 'script');
    for (const b of scriptBlocks) {
      const isTs = (b.attrs['lang'] || '').toLowerCase() === 'ts' || (b.attrs['lang'] || '').toLowerCase() === 'typescript';
      const isSetup = b.attrs['setup'] !== undefined;
      const padded = padLines(b.content, b.startLine);
      const res = jsParser(relPath, padded, { isTs, isJsx: true, isSetup });
      if (res.nodes) allNodes.push(...res.nodes);
      if (res.edges) allEdges.push(...res.edges);
      if (res.imports) allImports.push(...res.imports);
      if (res.exports) allExports.push(...res.exports);
      if (res.domQueries) allDomQueries.push(...res.domQueries);
      if (res.unresolvedCalls) allUnresolvedCalls.push(...res.unresolvedCalls);
    }

    // 3. Vue <style> blocks (supports scoped, lang="scss", etc.)
    const styleBlocks = extractBlocks(source, 'style');
    for (const b of styleBlocks) {
      const padded = padLines(b.content, b.startLine);
      const res = cssParser(relPath, padded, { fileId });
      if (res.nodes) allNodes.push(...res.nodes);
      if (res.edges) allEdges.push(...res.edges);
    }
  } else if (isSvelte) {
    // 1. Svelte <script> blocks (standard and context="module")
    const scriptBlocks = extractBlocks(source, 'script');
    for (const b of scriptBlocks) {
      const isTs = (b.attrs['lang'] || '').toLowerCase() === 'ts';
      const padded = padLines(b.content, b.startLine);
      const res = jsParser(relPath, padded, { isTs, isJsx: true });
      if (res.nodes) allNodes.push(...res.nodes);
      if (res.edges) allEdges.push(...res.edges);
      if (res.imports) allImports.push(...res.imports);
      if (res.exports) allExports.push(...res.exports);
      if (res.domQueries) allDomQueries.push(...res.domQueries);
      if (res.unresolvedCalls) allUnresolvedCalls.push(...res.unresolvedCalls);
    }

    // 2. Svelte <style> blocks
    const styleBlocks = extractBlocks(source, 'style');
    for (const b of styleBlocks) {
      const padded = padLines(b.content, b.startLine);
      const res = cssParser(relPath, padded, { fileId });
      if (res.nodes) allNodes.push(...res.nodes);
      if (res.edges) allEdges.push(...res.edges);
    }

    // 3. Svelte Markup (Everything outside <script> and <style>)
    let maskedMarkup = source;
    for (const b of [...scriptBlocks, ...styleBlocks]) {
      const maskedTag = b.rawTag.replace(/[^\n]/g, ' ');
      maskedMarkup = maskedMarkup.replace(b.rawTag, maskedTag);
    }
    const markupRes = htmlParser(relPath, maskedMarkup, { fileId });
    if (markupRes.nodes) allNodes.push(...markupRes.nodes);
    if (markupRes.edges) allEdges.push(...markupRes.edges);
  }

  // Deduplicate nodes by id (filter out any file node emitted by sub-parsers)
  const uniqueNodes = [];
  const seenNodeIds = new Set();
  for (const n of allNodes) {
    if (n.kind === 'file') continue;
    if (!seenNodeIds.has(n.id)) {
      seenNodeIds.add(n.id);
      uniqueNodes.push(n);
    }
  }

  // Deduplicate edges by compound key (src|type|dst)
  const uniqueEdges = [];
  const seenEdgeKeys = new Set();
  for (const e of allEdges) {
    const key = `${e.src}|${e.type}|${e.dst}`;
    if (!seenEdgeKeys.has(key)) {
      seenEdgeKeys.add(key);
      uniqueEdges.push(e);
    }
  }

  return {
    nodes: uniqueNodes,
    edges: uniqueEdges,
    imports: allImports,
    exports: allExports,
    unresolvedCalls: allUnresolvedCalls,
    domQueries: allDomQueries,
    language: isVue ? 'vue' : 'svelte',
    parseOk: true
  };
}
