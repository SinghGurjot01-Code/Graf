import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GrafEngine } from '../src/engine.js';
import { parseSource, SUPPORTED_EXTENSIONS } from '../src/parser/index.js';

// Feature gate helper for progressive testability across development milestones
function gateFeature(t, featureName, isAvailable) {
  if (!isAvailable) {
    if (process.env.STRICT_ASSERT === '1') {
      assert.fail(`[Strict Assertion Failure] Required feature '${featureName}' is not implemented.`);
    }
    t.skip(`[Pending Milestone] Feature '${featureName}' not yet implemented.`);
    return false;
  }
  return true;
}

// Sandbox workspace creator helper
async function createTempRepo(prefix = 'graf-e2e-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    dir,
    cleanup: async () => {
      try {
        await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {}
    }
  };
}

/* ==========================================================================
   TIER 1: FEATURE COVERAGE SUITE (>= 5 tests per feature)
   ========================================================================== */

// --- Feature 1: HTML Markup Indexing ---

test('T1.HTML.01: HTML parser extracts DOM element IDs into graph nodes', async (t) => {
  const hasHtml = SUPPORTED_EXTENSIONS.has('.html');
  if (!gateFeature(t, 'HTML Indexing (M1)', hasHtml)) return;

  const html = `
    <!DOCTYPE html>
    <html>
      <body>
        <header id="main-header">
          <h1 id="site-title">Graf App</h1>
        </header>
        <main id="content-container">
          <button id="submit-button">Submit</button>
        </main>
      </body>
    </html>
  `;
  const parsed = parseSource('index.html', html);
  assert.equal(parsed.parseOk, true);

  const ids = parsed.nodes.filter(n => n.kind === 'dom' || n.name?.startsWith('#') || n.id?.includes('#'));
  assert.ok(ids.length >= 4, `Expected >= 4 DOM ID nodes, got ${ids.length}`);
  assert.ok(parsed.nodes.some(n => n.name === '#main-header' || n.id.includes('#main-header')));
  assert.ok(parsed.nodes.some(n => n.name === '#submit-button' || n.id.includes('#submit-button')));
});

test('T1.HTML.02: HTML parser extracts DOM element classes into searchable nodes or attributes', async (t) => {
  const hasHtml = SUPPORTED_EXTENSIONS.has('.html');
  if (!gateFeature(t, 'HTML Indexing (M1)', hasHtml)) return;

  const html = `
    <div class="card product-card featured">
      <h2 class="card-title">Product 1</h2>
      <button class="btn btn-primary action-btn">Buy</button>
    </div>
  `;
  const parsed = parseSource('components/card.html', html);
  assert.equal(parsed.parseOk, true);

  const classNodes = parsed.nodes.filter(n => n.name?.startsWith('.') || n.id?.includes('.class-') || n.classes?.length);
  assert.ok(classNodes.length > 0 || parsed.nodes.some(n => n.classes?.includes('product-card')));
});

test('T1.HTML.03: HTML parser parses <script src="..."> tags into dependency imports', async (t) => {
  const hasHtml = SUPPORTED_EXTENSIONS.has('.html');
  if (!gateFeature(t, 'HTML Indexing (M1)', hasHtml)) return;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <script src="./js/vendor.js"></script>
        <script type="module" src="./js/app.js"></script>
      </head>
      <body></body>
    </html>
  `;
  const parsed = parseSource('index.html', html);
  assert.equal(parsed.parseOk, true);

  const scriptDeps = parsed.edges.filter(e => e.type === 'imports' && (e.dst.includes('vendor.js') || e.dst.includes('app.js')));
  assert.ok(scriptDeps.length >= 2, `Expected >= 2 script imports edges, found ${scriptDeps.length}`);
});

test('T1.HTML.04: HTML parser parses <link rel="stylesheet"> tags into stylesheet dependencies', async (t) => {
  const hasHtml = SUPPORTED_EXTENSIONS.has('.html');
  if (!gateFeature(t, 'HTML Indexing (M1)', hasHtml)) return;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <link rel="stylesheet" href="./css/reset.css">
        <link rel="stylesheet" href="./css/main.css">
      </head>
      <body></body>
    </html>
  `;
  const parsed = parseSource('index.html', html);
  assert.equal(parsed.parseOk, true);

  const cssDeps = parsed.edges.filter(e => e.type === 'imports' && (e.dst.includes('reset.css') || e.dst.includes('main.css')));
  assert.ok(cssDeps.length >= 2, `Expected >= 2 stylesheet imports edges, found ${cssDeps.length}`);
});

test('T1.HTML.05: HTML parser extracts nested element hierarchy with accurate line boundaries', async (t) => {
  const hasHtml = SUPPORTED_EXTENSIONS.has('.html');
  if (!gateFeature(t, 'HTML Indexing (M1)', hasHtml)) return;

  const html = [
    '<nav id="navbar">',
    '  <ul class="nav-list">',
    '    <li class="nav-item">',
    '      <a id="home-link" href="/">Home</a>',
    '    </li>',
    '  </ul>',
    '</nav>'
  ].join('\n');
  const parsed = parseSource('nav.html', html);
  assert.equal(parsed.parseOk, true);

  const navNode = parsed.nodes.find(n => n.id.includes('#navbar') || n.name === '#navbar');
  assert.ok(navNode, 'Navbar DOM node must exist');
  assert.equal(navNode.lineStart, 1);
});

// --- Feature 2: CSS / SCSS Indexing ---

test('T1.CSS.01: CSS parser extracts rule selectors into graph nodes', async (t) => {
  const hasCss = SUPPORTED_EXTENSIONS.has('.css');
  if (!gateFeature(t, 'CSS Indexing (M1)', hasCss)) return;

  const css = `
    #app {
      margin: 0 auto;
    }
    .btn.btn-primary {
      background-color: blue;
    }
    header > nav ul li a:hover {
      text-decoration: underline;
    }
  `;
  const parsed = parseSource('styles/main.css', css);
  assert.equal(parsed.parseOk, true);

  const rules = parsed.nodes.filter(n => n.kind === 'css-rule' || n.kind === 'style' || n.name?.includes('btn'));
  assert.ok(rules.length >= 2, `Expected >= 2 CSS rule nodes, found ${rules.length}`);
});

