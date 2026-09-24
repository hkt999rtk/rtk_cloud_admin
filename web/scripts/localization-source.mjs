import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { placeholders } from '../localization/checksums.mjs';

const root = resolve(import.meta.dirname, '../src');
const apiRoot = resolve(import.meta.dirname, '../../internal/app');
const catalogPath = resolve(import.meta.dirname, '../localization/catalog.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const known = new Set(catalog.strings.map(({ key }) => key));
const found = new Set();
const bareCopy = [];

for (const name of await readdir(root)) {
  if (!/\.(jsx|mjs)$/.test(name) || name.endsWith('.test.mjs')) continue;
  const source = await readFile(resolve(root, name), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  traverse(ast, {
    CallExpression(path) {
      if (path.node.callee.type !== 'Identifier' || path.node.callee.name !== 'translate') return;
      const key = path.node.arguments[0];
      if (key?.type === 'StringLiteral') found.add(key.value);
    },
    ObjectProperty(path) {
      const field = path.node.key.name || path.node.key.value;
      if (!['label', 'title', 'detail', 'hint', 'message', 'description'].includes(field)) return;
      if (path.node.value?.type === 'StringLiteral' && /[A-Za-z]{2}/.test(path.node.value.value)) found.add(path.node.value.value);
    },
    JSXText(path) {
      if (path.findParent(parent => parent.isJSXElement() && ['code', 'pre', 'kbd'].includes(parent.node.openingElement.name?.name))) return;
      const copy = path.node.value.replace(/\s+/g, ' ').trim();
      if (/[A-Za-z]{2}/.test(copy) && !/^&[a-z]+;$/.test(copy)) bareCopy.push(`${name}:${path.node.loc.start.line}: ${copy.slice(0, 80)}`);
    },
    JSXAttribute(path) {
      if (!['aria-label', 'placeholder', 'title', 'alt'].includes(path.node.name.name)) return;
      const element = path.parentPath.node.name?.name;
      if (/^[A-Z]/.test(element || '')) return;
      if (path.node.value?.type === 'StringLiteral' && /[A-Za-z]{2}/.test(path.node.value.value)) bareCopy.push(`${name}:${path.node.loc.start.line}: ${path.node.name.name}`);
      if (path.node.value?.type === 'JSXExpressionContainer') {
        path.traverse({
          StringLiteral(literal) {
            if (!/[A-Za-z]{2}/.test(literal.node.value)) return;
            if (literal.findParent(parent => parent.isCallExpression() && parent.node.callee.type === 'Identifier' && parent.node.callee.name === 'translate')) return;
            bareCopy.push(`${name}:${literal.node.loc.start.line}: ${path.node.name.name} expression`);
          },
        });
      }
    },
    TemplateLiteral(path) {
      if (!path.findParent(parent => parent.isJSXExpressionContainer())) return;
      const attribute = path.findParent(parent => parent.isJSXAttribute());
      if (attribute && !['aria-label', 'placeholder', 'title', 'alt'].includes(attribute.node.name.name)) return;
      if (path.findParent(parent => parent.isCallExpression() && parent.node.callee.type === 'Identifier' && parent.node.callee.name === 'translate')) return;
      const literalCopy = path.node.quasis.map(quasi => quasi.value.cooked).join('');
      if (/[A-Za-z]{2}/.test(literalCopy) && !/^\s*(?:fa-|\/|#|:rate-limit)/.test(literalCopy)) bareCopy.push(`${name}:${path.node.loc.start.line}: template copy`);
    },
  });
}

for (const name of await readdir(apiRoot)) {
  if (!name.endsWith('.go') || name.endsWith('_test.go')) continue;
  const source = await readFile(resolve(apiRoot, name), 'utf8');
  const systemMessage = /(?:"(?:source_message|message)"|SourceMessage)\s*:\s*("(?:\\.|[^"\\])*")/g;
  for (const match of source.matchAll(systemMessage)) {
    const value = JSON.parse(match[1]);
    if (/[A-Za-z]{2}/.test(value)) found.add(value);
  }
}

const burnerRoot = resolve(root, 'pro2-firmware-burner');
for (const name of await readdir(burnerRoot)) {
  if (!name.endsWith('.js') || name.endsWith('.test.js')) continue;
  const source = await readFile(resolve(burnerRoot, name), 'utf8');
  const ast = parse(source, { sourceType: 'module' });
  traverse(ast, {
    StringLiteral(path) {
      const value = path.node.value;
      if (value.startsWith('fa-solid ') || value.includes('SFMono-Regular')) return;
      if (/\b[A-Za-z]{2,}\b.*\s+.*\b[A-Za-z]{2,}\b/.test(value)) found.add(value);
    },
  });
}

const missing = [...found].filter(key => !known.has(key) && !known.has(`${key}_one`) && !known.has(`${key}_other`)).sort();
if (process.argv.includes('--extract')) {
  for (const key of missing) catalog.strings.push({ key, source: key, context: 'Admin Console interface message', placeholders: placeholders(key) });
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Added ${missing.length} English strings to the catalog.`);
} else {
  if (missing.length || bareCopy.length) {
    throw new Error(`Unmanaged Admin copy:\n${missing.map(key => `missing key: ${key}`).concat(bareCopy).join('\n')}`);
  }
  console.log(`Checked ${found.size} translation calls and production JSX copy.`);
}
