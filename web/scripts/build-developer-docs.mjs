// Build the public-only documentation and local full-text index into the Admin release.
import { readFile, readdir, mkdir, writeFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Marked, Renderer } from 'marked';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '../content/developer-docs');
const output = resolve(import.meta.dirname, '../public/assets/developer-docs');
const index = parse(await readFile(resolve(root, 'index.en.yaml'), 'utf8'));
const slugs = new Set(index.sections.map((entry) => entry.slug));
if (slugs.size !== index.sections.length) throw new Error('Duplicate documentation slug');
const pages = [];
for (const entry of index.sections) {
  if (entry.source !== `${entry.slug}.en.md` || !/^[a-z-]+$/.test(entry.slug)) throw new Error('Invalid source path');
  const raw = await readFile(resolve(root, entry.source), 'utf8');
  const [, frontmatter, ...bodyParts] = raw.split('---');
  const metadata = parse(frontmatter);
  const body = bodyParts.join('---').trim().replace(/^# [^\n]+\n/, '');
  for (const key of ['title', 'description', 'category', 'keywords', 'language', 'applies_to', 'last_verified', 'verification']) {
    if (!metadata[key]) throw new Error(`${entry.source}: missing ${key}`);
  }
  const headings = [];
  const anchors = new Map();
  const renderer = new Marked({
    gfm: true,
    renderer: {
      link(token) {
        const html = Renderer.prototype.link.call(this, token);
        return token.href.startsWith('/assets/developer-docs/assets/') && token.href.endsWith('.mmd')
          ? html.replace('<a ', '<a download ') : html;
      },
      html() { throw new Error(`${entry.source}: raw HTML is not supported`); },
      heading({ tokens, depth, text }) {
        const base = text.toLowerCase().replace(/[^\w -]/g, '').replace(/ /g, '-');
        const count = anchors.get(base) || 0;
        anchors.set(base, count + 1);
        const anchor = count ? `${base}-${count}` : base;
        headings.push({ title: text, anchor, depth });
        return `<h${depth} id="${anchor}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
    },
    walkTokens(token) {
      if (!['link', 'image'].includes(token.type)) return;
      let href = token.href;
      if (href.startsWith('assets/')) href = `/assets/developer-docs/${href}`;
      else if (/^[a-z-]+\.en\.md(?:#.*)?$/.test(href)) {
        if (!slugs.has(href.split('.')[0])) throw new Error(`Unknown page: ${href}`);
        href = `/console/developer-docs/${href.replace('.en.md', '')}`;
      }
      if (!/^(https:\/\/|#|\/console\/|\/assets\/developer-docs\/assets\/)/.test(href)) throw new Error(`Unsupported link: ${href}`);
      token.href = href;
    },
  });
  const html = renderer.parse(body);
  pages.push({ ...entry, ...metadata, html, headings, text: body, url: `/console/developer-docs/${entry.slug}` });
}
for (const file of await readdir(resolve(root, 'assets'))) {
  if (!file.endsWith('.mmd')) continue;
  const source = await readFile(resolve(root, 'assets', file));
  const svg = await readFile(resolve(root, 'assets', file.replace('.mmd', '.svg')), 'utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  if (!svg.includes(`source-sha256: ${hash}`)) throw new Error(`Regenerate diagram ${file}`);
}
await mkdir(output, { recursive: true });
await cp(resolve(root, 'assets'), resolve(output, 'assets'), { recursive: true });
await writeFile(resolve(output, 'index.en.json'), `${JSON.stringify({ title: index.title, pages })}\n`);
console.log(`Published ${pages.length} Developer Docs pages with local search metadata and diagrams.`);