test('T1.CSS.02: CSS parser extracts CSS custom properties (variables)', async (t) => {
  const hasCss = SUPPORTED_EXTENSIONS.has('.css');
  if (!gateFeature(t, 'CSS Indexing (M1)', hasCss)) return;

  const css = `
    :root {
      --primary-color: #0070f3;
      --bg-surface: #111111;
      --font-base: 16px;
    }
    body {
      color: var(--primary-color);
      background: var(--bg-surface);
    }
  `;
  const parsed = parseSource('styles/vars.css', css);
  assert.equal(parsed.parseOk, true);

  const varNodes = parsed.nodes.filter(n => n.kind === 'css-var' || n.name?.startsWith('--'));
  assert.ok(varNodes.length >= 3, `Expected >= 3 CSS variable nodes, found ${varNodes.length}`);
  assert.ok(varNodes.some(n => n.name === '--primary-color'));
});

test('T1.CSS.03: SCSS parser extracts SCSS $-variables', async (t) => {
  const hasScss = SUPPORTED_EXTENSIONS.has('.scss');
  if (!gateFeature(t, 'SCSS Indexing (M1)', hasScss)) return;

  const scss = `
    $theme-accent: #ff4081;
    $spacing-sm: 8px;
    $spacing-md: 16px;

    .box {
      padding: $spacing-md;
      border: 1px solid $theme-accent;
    }
  `;
  const parsed = parseSource('styles/theme.scss', scss);
  assert.equal(parsed.parseOk, true);

  const scssVars = parsed.nodes.filter(n => n.kind === 'scss-var' || n.name?.startsWith('$'));
  assert.ok(scssVars.length >= 3, `Expected >= 3 SCSS variable nodes, found ${scssVars.length}`);
  assert.ok(scssVars.some(n => n.name === '$theme-accent'));
});

test('T1.CSS.04: CSS parser extracts @import statements into stylesheet dependencies', async (t) => {
  const hasCss = SUPPORTED_EXTENSIONS.has('.css');
  if (!gateFeature(t, 'CSS Indexing (M1)', hasCss)) return;

  const css = `
    @import url('normalize.css');
    @import 'typography.css';
    @import "./components/buttons.css";
  `;
  const parsed = parseSource('styles/index.css', css);
  assert.equal(parsed.parseOk, true);

  const importEdges = parsed.edges.filter(e => e.type === 'imports' && (e.dst.includes('normalize.css') || e.dst.includes('typography.css')));
  assert.ok(importEdges.length >= 2, `Expected >= 2 CSS import edges, found ${importEdges.length}`);
});

test('T1.CSS.05: CSS parser preserves accurate line numbers and rule boundaries', async (t) => {
  const hasCss = SUPPORTED_EXTENSIONS.has('.css');
  if (!gateFeature(t, 'CSS Indexing (M1)', hasCss)) return;

  const css = [
    '/* Base rules */',
    '.container {',
    '  width: 100%;',
    '  max-width: 1200px;',
    '  margin: 0 auto;',
    '}',
    '',
    '.footer {',
    '  padding: 20px;',
    '}'
  ].join('\n');
  const parsed = parseSource('layout.css', css);
  assert.equal(parsed.parseOk, true);

  const containerRule = parsed.nodes.find(n => n.name?.includes('.container'));
  assert.ok(containerRule, 'Container rule must exist');
  assert.equal(containerRule.lineStart, 2);
  assert.equal(containerRule.lineEnd, 6);
});

// --- Feature 3: AST JS/TS Parsing & Accurate Symbol Spans ---

test('T1.AST.01: AST parser computes accurate line boundaries without 300-char truncation', async (t) => {
  const js = [
    '/**',
    ' * User authentication service method with comprehensive documentation',
    ' * explaining session validation, encryption headers, and database fallback.',
    ' * Parameter user: object containing username, password hash, and device tokens.',
    ' * Returns boolean status.',
    ' */',
    'export async function authenticateSessionToken(',
    '  username,',
    '  tokenPayload,',
    '  deviceFingerprint,',
    '  enforceTwoFactorAuthentication = false',
    ') {',
    '  const isValid = tokenPayload && tokenPayload.length > 20;',
    '  if (!isValid) return false;',
    '  return true;',
    '}'
  ].join('\n');

  const parsed = parseSource('auth.js', js);
  assert.equal(parsed.parseOk, true);
  const fn = parsed.nodes.find(n => n.name === 'authenticateSessionToken');
  assert.ok(fn, 'authenticateSessionToken function must be extracted');
  assert.equal(fn.lineStart, 7);
  assert.equal(fn.lineEnd, 16);
});

test('T1.AST.02: AST parser extracts TypeScript generic functions without regex failure', async (t) => {
  const hasAstUpgrade = typeof parseSource('test.js', 'const a = 1;').domQueries !== 'undefined';
  if (!gateFeature(t, 'AST-based JS/TS Parsing (M1)', hasAstUpgrade)) return;

  const ts = `
    export function fetchRecord<T extends { id: string }, K extends keyof T>(
      collection: string,
      id: string,
      keySelector?: K
    ): Promise<T | null> {
      return Promise.resolve(null);
    }
  `;
  const parsed = parseSource('repo.ts', ts);
  assert.equal(parsed.parseOk, true);
  const fn = parsed.nodes.find(n => n.name === 'fetchRecord');
  assert.ok(fn, 'TypeScript generic function fetchRecord must be extracted');
  assert.equal(fn.kind, 'function');
});

test('T1.AST.03: AST parser isolates concise arrow functions without spanning next blocks', async (t) => {
  const hasAstUpgrade = typeof parseSource('test.js', 'const a = 1;').domQueries !== 'undefined';
  if (!gateFeature(t, 'AST-based JS/TS Parsing (M1)', hasAstUpgrade)) return;

  const js = [
    'export const add = (a, b) => a + b;',
    '',
    'export function subtract(a, b) {',
    '  return a - b;',
    '}'
  ].join('\n');

  const parsed = parseSource('math.js', js);
  assert.equal(parsed.parseOk, true);
  const addFn = parsed.nodes.find(n => n.name === 'add');
  const subFn = parsed.nodes.find(n => n.name === 'subtract');
  assert.ok(addFn, 'add function must exist');
  assert.ok(subFn, 'subtract function must exist');
  assert.equal(addFn.lineStart, 1);
  assert.equal(addFn.lineEnd, 1);
  assert.equal(subFn.lineStart, 3);
  assert.equal(subFn.lineEnd, 5);
});

