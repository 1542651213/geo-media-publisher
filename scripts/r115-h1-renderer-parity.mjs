import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

const baseline = 'c2017994ef3df592fd17ffa009a56fbcca99796c';
const root = 'apps/desktop/src/renderer';
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, ...args], { encoding: 'utf8', maxBuffer: 5_000_000 }).trim();
const printer = ts.createPrinter({ removeComments: true });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function ipcCalls(source, path) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const calls = [];
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast).startsWith('window.publisherAPI.')) calls.push(printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/\s+/gu, ' '));
    ts.forEachChild(node, visit);
  };
  visit(ast); return calls;
}
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory() ? sourceFiles(join(directory, item.name)) : /\.tsx?$/u.test(item.name) ? [join(directory, item.name)] : []);
}
const originalPaths = git('ls-tree', '-r', '--name-only', baseline, '--', root).split('\n').filter(path => /\.tsx?$/u.test(path));
const before = originalPaths.flatMap(path => ipcCalls(git('show', `${baseline}:${path}`), path)).sort();
const after = sourceFiles(root).flatMap(path => ipcCalls(readFileSync(path, 'utf8'), path)).sort();
assert.deepEqual(after, before, 'Renderer IPC invocation or arguments changed');

const require = createRequire(import.meta.url), viteRequire = createRequire(require.resolve('vite/package.json'));
const postcss = viteRequire('postcss');
function selectors(source) { const values = []; postcss.parse(source).walkRules(rule => values.push(rule.selector.replace(/\s+/gu, ' ').trim())); return values; }
const styles = ['styles.css', 'operations-center.css', 'platform-connection.css', 'product-ai-center.css'].map(file => {
  const original = selectors(git('show', `${baseline}:${root}/${file}`));
  const current = selectors(readFileSync(`${root}/${file}`, 'utf8') + (file === 'styles.css' ? '\n' + readFileSync(`${root}/design/workspace-layout.css`, 'utf8') : ''));
  assert.deepEqual(current, original, `${file}: original dynamic selectors removed or reordered`);
  return { file, selectors: original.length, hash: hash(current), originalSelectorsPreserved: true };
});
const result = { status: 'PASS', baseline, rendererIpcCalls: before.length, ipcCallHash: hash(after), ipcCallsAndArgumentsIdentical: true, styles };
const target = resolve(process.argv[2] ?? 'output/r115-h1-execution-20261003/renderer-parity.json');
mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
