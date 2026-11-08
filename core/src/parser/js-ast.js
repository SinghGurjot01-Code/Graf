import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let babelTransform = null;
try {
  babelTransform = require('./vendor/babel.cjs');
} catch (e) {
  babelTransform = null;
}

const DOM_QUERY_METHODS = new Set([
  'getElementById',
  'querySelector',
  'querySelectorAll',
  'getElementsByClassName',
  'getElementsByTagName'
]);

const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'use']);
const ROUTE_OBJECTS = new Set(['app', 'router', 'server']);

/**
 * Extracts top-level property names from parameter ObjectPatterns.
 * Supports destructured defaults and rest elements.
 */
function extractPropsFromParams(params) {
  if (!params || params.length === 0) return [];
  const first = params[0];
  let pattern = null;
  if (first.type === 'ObjectPattern') {
    pattern = first;
  } else if (first.type === 'AssignmentPattern' && first.left?.type === 'ObjectPattern') {
    pattern = first.left;
  }
  if (!pattern) return [];

  const props = [];
  for (const prop of pattern.properties) {
    if (prop.type === 'ObjectProperty') {
      if (prop.key?.type === 'Identifier') {
        props.push(prop.key.name);
      } else if (prop.key?.type === 'StringLiteral') {
        props.push(prop.key.value);
      }
    } else if (prop.type === 'RestElement') {
      if (prop.argument?.type === 'Identifier') {
        props.push(prop.argument.name);
      }
    }
  }
  return props;
}

/**
 * Generates doc summary from preceding comments or signature.
 */