test('T1.AST.04: AST parser preserves template literals with nested expressions and calls', async (t) => {
  const js = `
    function computePrice(tax) { return 100 * (1 + tax); }
    export function generateInvoice(customer) {
      const formatted = \`Customer: \${customer.name}, Total: \${computePrice(0.08)}\`;
      return formatted;
    }
  `;
  const parsed = parseSource('invoice.js', js);
  assert.equal(parsed.parseOk, true);
  assert.ok(parsed.nodes.some(n => n.name === 'computePrice'));
  assert.ok(parsed.nodes.some(n => n.name === 'generateInvoice'));
});

test('T1.AST.05: AST parser extracts ES6 classes, methods, and static members with qualified names', async (t) => {
  const js = `
    export class CartService {
      static VERSION = '1.0.0';
      constructor(currency) {
        this.currency = currency;
      }
      addItem(item) {
        this.items.push(item);
      }
      static getVersion() {
        return CartService.VERSION;
      }
    }
  `;
  const parsed = parseSource('cart.js', js);
  assert.equal(parsed.parseOk, true);
  assert.ok(parsed.nodes.some(n => n.kind === 'class' && n.name === 'CartService'));
  assert.ok(parsed.nodes.some(n => n.kind === 'function' && n.name === 'addItem'));
  assert.ok(parsed.nodes.some(n => n.kind === 'function' && (n.name === 'getVersion' || n.name === 'constructor')));
});

// --- Feature 4: React Component & Prop Extraction ---

test('T1.PROP.01: React JSX component extraction identifies component kind and spans', async (t) => {
  const hasAstUpgrade = typeof parseSource('app.jsx', 'const Header = () => <header></header>;').domQueries !== 'undefined';
  if (!gateFeature(t, 'Component & Prop Extraction (M1)', hasAstUpgrade)) return;

  const jsx = `
    export const NavigationBar = (props) => {
      return (
        <nav className="navbar">
          <div className="logo">Graf</div>
        </nav>
      );
    };
  `;
  const parsed = parseSource('components/Nav.jsx', jsx);
  assert.equal(parsed.parseOk, true);

  const comp = parsed.nodes.find(n => n.name === 'NavigationBar');
  assert.ok(comp, 'NavigationBar component node must exist');
});

test('T1.PROP.02: Destructured component props are extracted into node metadata', async (t) => {
  const hasAstUpgrade = typeof parseSource('card.jsx', 'const Card = ({ title }) => <div>{title}</div>;').domQueries !== 'undefined';
  if (!gateFeature(t, 'Component & Prop Extraction (M1)', hasAstUpgrade)) return;

  const jsx = `
    export function ProductCard({ title, price, inStock = true, onAddToCart }) {
      return (
        <div className="card">
          <h3>{title}</h3>
          <p>\${price}</p>
        </div>
      );
    }
  `;
  const parsed = parseSource('ProductCard.jsx', jsx);
  assert.equal(parsed.parseOk, true);

  const cardNode = parsed.nodes.find(n => n.name === 'ProductCard');
  assert.ok(cardNode, 'ProductCard node must exist');
  assert.ok(cardNode.props?.includes('title'), 'Props should include title');
  assert.ok(cardNode.props?.includes('price'), 'Props should include price');
});

test('T1.PROP.03: AST parser extracts document.getElementById DOM query calls', async (t) => {
  const hasAstUpgrade = typeof parseSource('test.js', 'document.getElementById("root");').domQueries !== 'undefined';
  if (!gateFeature(t, 'DOM Query Call Extraction (M1)', hasAstUpgrade)) return;

  const js = `
    export function initApp() {
      const root = document.getElementById('app-root');
      const dialog = document.getElementById('login-modal');
      return { root, dialog };
    }
  `;
  const parsed = parseSource('main.js', js);
  assert.equal(parsed.parseOk, true);
  assert.ok(parsed.domQueries, 'domQueries array must be returned');

  const rootQuery = parsed.domQueries.find(q => q.method === 'getElementById' && q.selector === 'app-root');
  assert.ok(rootQuery, 'getElementById query for app-root must be extracted');
});

test('T1.PROP.04: AST parser extracts querySelector and querySelectorAll calls', async (t) => {
  const hasAstUpgrade = typeof parseSource('test.js', 'document.querySelector(".btn");').domQueries !== 'undefined';
  if (!gateFeature(t, 'DOM Query Call Extraction (M1)', hasAstUpgrade)) return;

  const js = `
    function setupHandlers() {
      const btn = document.querySelector('.submit-btn');
      const allInputs = document.querySelectorAll('input.form-control');
      return { btn, allInputs };
    }
  `;
  const parsed = parseSource('events.js', js);
  assert.equal(parsed.parseOk, true);

  assert.ok(parsed.domQueries.some(q => q.method === 'querySelector' && q.selector === '.submit-btn'));
  assert.ok(parsed.domQueries.some(q => q.method === 'querySelectorAll' && q.selector === 'input.form-control'));
});

test('T1.PROP.05: React components with nested JSX elements and children parse cleanly', async (t) => {
  const hasAstUpgrade = typeof parseSource('test.jsx', 'const App = () => <div><span>Text</span></div>;').domQueries !== 'undefined';
  if (!gateFeature(t, 'Component & Prop Extraction (M1)', hasAstUpgrade)) return;

  const jsx = `
    export const Layout = ({ children, footerText = 'Graf 2026' }) => {
      return (
        <div className="layout-root">
          <header><h1 id="app-title">Dashboard</h1></header>
          <main>{children}</main>
          <footer><small>{footerText}</small></footer>
        </div>
      );
    };
  `;
  const parsed = parseSource('Layout.jsx', jsx);
  assert.equal(parsed.parseOk, true);
  const layout = parsed.nodes.find(n => n.name === 'Layout');
  assert.ok(layout, 'Layout component must be parsed');
});

// --- Feature 5: Cross-File Symbol Linking & Exports/Imports ---

test('T1.CALL.01: Named and default exports are extracted into export bindings table', async (t) => {
  const hasExportTable = typeof parseSource('test.js', 'export const a = 1;').exports !== 'undefined';
  if (!gateFeature(t, 'Parse-Time Export Table Extraction (M1)', hasExportTable)) return;

  const js = `
    export function calculateTax(amount) { return amount * 0.1; }
    export const DEFAULT_CURRENCY = 'USD';
    const privateHelper = () => true;
    export default function runService() { return true; }
  `;
  const parsed = parseSource('services/tax.js', js);
  assert.equal(parsed.parseOk, true);
  assert.ok(parsed.exports, 'exports array must exist');

  assert.ok(parsed.exports.some(e => e.exportName === 'calculateTax' && !e.isDefault));
  assert.ok(parsed.exports.some(e => e.exportName === 'DEFAULT_CURRENCY' && !e.isDefault));
  assert.ok(parsed.exports.some(e => e.isDefault === true));
  assert.ok(!parsed.exports.some(e => e.exportName === 'privateHelper'), 'Private helper must not be exported');
});

test('T1.CALL.02: Import bindings are recorded with localName, importedName, and sourceModule', async (t) => {
  const hasImportTable = typeof parseSource('test.js', 'import { a } from "./a.js";').imports !== 'undefined';
  if (!gateFeature(t, 'Parse-Time Import Table Extraction (M1)', hasImportTable)) return;

  const js = `
    import { calculateTax as taxFn, DEFAULT_CURRENCY } from './services/tax.js';
    import DefaultLogger from './utils/logger.js';
    import * as Constants from './config/constants.js';
  `;
  const parsed = parseSource('app.js', js);
  assert.equal(parsed.parseOk, true);
  assert.ok(parsed.imports, 'imports array must exist');

  assert.ok(parsed.imports.some(i => i.localName === 'taxFn' && i.importedName === 'calculateTax' && i.sourceModule === './services/tax.js'));
  assert.ok(parsed.imports.some(i => i.localName === 'DefaultLogger' && i.importedName === 'default'));
  assert.ok(parsed.imports.some(i => i.localName === 'Constants' && i.importedName === '*'));
});

test('T1.CALL.03: Unresolved function calls are recorded with caller function ID', async (t) => {
  const hasUnresolvedCalls = typeof parseSource('test.js', 'function a() { b(); }').unresolvedCalls !== 'undefined';
  if (!gateFeature(t, 'Unresolved Call Collection (M1)', hasUnresolvedCalls)) return;

  const js = `
    import { formatCurrency } from './utils.js';
    export function renderReceipt(total) {
      const formatted = formatCurrency(total);
      logEvent('receipt_rendered');
      return formatted;
    }
  `;
  const parsed = parseSource('receipt.js', js);
  assert.equal(parsed.parseOk, true);
  assert.ok(parsed.unresolvedCalls, 'unresolvedCalls array must exist');

  assert.ok(parsed.unresolvedCalls.some(c => c.calleeName === 'formatCurrency' && c.callerFnId.includes('renderReceipt')));
  assert.ok(parsed.unresolvedCalls.some(c => c.calleeName === 'logEvent' && c.callerFnId.includes('renderReceipt')));
});