function extractSummary(name, sig, lines, lineStart) {
  let doc = '';
  for (let l = lineStart - 2; l >= Math.max(0, lineStart - 10); l--) {
    const line = lines[l]?.trim() || '';
    if (line.startsWith('*') || line.startsWith('/*') || line.startsWith('//')) {
      doc = line.replace(/^[\/*\s]+/, '').trim() + ' ' + doc;
    } else {
      break;
    }
  }
  return (doc.trim() || `${name}: ${sig}`).slice(0, 180);
}

/**
 * Parses JavaScript, TypeScript, JSX, or TSX source into graph nodes, edges,
 * import/export tables, unresolved call expressions, and DOM query calls.
 *
 * @param {string} relPath - Relative path to file
 * @param {string} source - Raw source code
 * @param {object} options - { isTs, isJsx, isSetup }
 * @returns {object}
 */
export function parseJsAst(relPath, source, { isTs = false, isJsx = false, isSetup = false } = {}) {
  const fileId = `file:${relPath}`;
  const lines = source.split('\n');
  const nodes = [];
  const edges = [];
  const imports = [];
  const exports = [];
  const unresolvedCalls = [];
  const domQueries = [];

  const lang = isTs ? 'typescript' : 'javascript';

  // 1. File Root Node
  nodes.push({
    id: fileId,
    kind: 'file',
    path: relPath,
    name: path.basename(relPath),
    language: lang,
    size: Buffer.byteLength(source),
    lineStart: 1,
    lineEnd: lines.length,
    summary: `${lang} source file (${lines.length} lines)`,
    provenance: 'verified',
    confidence: 1
  });

  if (!babelTransform) {
    return { nodes, edges, imports, exports, unresolvedCalls, domQueries, language: lang, parseOk: false };
  }

  // Caller hierarchy tracking for accurate call attribution
  const callerStack = [fileId];
  function currentCallerId() {
    return callerStack[callerStack.length - 1];
  }

  function addSymbolNode(kind, name, lineStart, lineEnd, qualifier = '', extra = {}) {
    const qualifiedName = qualifier ? `${qualifier}.${name}` : name;
    const id = `${kind}:${relPath}#${qualifiedName}`;
    const existing = nodes.find(n => n.id === id);
    if (existing) return existing.id;

    const sigLine = lines[lineStart - 1]?.trim() || '';
    const openBrace = sigLine.indexOf('{');
    const signature = (openBrace > 0 ? sigLine.slice(0, openBrace).trim() : sigLine).slice(0, 240);
    const summary = extractSummary(name, signature, lines, lineStart);

    const node = {
      id,
      kind,
      path: relPath,
      name,
      qualifiedName,
      signature,
      lineStart,
      lineEnd,
      summary,
      provenance: 'verified',
      confidence: 1,
      ...extra
    };

    nodes.push(node);

    const parentId = qualifier ? (nodes.find(n => n.name === qualifier)?.id || fileId) : fileId;
    edges.push({
      src: parentId,
      dst: id,
      type: 'defines',
      provenance: 'verified',
      confidence: 1
    });

    return id;
  }

  const exportTable = new Map(); // exportName -> { localName, exportName, isDefault }
  const namedExportsPending = []; // { localName, exportName, isDefault }
  let parseError = null;

  try {
    const res = babelTransform({
      source,
      filename: relPath,
      ts: isTs,
      jsx: isJsx,
      babel: {
        plugins: [
          () => ({
            pre(file) {
              file.path.traverse({
                // --- IMPORTS ---
                ImportDeclaration(p) {
                  const srcMod = p.node.source.value;
                  const line = p.node.loc.start.line;
                  edges.push({
                    src: fileId,
                    dst: `module:${srcMod}`,
                    type: 'imports',
                    provenance: 'inferred',
                    confidence: 0.75
                  });

                  if (p.node.specifiers.length === 0) {
                    imports.push({
                      localName: '',
                      importedName: '',
                      sourceModule: srcMod,
                      line
                    });
                  } else {
                    for (const spec of p.node.specifiers) {
                      let localName = spec.local.name;
                      let importedName = '';
                      if (spec.type === 'ImportDefaultSpecifier') {
                        importedName = 'default';
                      } else if (spec.type === 'ImportNamespaceSpecifier') {
                        importedName = '*';
                      } else if (spec.type === 'ImportSpecifier') {
                        importedName = spec.imported ? (spec.imported.name || spec.imported.value) : localName;
                      }
                      imports.push({
                        localName,
                        importedName,
                        sourceModule: srcMod,
                        line
                      });
                    }
                  }
                },

                // --- EXPORTS ---
                ExportNamedDeclaration(p) {
                  const srcMod = p.node.source?.value;
                  if (srcMod) {
                    edges.push({
                      src: fileId,
                      dst: `module:${srcMod}`,
                      type: 'imports',
                      provenance: 'inferred',
                      confidence: 0.75
                    });
                    for (const spec of (p.node.specifiers || [])) {
                      if (spec.type === 'ExportNamespaceSpecifier') {
                        const exported = spec.exported?.name || (spec.exported?.value ? String(spec.exported.value) : '*');
                        exports.push({
                          exportName: exported,
                          localName: '*',
                          sourceModule: srcMod,
                          nodeId: `${fileId}#${exported}`,
                          isDefault: false,
                          isReexport: true
                        });
                      } else if (spec.type === 'ExportSpecifier') {
                        const local = spec.local?.name || (spec.local?.value ? String(spec.local.value) : '');
                        const exported = spec.exported?.name || (spec.exported?.value ? String(spec.exported.value) : local);
                        exports.push({
                          exportName: exported,
                          localName: local,
                          sourceModule: srcMod,
                          nodeId: `${fileId}#${exported}`,
                          isDefault: exported === 'default',
                          isReexport: true
                        });
                      }
                    }
                    return;
                  }

                  if (p.node.declaration) {
                    const decl = p.node.declaration;
                    if (decl.type === 'FunctionDeclaration' && decl.id) {
                      exportTable.set(decl.id.name, { localName: decl.id.name, exportName: decl.id.name, isDefault: false });
                    } else if (decl.type === 'ClassDeclaration' && decl.id) {
                      exportTable.set(decl.id.name, { localName: decl.id.name, exportName: decl.id.name, isDefault: false });
                    } else if (decl.type === 'VariableDeclaration') {
                      for (const v of decl.declarations) {
                        if (v.id.type === 'Identifier') {
                          exportTable.set(v.id.name, { localName: v.id.name, exportName: v.id.name, isDefault: false });
                        }
                      }
                    }
                  } else if (p.node.specifiers) {
                    for (const spec of p.node.specifiers) {
                      const local = spec.local?.name || (spec.local?.value ? String(spec.local.value) : '');
                      const exported = spec.exported?.name || spec.exported?.value || local;
                      if (local) {
                        namedExportsPending.push({ localName: local, exportName: exported, isDefault: exported === 'default' });
                      }
                    }
                  }
                },

                ExportAllDeclaration(p) {
                  const srcMod = p.node.source?.value;
                  if (srcMod) {
                    edges.push({
                      src: fileId,
                      dst: `module:${srcMod}`,
                      type: 'imports',
                      provenance: 'inferred',
                      confidence: 0.75
                    });
                    if (p.node.exported) {
                      const exported = p.node.exported.name || (p.node.exported.value ? String(p.node.exported.value) : '*');
                      exports.push({
                        exportName: exported,
                        localName: '*',
                        sourceModule: srcMod,
                        nodeId: `${fileId}#${exported}`,
                        isDefault: false,
                        isReexport: true
                      });
                    } else {
                      exports.push({
                        exportName: '*',
                        localName: '*',
                        sourceModule: srcMod,
                        nodeId: `${fileId}#*`,
                        isDefault: false,
                        isReexport: true
                      });
                    }
                  }
                },

                ExportDefaultDeclaration(p) {
                  const decl = p.node.declaration;
                  if (decl.id && decl.id.name) {
                    exportTable.set('default', { localName: decl.id.name, exportName: 'default', isDefault: true });
                  } else if (decl.type === 'Identifier') {
                    namedExportsPending.push({ localName: decl.name, exportName: 'default', isDefault: true });
                  } else if (decl.type === 'FunctionDeclaration' || decl.type === 'ArrowFunctionExpression') {
                    const fnName = 'default';
                    exportTable.set('default', { localName: fnName, exportName: 'default', isDefault: true });
                  }
                },

                // --- CLASSES ---
                ClassDeclaration: {
                  enter(p) {
                    const name = p.node.id?.name || 'anonymous';
                    const lineStart = p.node.loc.start.line;
                    const lineEnd = p.node.loc.end.line;
                    const isExp = exportTable.has(name) || exportTable.get('default')?.localName === name;
                    const classId = addSymbolNode('class', name, lineStart, lineEnd, '', {
                      isExported: isExp,
                      exportName: isExp ? (exportTable.get(name)?.exportName || 'default') : undefined
                    });
                    callerStack.push(classId);
                  },
                  exit() {
                    callerStack.pop();
                  }
                },

                ClassMethod: {
                  enter(p) {
                    const parentClass = p.findParent(parent => parent.isClassDeclaration() || parent.isClassExpression());
                    const className = parentClass?.node?.id?.name || '';
                    const methodName = p.node.key?.name || (p.node.key?.value ? String(p.node.key.value) : 'method');
                    const lineStart = p.node.loc.start.line;
                    const lineEnd = p.node.loc.end.line;
                    const methodId = addSymbolNode('function', methodName, lineStart, lineEnd, className, {
                      methodKind: p.node.kind,
                      isStatic: p.node.static || false,
                      isAsync: p.node.async || false
                    });
                    callerStack.push(methodId);
                  },
                  exit() {
                    callerStack.pop();
                  }
                },

                // --- FUNCTIONS ---
                FunctionDeclaration: {
                  enter(p) {
                    const name = p.node.id?.name || 'anonymous';
                    const lineStart = p.node.loc.start.line;
                    const lineEnd = p.node.loc.end.line;
                    const isExp = exportTable.has(name) || exportTable.get('default')?.localName === name;
                    const props = extractPropsFromParams(p.node.params);
                    const isComponent = /^[A-Z]/.test(name) || props.length > 0;

                    const fnId = addSymbolNode('function', name, lineStart, lineEnd, '', {
                      isAsync: p.node.async || false,
                      isGenerator: p.node.generator || false,
                      isComponent,
                      props: props.length > 0 ? props : undefined,
                      isExported: isExp,
                      exportName: isExp ? (exportTable.get(name)?.exportName || 'default') : undefined
                    });
                    callerStack.push(fnId);
                  },
                  exit() {
                    callerStack.pop();
                  }
                },

                // --- ARROW FUNCTIONS & VARIABLE FUNCTIONS ---
                VariableDeclarator: {
                  enter(p) {
                    if (p.node.id?.type === 'Identifier' && p.node.init) {
                      const name = p.node.id.name;
                      const init = p.node.init;

                      if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
                        const lineStart = p.node.loc.start.line;
                        const lineEnd = p.node.loc.end.line;
                        const isExp = exportTable.has(name) || exportTable.get('default')?.localName === name;
                        const props = extractPropsFromParams(init.params);
                        const isComponent = /^[A-Z]/.test(name) || props.length > 0;

                        const fnId = addSymbolNode('function', name, lineStart, lineEnd, '', {
                          isAsync: init.async || false,
                          isGenerator: init.generator || false,
                          isComponent,
                          props: props.length > 0 ? props : undefined,
                          isExported: isExp,
                          exportName: isExp ? (exportTable.get(name)?.exportName || 'default') : undefined
                        });
                        callerStack.push(fnId);
                      }
                    }
                  },
                  exit(p) {
                    if (p.node.id?.type === 'Identifier' && p.node.init) {
                      const init = p.node.init;
                      if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
                        callerStack.pop();
                      }
                    }
                  }
                },

                // --- OBJECT METHODS (e.g. Vue Options API or Object literals) ---
                ObjectMethod: {
                  enter(p) {
                    const methodName = p.node.key?.name || (p.node.key?.value ? String(p.node.key.value) : 'method');
                    const lineStart = p.node.loc.start.line;
                    const lineEnd = p.node.loc.end.line;
                    const methodId = addSymbolNode('function', methodName, lineStart, lineEnd, '', {
                      isAsync: p.node.async || false,
                      isGenerator: p.node.generator || false
                    });
                    callerStack.push(methodId);
                  },
                  exit() {
                    callerStack.pop();
                  }
                },

                // --- CALL EXPRESSIONS (DOM, Require, Routes, Unresolved Calls) ---
                CallExpression(p) {
                  const callee = p.node.callee;
                  const line = p.node.loc.start.line;
                  const callerId = currentCallerId();

                  // 1. Dynamic require()
                  if (callee.type === 'Identifier' && callee.name === 'require') {
                    const arg = p.node.arguments[0];
                    if (arg && (arg.type === 'StringLiteral' || (arg.type === 'Literal' && typeof arg.value === 'string'))) {
                      const srcMod = arg.value;
                      edges.push({
                        src: fileId,
                        dst: `module:${srcMod}`,
                        type: 'imports',
                        provenance: 'inferred',
                        confidence: 0.75
                      });

                      const parentDecl = p.findParent(parent => parent.isVariableDeclarator());
                      if (parentDecl && parentDecl.node.id) {
                        const idNode = parentDecl.node.id;
                        if (idNode.type === 'Identifier') {
                          imports.push({ localName: idNode.name, importedName: 'default', sourceModule: srcMod, line });
                        } else if (idNode.type === 'ObjectPattern') {
                          for (const prop of idNode.properties) {
                            if (prop.type === 'ObjectProperty' && prop.key?.name) {
                              imports.push({
                                localName: prop.value?.name || prop.key.name,
                                importedName: prop.key.name,
                                sourceModule: srcMod,
                                line
                              });
                            }
                          }
                        }
                      } else {
                        imports.push({ localName: '', importedName: '', sourceModule: srcMod, line });
                      }
                    }
                    return;
                  }

                  // 2. DOM Queries
                  if (callee.type === 'MemberExpression' && callee.property?.type === 'Identifier') {
                    const methodName = callee.property.name;
                    if (DOM_QUERY_METHODS.has(methodName)) {
                      const firstArg = p.node.arguments[0];
                      let selector = '';
                      if (firstArg) {
                        if (firstArg.type === 'StringLiteral') {
                          selector = firstArg.value;
                        } else if (firstArg.type === 'TemplateLiteral' && firstArg.quasis.length === 1) {
                          selector = firstArg.quasis[0].value.raw;
                        }
                      }
                      domQueries.push({
                        callerId,
                        method: methodName,
                        selector,
                        line
                      });
                      return;
                    }

                    // 3. Express/HTTP Route Declarations
                    const objName = callee.object?.name;
                    const routeMethod = methodName.toLowerCase();
                    if (ROUTE_OBJECTS.has(objName) && ROUTE_METHODS.has(routeMethod)) {
                      const firstArg = p.node.arguments[0];
                      if (firstArg && (firstArg.type === 'StringLiteral' || firstArg.type === 'Literal')) {
                        const routePath = firstArg.value;
                        const routeId = `route:${relPath}#${routeMethod.toUpperCase()} ${routePath}`;
                        nodes.push({
                          id: routeId,
                          kind: 'route',
                          path: relPath,
                          name: `${routeMethod.toUpperCase()} ${routePath}`,
                          method: routeMethod.toUpperCase(),
                          routePath,
                          lineStart: line,
                          lineEnd: line,
                          summary: `Route declaration ${routeMethod.toUpperCase()} ${routePath}`,
                          provenance: 'inferred',
                          confidence: 0.85
                        });
                        edges.push({ src: fileId, dst: routeId, type: 'defines', provenance: 'inferred', confidence: 0.85 });

                        const handlerArg = p.node.arguments[p.node.arguments.length - 1];
                        if (handlerArg?.type === 'Identifier') {
                          edges.push({
                            src: routeId,
                            dst: `function:${relPath}#${handlerArg.name}`,
                            type: 'handles',
                            provenance: 'inferred',
                            confidence: 0.7
                          });
                        }
                        return;
                      }
                    }
                  }

                  // 4. Unresolved Call Expressions for Cross-File Linking
                  if (callee.type === 'Identifier') {
                    const calleeName = callee.name;
                    if (!['require', 'import', 'super', 'parseInt', 'parseFloat', 'isNaN', 'isFinite'].includes(calleeName)) {
                      unresolvedCalls.push({
                        callerFnId: callerId,
                        calleeName,
                        line
                      });
                    }
                  } else if (callee.type === 'MemberExpression') {
                    const obj = callee.object;
                    const prop = callee.property;
                    if (obj.type === 'Identifier' && prop.type === 'Identifier') {
                      unresolvedCalls.push({
                        callerFnId: callerId,
                        calleeName: prop.name,
                        objectName: obj.name,
                        propertyName: prop.name,
                        line
                      });
                    }
                  }
                }
              });
            },
            visitor: {}
          })
        ]
      }
    });

    if (res?.error) {
      parseError = res.error;
    }
  } catch (err) {
    parseError = err;
  }

  // Resolve pending named exports (e.g. export { a as b } or export default a)
  for (const exp of namedExportsPending) {
    exportTable.set(exp.exportName, exp);
    const matchingNode = nodes.find(n => n.name === exp.localName);
    if (matchingNode) {
      matchingNode.isExported = true;
      matchingNode.exportName = exp.exportName;
    }
  }

  // Finalize export bindings array
  for (const [exportName, info] of exportTable) {
    const matchingNode = nodes.find(n => n.name === info.localName);
    exports.push({
      exportName,
      localName: info.localName,
      nodeId: matchingNode ? matchingNode.id : `${fileId}#${info.localName}`,
      isDefault: info.isDefault
    });
  }

  return {
    nodes,
    edges,
    imports,
    exports,
    unresolvedCalls,
    domQueries,
    language: lang,
    parseOk: !parseError
  };
}