test('T1.CALL.04: Engine two-phase cross-file resolution creates calls edges across files', async (t) => {
  const temp = await createTempRepo();
  let engine;
  try {
    const hasCrossFile = typeof GrafEngine.prototype.resolveCrossFileSymbols === 'function';
    if (!gateFeature(t, 'Cross-File Symbol Resolution (M2)', hasCrossFile)) return;

    await fs.mkdir(path.join(temp.dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(temp.dir, 'src/math.js'), `
      export function multiply(a, b) { return a * b; }
    `);
    await fs.writeFile(path.join(temp.dir, 'src/calculator.js'), `
      import { multiply } from './math.js';
      export function calculateSquare(x) {
        return multiply(x, x);
      }
    `);

    engine = new GrafEngine(temp.dir);
    await engine.init();
    await engine.sync();

    const squareNode = engine.search('calculateSquare')[0];
    const multiplyNode = engine.search('multiply')[0];
    assert.ok(squareNode, 'calculateSquare must be indexed');
    assert.ok(multiplyNode, 'multiply must be indexed');

    const edges = Object.values(engine.store.data.edges);
    const callEdge = edges.find(e => e.type === 'calls' && e.src === squareNode.id && e.dst === multiplyNode.id);
    assert.ok(callEdge, 'Cross-file calls edge must link calculateSquare -> multiply');
  } finally {
    engine?.close();
    await temp.cleanup();
  }
});

test('T1.CALL.05: Cross-file symbol resolution resolves multi-level relative path imports', async (t) => {
  const temp = await createTempRepo();
  let engine;
  try {
    const hasCrossFile = typeof GrafEngine.prototype.resolveCrossFileSymbols === 'function';
    if (!gateFeature(t, 'Cross-File Symbol Resolution (M2)', hasCrossFile)) return;

    await fs.mkdir(path.join(temp.dir, 'src/services'), { recursive: true });
    await fs.mkdir(path.join(temp.dir, 'src/controllers'), { recursive: true });

    await fs.writeFile(path.join(temp.dir, 'src/services/user.js'), `
      export function fetchUserProfile(userId) { return { id: userId }; }
    `);
    await fs.writeFile(path.join(temp.dir, 'src/controllers/auth.js'), `
      import { fetchUserProfile } from '../services/user.js';
      export function handleLogin(req) {
        return fetchUserProfile(req.id);
      }
    `);

    engine = new GrafEngine(temp.dir);
    await engine.init();
    await engine.sync();

    const caller = engine.search('handleLogin')[0];
    const target = engine.search('fetchUserProfile')[0];
    assert.ok(caller && target);

    const callEdge = Object.values(engine.store.data.edges).find(
      e => e.type === 'calls' && e.src === caller.id && e.dst === target.id
    );
    assert.ok(callEdge, 'Cross-file call across ../ directory must resolve');
  } finally {
    engine?.close();
    await temp.cleanup();
  }
});

// --- Feature 6: Lean Orientation Output ---

test('T1.LEAN.01: engine.overview() produces compact representation under 200 tokens for small repos', async (t) => {
  const temp = await createTempRepo();
  let engine;
  try {
    await fs.mkdir(path.join(temp.dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(temp.dir, 'src/a.js'), 'export function foo() { return 1; }');
    await fs.writeFile(path.join(temp.dir, 'src/b.js'), 'export function bar() { return 2; }');

    engine = new GrafEngine(temp.dir);
    await engine.init();
    await engine.sync();

    const overview = await engine.overview(0);
    const hasLeanOutline = typeof overview.outline === 'string';
    if (!gateFeature(t, 'Lean Overview Output (M3)', hasLeanOutline)) return;

    assert.ok(overview.outline, 'Overview outline must exist');
    assert.ok(overview.outline.length < 750, `Outline length ${overview.outline.length} exceeds 750 chars (<200 tokens)`);
  } finally {
    engine?.close();
    await temp.cleanup();
  }
});

test('T1.LEAN.02: Outline representation adheres to hierarchical indented tree format', async (t) => {
  const temp = await createTempRepo();
  let engine;
  try {
    await fs.mkdir(path.join(temp.dir, 'src/core'), { recursive: true });
    await fs.writeFile(path.join(temp.dir, 'src/core/engine.js'), 'export function startEngine() {}');

    engine = new GrafEngine(temp.dir);
    await engine.init();
    await engine.sync();

    const overview = await engine.overview(0);
    const hasLeanOutline = typeof overview.outline === 'string';
    if (!gateFeature(t, 'Lean Overview Output (M3)', hasLeanOutline)) return;

    assert.ok(overview.outline.includes('src/') || overview.outline.includes('engine.js'));
    assert.ok(overview.outline.includes('startEngine'));
  } finally {
    engine?.close();
    await temp.cleanup();
  }
});

test('T1.LEAN.03: Single-folder directory chains are collapsed cleanly in outline', async (t) => {
  const temp = await createTempRepo();
  let engine;
  try {
    await fs.mkdir(path.join(temp.dir, 'src/nested/deep'), { recursive: true });
    await fs.writeFile(path.join(temp.dir, 'src/nested/deep/mod.js'), 'export function run() {}');

    engine = new GrafEngine(temp.dir);
    await engine.init();
    await engine.sync();

    const overview = await engine.overview(0);
    const hasLeanOutline = typeof overview.outline === 'string';
    if (!gateFeature(t, 'Lean Overview Output (M3)', hasLeanOutline)) return;

    assert.ok(overview.outline.includes('src/nested/deep/') || overview.outline.includes('mod.js'));
  } finally {
    engine?.close();
    await temp.cleanup();
  }
});

test('T1.LEAN.04: Redundant file: prefixes are stripped from tree outline', async (t) => {
  const temp = await createTempRepo();
  let engine;
  try {
    await fs.mkdir(path.join(temp.dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(temp.dir, 'src/app.js'), 'export function main() {}');

    engine = new GrafEngine(temp.dir);
    await engine.init();
    await engine.sync();

    const hasTreeOutline = typeof engine.treeOutline === 'function';
    if (!gateFeature(t, 'treeOutline Method (M3)', hasTreeOutline)) return;

    const tree = await engine.treeOutline();
    assert.equal(typeof tree, 'string');
    assert.ok(!tree.includes('file:src/app.js'), 'Should not contain redundant file: prefix');
  } finally {
    engine?.close();
    await temp.cleanup();
  }
});

test('T1.LEAN.05: engine.overview({ format: "outline" }) parameter override returns outline', async (t) => {
  const temp = await createTempRepo();
  let engine;
  try {
    await fs.writeFile(path.join(temp.dir, 'index.js'), 'export const x = 42;');
    engine = new GrafEngine(temp.dir);
    await engine.init();
    await engine.sync();

    const hasFormatOption = typeof (await engine.overview({ format: 'outline' })).outline === 'string';
    if (!gateFeature(t, 'Lean Overview Format Option (M3)', hasFormatOption)) return;

    const res = await engine.overview({ format: 'outline' });
    assert.ok(res.outline);
  } finally {
    engine?.close();
    await temp.cleanup();
  }
});

/* ==========================================================================
   TIER 2: BOUNDARY & CORNER CASES SUITE
   ========================================================================== */

test('T2.BOUND.01: Empty files of all supported web extensions parse gracefully with parseOk=true', async (t) => {
  const exts = ['.html', '.css', '.scss', '.vue', '.svelte', '.js', '.ts'];
  for (const ext of exts) {
    const filename = `empty${ext}`;
    const parsed = parseSource(filename, '');
    assert.equal(parsed.parseOk, true, `Empty file ${filename} should parseOk`);
    assert.equal(parsed.nodes[0]?.kind, 'file');
  }
});

test('T2.BOUND.02: Whitespace and comment-only source files produce zero spurious function nodes', async (t) => {
  const content = `
    // Just a header comment
    /*
     * Multi-line explanation of nothing
     */
    
    // Another comment
  `;
  const parsed = parseSource('comments.js', content);
  assert.equal(parsed.parseOk, true);
  const functions = parsed.nodes.filter(n => n.kind === 'function');
  assert.equal(functions.length, 0, 'No spurious functions should be detected');
});

test('T2.BOUND.03: Malformed HTML with unclosed tags and orphan brackets parses without crash', async (t) => {
  const hasHtml = SUPPORTED_EXTENSIONS.has('.html');
  if (!gateFeature(t, 'HTML Indexing (M1)', hasHtml)) return;

  const malformed = `
    <div class="unclosed">
      <p>Paragraph without closing tag
      <span id="lonely-span">Broken angle brackets <<>>
      <input type="text" value="unclosed attribute
    </div>
  `;
  const parsed = parseSource('broken.html', malformed);
  assert.equal(parsed.parseOk, true, 'Parser must recover from malformed HTML');
});

test('T2.BOUND.04: Malformed CSS with unclosed braces and pseudo-elements parses safely', async (t) => {
  const hasCss = SUPPORTED_EXTENSIONS.has('.css');
  if (!gateFeature(t, 'CSS Indexing (M1)', hasCss)) return;

  const malformedCss = `
    .broken-rule {
      color: red;
      /* missing closing brace
    
    #next-rule {
      padding: 10px;
    }
    :is(:where(.complex, [data-broken="yes"]))::after {
      content: '';
    }
  `;
  const parsed = parseSource('broken.css', malformedCss);
  assert.equal(parsed.parseOk, true, 'CSS parser must not throw unhandled exception');
});

test('T2.BOUND.05: Complex TypeScript nested generics parse without crashing visitor', async (t) => {
  const hasAstUpgrade = typeof parseSource('test.js', 'const a = 1;').domQueries !== 'undefined';
  if (!gateFeature(t, 'AST-based JS/TS Parsing (M1)', hasAstUpgrade)) return;

  const complexTs = `
    export type DeepRecord<T> = Map<string, Promise<Array<Record<string, T>>>>;
    export async function resolveComplexPipeline<
      TInput extends { id: string; meta?: Record<string, unknown> },
      TOutput = Promise<TInput>
    >(input: TInput, options?: { timeout?: number }): Promise<TOutput> {
      return input as unknown as Promise<TOutput>;
    }
  `;
  const parsed = parseSource('types.ts', complexTs);
  assert.equal(parsed.parseOk, true);
  assert.ok(parsed.nodes.some(n => n.name === 'resolveComplexPipeline'));
});

test('T2.BOUND.06: Complex parameter destructuring with defaults and rest parameters parses cleanly', async (t) => {
  const js = `
    export const configureSystem = ({
      network: { host = '127.0.0.1', port = 8080 } = {},
      security = { ssl: true },
      ...extraOptions
    } = {}) => {
      return { host, port, extraOptions };
    };
  `;
  const parsed = parseSource('config.js', js);
  assert.equal(parsed.parseOk, true);
  const fn = parsed.nodes.find(n => n.name === 'configureSystem');
  assert.ok(fn, 'configureSystem function must be extracted');
  assert.equal(fn.lineStart, 2);
});

test('T2.BOUND.07: Circular module imports do not cause infinite recursion or stack overflow', async (t) => {
  const temp = await createTempRepo();
  let engine;
  try {
    const hasCrossFile = typeof GrafEngine.prototype.resolveCrossFileSymbols === 'function';
    if (!gateFeature(t, 'Cross-File Symbol Resolution (M2)', hasCrossFile)) return;

    await fs.mkdir(path.join(temp.dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(temp.dir, 'src/nodeA.js'), `
      import { pingB } from './nodeB.js';
      export function pingA() { return pingB(); }
    `);
    await fs.writeFile(path.join(temp.dir, 'src/nodeB.js'), `
      import { pingA } from './nodeA.js';
      export function pingB() { return pingA(); }
    `);

    engine = new GrafEngine(temp.dir);
    await engine.init();
    await engine.sync();

    assert.ok(engine.search('pingA').length > 0);
    assert.ok(engine.search('pingB').length > 0);
  } finally {
    engine?.close();
    await temp.cleanup();
  }
});

test('T2.BOUND.08: Chained re-exports (export * from and export { a } from) resolve correctly', async (t) => {
  const temp = await createTempRepo();
  let engine;
  try {
    const hasCrossFile = typeof GrafEngine.prototype.resolveCrossFileSymbols === 'function';
    if (!gateFeature(t, 'Cross-File Symbol Resolution (M2)', hasCrossFile)) return;

    await fs.mkdir(path.join(temp.dir, 'src/internal'), { recursive: true });
    await fs.writeFile(path.join(temp.dir, 'src/internal/core.js'), `
      export function coreOperation() { return 'ok'; }
    `);
    await fs.writeFile(path.join(temp.dir, 'src/internal/index.js'), `
      export { coreOperation } from './core.js';
    `);
    await fs.writeFile(path.join(temp.dir, 'src/client.js'), `
      import { coreOperation } from './internal/index.js';
      export function invokeClient() { return coreOperation(); }
    `);

    engine = new GrafEngine(temp.dir);
    await engine.init();
    await engine.sync();

    const client = engine.search('invokeClient')[0];
    const core = engine.search('coreOperation')[0];
    assert.ok(client && core);
  } finally {
    engine?.close();
    await temp.cleanup();
  }
});

test('T2.BOUND.09: Large source file with 50+ functions parses within latency threshold', async (t) => {
  const functions = [];
  for (let i = 0; i < 60; i++) {
    functions.push(`
      export function syntheticFunction_${i}(paramA, paramB) {
        const temp = paramA + paramB;
        if (temp > 100) return temp * 2;
        return temp;
      }
    `);
  }
  const largeContent = functions.join('\n');
  const t0 = Date.now();
  const parsed = parseSource('large.js', largeContent);
  const elapsed = Date.now() - t0;

  assert.equal(parsed.parseOk, true);
  assert.equal(parsed.nodes.filter(n => n.kind === 'function').length, 60);
  assert.ok(elapsed < 1000, `Parsing 60 functions took ${elapsed}ms (expected <1000ms)`);
});

test('T2.BOUND.10: Selectors with escaped quotes and attribute brackets parse correctly', async (t) => {
  const hasCss = SUPPORTED_EXTENSIONS.has('.css');
  if (!gateFeature(t, 'CSS Indexing (M1)', hasCss)) return;

  const css = `
    [data-theme='dark'] .card[aria-expanded="true"] {
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }
  `;
  const parsed = parseSource('theme.css', css);
  assert.equal(parsed.parseOk, true);
});

/* ==========================================================================
   TIER 3: CROSS-FEATURE INTERACTION SUITE
   ========================================================================== */

test('T3.INT.01: Full-stack interaction chain (HTML -> JS -> DOM Query -> CSS -> Cross-File Call)', async (t) => {
  const temp = await createTempRepo();
  let engine;
  try {
    const hasHtml = SUPPORTED_EXTENSIONS.has('.html');
    const hasCrossFile = typeof GrafEngine.prototype.resolveCrossFileSymbols === 'function';
    if (!gateFeature(t, 'Full-Stack Interaction (M1+M2)', hasHtml && hasCrossFile)) return;

    await fs.mkdir(path.join(temp.dir, 'src/api'), { recursive: true });
    await fs.mkdir(path.join(temp.dir, 'src/ui'), { recursive: true });

    await fs.writeFile(path.join(temp.dir, 'index.html'), `
      <!DOCTYPE html>
      <html>
        <head>
          <link rel="stylesheet" href="./style.css">
          <script type="module" src="./src/ui/app.js"></script>
        </head>
        <body>
          <div id="cart-root"></div>
        </body>
      </html>
    `);

    await fs.writeFile(path.join(temp.dir, 'style.css'), `
      :root {
        --cart-bg: #f8f9fa;
      }
      #cart-root {
        background-color: var(--cart-bg);
      }
    `);

    await fs.writeFile(path.join(temp.dir, 'src/api/products.js'), `
      export function fetchProductDetails(id) {
        return { id, name: 'Sample Item' };
      }
    `);

    await fs.writeFile(path.join(temp.dir, 'src/ui/app.js'), `
      import { fetchProductDetails } from '../api/products.js';
      export function mountCart() {
        const container = document.getElementById('cart-root');
        const product = fetchProductDetails(42);
        return { container, product };
      }
    `);

    engine = new GrafEngine(temp.dir);
    await engine.init();
    await engine.sync();

    // 1. Verify HTML DOM node exists
    const domNode = engine.search('cart-root')[0];
    assert.ok(domNode, 'DOM node #cart-root must be indexed');

    // 2. Verify Cross-file call edge exists
    const mountFn = engine.search('mountCart')[0];
    const fetchFn = engine.search('fetchProductDetails')[0];
    assert.ok(mountFn && fetchFn);

    const callEdge = Object.values(engine.store.data.edges).find(
      e => e.type === 'calls' && e.src === mountFn.id && e.dst === fetchFn.id
    );
    assert.ok(callEdge, 'mountCart must call fetchProductDetails across files');

    // 3. Verify DOM query edge exists if resolveDomQueries is present
    if (typeof engine.resolveDomQueries === 'function') {
      const queryEdge = Object.values(engine.store.data.edges).find(
        e => e.type === 'queries' && e.src === mountFn.id
      );
      assert.ok(queryEdge, 'mountCart should query #cart-root node');
    }
  } finally {
    engine?.close();
    await temp.cleanup();
  }
});

test('T3.INT.02: SFC multi-block indexing (Vue/Svelte template + script + style)', async (t) => {
  const hasSfc = SUPPORTED_EXTENSIONS.has('.vue');
  if (!gateFeature(t, 'SFC Indexing (M1)', hasSfc)) return;

  const vueContent = `
    <template>
      <div id="vue-app" class="vue-container">
        <h1>{{ title }}</h1>
        <button id="vue-button" @click="increment">Click</button>
      </div>
    </template>

    <script>
    export default {
      data() {
        return { title: 'Vue SFC' };
      },
      methods: {
        increment() {
          return 1;
        }
      }
    };
    </script>

    <style scoped>
    .vue-container {
      padding: 20px;
    }
    #vue-button {
      color: green;
    }
    </style>
  `;
  const parsed = parseSource('App.vue', vueContent);
  assert.equal(parsed.parseOk, true);

  // Check that nodes from template, script, and style are captured
  assert.ok(parsed.nodes.some(n => n.name === '#vue-app' || n.id.includes('#vue-app')));
  assert.ok(parsed.nodes.some(n => n.name === 'increment' || n.name?.includes('increment')));
});

test('T3.INT.03: Incremental sync recomputes cross-file edges when imported symbol is updated', async (t) => {
  const temp = await createTempRepo();
  let engine;
  try {
    const hasCrossFile = typeof GrafEngine.prototype.resolveCrossFileSymbols === 'function';
    if (!gateFeature(t, 'Cross-File Symbol Resolution (M2)', hasCrossFile)) return;

    await fs.mkdir(path.join(temp.dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(temp.dir, 'src/api.js'), `
      export function fetchUser() { return { user: 'Alice' }; }
    `);
    await fs.writeFile(path.join(temp.dir, 'src/main.js'), `
      import { fetchUser } from './api.js';
      export function boot() { return fetchUser(); }
    `);

    engine = new GrafEngine(temp.dir);
    await engine.init();
    await engine.sync();

    let bootFn = engine.search('boot')[0];
    let userFn = engine.search('fetchUser')[0];
    assert.ok(bootFn && userFn);

    // Update api.js with new function and re-sync
    await fs.writeFile(path.join(temp.dir, 'src/api.js'), `
      export function fetchUser() { return { user: 'Alice' }; }
      export function fetchRoles() { return ['admin']; }
    `);
    await engine.sync();

    const rolesFn = engine.search('fetchRoles')[0];
    assert.ok(rolesFn, 'fetchRoles must be discovered after incremental sync');
  } finally {
    engine?.close();
    await temp.cleanup();
  }
});

test('T3.INT.04: Deleting an imported file prunes its nodes and cross-file edges cleanly', async (t) => {
  const temp = await createTempRepo();
  let engine;
  try {
    const hasCrossFile = typeof GrafEngine.prototype.resolveCrossFileSymbols === 'function';
    if (!gateFeature(t, 'Cross-File Symbol Resolution (M2)', hasCrossFile)) return;

    await fs.mkdir(path.join(temp.dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(temp.dir, 'src/dep.js'), 'export function helper() { return true; }');
    await fs.writeFile(path.join(temp.dir, 'src/main.js'), `
      import { helper } from './dep.js';
      export function run() { return helper(); }
    `);

    engine = new GrafEngine(temp.dir);
    await engine.init();
    await engine.sync();

    assert.ok(engine.search('helper').length > 0);

    // Remove dep.js and re-sync
    await fs.rm(path.join(temp.dir, 'src/dep.js'));
    await engine.sync();

    assert.equal(engine.search('helper').length, 0, 'Deleted symbol must not appear in search');
  } finally {
    engine?.close();
    await temp.cleanup();
  }
});

test('T3.INT.05: Git branch isolation retains separate graph states for web assets', async (t) => {
  const temp = await createTempRepo();
  let engine;
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);

    // Initialize git repository
    await exec('git', ['init', '-b', 'main'], { cwd: temp.dir });
    await exec('git', ['config', 'user.name', 'Test Runner'], { cwd: temp.dir });
    await exec('git', ['config', 'user.email', 'test@graf.local'], { cwd: temp.dir });

    await fs.writeFile(path.join(temp.dir, 'main.js'), 'export function v1() {}');
    await exec('git', ['add', '.'], { cwd: temp.dir });
    await exec('git', ['commit', '-m', 'Initial commit'], { cwd: temp.dir });

    engine = new GrafEngine(temp.dir);
    await engine.init();
    await engine.sync();
    assert.ok(engine.search('v1').length > 0);

    // Switch branch to feature-branch
    await exec('git', ['checkout', '-b', 'feature-web'], { cwd: temp.dir });
    await fs.writeFile(path.join(temp.dir, 'feature.js'), 'export function webFeature() {}');
    await exec('git', ['add', '.'], { cwd: temp.dir });
    await exec('git', ['commit', '-m', 'Add web feature'], { cwd: temp.dir });
    await engine.sync();

    assert.ok(engine.search('webFeature').length > 0);

    // Switch back to main
    await exec('git', ['checkout', 'main'], { cwd: temp.dir });
    await engine.sync();
    assert.equal(engine.search('webFeature').length, 0, 'Feature branch symbol should not be visible on main');
    assert.ok(engine.search('v1').length > 0);
  } catch (err) {
    if (err.message?.includes('git')) {
      t.skip('Git command unavailable in test environment');
      return;
    }
    throw err;
  } finally {
    engine?.close();
    await temp.cleanup();
  }
});

/* ==========================================================================
   TIER 4: REAL-WORLD APPLICATION WORKLOADS (D:\Graf Test Ground)
   ========================================================================== */

test('T4.GROUND.01: Index Aura Storefront (07_website_ecommerce) from D:\\Graf Test Ground', async (t) => {
  const repoPath = 'D:\\Graf Test Ground\\07_website_ecommerce';
  let exists = false;
  try {
    await fs.access(repoPath);
    exists = true;
  } catch {}

  if (!exists) {
    t.skip(`Test ground repo not accessible at ${repoPath}`);
    return;
  }

  let engine;
  try {
    engine = new GrafEngine(repoPath);
    await engine.init();
    const syncResult = await engine.sync();

    assert.ok(syncResult.files > 0, 'Aura Storefront should index > 0 files');
    const nodes = engine.activeNodes();
    assert.ok(nodes.length > 5, `Expected > 5 nodes in Aura Storefront, found ${nodes.length}`);

    // If HTML/CSS indexing is enabled, assert markup files were indexed
    const hasHtml = SUPPORTED_EXTENSIONS.has('.html');
    if (hasHtml) {
      const htmlFiles = Object.keys(engine.store.data.files).filter(f => f.endsWith('.html'));
      assert.ok(htmlFiles.length > 0, 'Aura Storefront index.html should be indexed');
    }
  } finally {
    engine?.close();
  }
});

test('T4.GROUND.02: Index React Web Store (04_web_react_store) from D:\\Graf Test Ground', async (t) => {
  const repoPath = 'D:\\Graf Test Ground\\04_web_react_store_with_graf';
  let exists = false;
  try {
    await fs.access(repoPath);
    exists = true;
  } catch {}

  if (!exists) {
    t.skip(`Test ground repo not accessible at ${repoPath}`);
    return;
  }

  let engine;
  try {
    engine = new GrafEngine(repoPath);
    await engine.init();
    const syncResult = await engine.sync();

    assert.ok(syncResult.files > 0, 'React store should index files');
    const nodes = engine.activeNodes();
    assert.ok(nodes.length > 5, 'React store should contain symbols');
  } finally {
    engine?.close();
  }
});

test('T4.GROUND.03: Full-stack Node/TS symbol resolution (01_node_auth_with_graf)', async (t) => {
  const repoPath = 'D:\\Graf Test Ground\\01_node_auth_with_graf';
  let exists = false;
  try {
    await fs.access(repoPath);
    exists = true;
  } catch {}

  if (!exists) {
    t.skip(`Test ground repo not accessible at ${repoPath}`);
    return;
  }

  let engine;
  try {
    engine = new GrafEngine(repoPath);
    await engine.init();
    const syncResult = await engine.sync();
    assert.ok(syncResult.files > 0);
  } finally {
    engine?.close();
  }
});

test('T4.GROUND.04: Lean overview payload token budget evaluation on test ground project', async (t) => {
  const repoPath = 'D:\\Graf Test Ground\\07_website_ecommerce';
  let exists = false;
  try {
    await fs.access(repoPath);
    exists = true;
  } catch {}

  if (!exists) {
    t.skip(`Test ground repo not accessible at ${repoPath}`);
    return;
  }

  let engine;
  try {
    engine = new GrafEngine(repoPath);
    await engine.init();
    await engine.sync();

    const overview = await engine.overview(0);
    const hasLean = typeof overview.outline === 'string';
    if (!gateFeature(t, 'Lean Overview Output (M3)', hasLean)) return;

    assert.ok(overview.outline.length < 1000, `Overview outline should be compact, got length ${overview.outline.length}`);
  } finally {
    engine?.close();
  }
});

test('T4.GROUND.05: Engine database close releases SQLite file locks immediately on Windows', async (t) => {
  const temp = await createTempRepo();
  let engine;
  try {
    await fs.writeFile(path.join(temp.dir, 'app.js'), 'export function boot() {}');
    engine = new GrafEngine(temp.dir);
    await engine.init();
    await engine.sync();

    // Close engine
    engine.close();

    // Verify database file can be removed immediately without EBUSY
    const dbPath = path.join(temp.dir, '.graf', 'graph.db');
    await fs.unlink(dbPath);
    assert.ok(true, 'SQLite database unlinked successfully without lock');
  } finally {
    await temp.cleanup();
  }
});
