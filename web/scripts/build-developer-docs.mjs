// Publish every approved documentation locale with stable article URLs and anchors.
import { readFile, readdir, mkdir, writeFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Marked, Renderer } from 'marked';
import { parse } from 'yaml';
import { configuredLocales } from '../localization/config.mjs';

const root = resolve(import.meta.dirname, '../content/developer-docs');
const output = resolve(import.meta.dirname, '../public/assets/developer-docs');
const sourceIndex = parse(await readFile(resolve(root, 'index.en.yaml'), 'utf8'));
const slugs = sourceIndex.sections.map(entry => entry.slug);
if (new Set(slugs).size !== slugs.length) throw new Error('Duplicate documentation slug');
const englishHeadings = new Map();
const englishExamples = new Map();
const catalogVersions = {};

for (const locale of configuredLocales) {
  const index = parse(await readFile(resolve(root, `index.${locale}.yaml`), 'utf8'));
  if (index.language !== locale || JSON.stringify(index.sections.map(entry => entry.slug)) !== JSON.stringify(slugs)) {
    throw new Error(`${locale}: documentation inventory differs from English`);
  }
  const pages = [];
  for (const entry of index.sections) {
    if (entry.source !== `${entry.slug}.${locale}.md` || !/^[a-z-]+$/.test(entry.slug)) throw new Error('Invalid source path');
    const raw = await readFile(resolve(root, entry.source), 'utf8');
    const examples = raw.match(/^(```|~~~)[^\n]*\n[\s\S]*?^\1\s*$/gm) || [];
    if (locale === 'en') englishExamples.set(entry.slug, examples);
    else if (JSON.stringify(examples) !== JSON.stringify(englishExamples.get(entry.slug))) throw new Error(`${entry.source}: code examples differ from English`);
    const [, frontmatter, ...bodyParts] = raw.split('---');
    const metadata = parse(frontmatter);
    if (metadata.language !== locale) throw new Error(`${entry.source}: incorrect language`);
    const body = bodyParts.join('---').trim().replace(/^# [^\n]+\n/, '');
    for (const key of ['title', 'description', 'category', 'keywords', 'language', 'applies_to', 'last_verified', 'verification']) {
      if (!metadata[key]) throw new Error(`${entry.source}: missing ${key}`);
    }
    const headings = [];
    const anchors = new Map();
    const sourceHeadings = englishHeadings.get(entry.slug);
    const renderer = new Marked({
      gfm: true,
      renderer: {
        link(token) {
          const html = Renderer.prototype.link.call(this, token);
          return token.href.startsWith('/assets/developer-docs/assets/') && /\.(mmd|zip)$/.test(token.href)
            ? html.replace('<a ', '<a download ') : html;
        },
        html() { throw new Error(`${entry.source}: raw HTML is not supported`); },
        heading({ tokens, depth, text }) {
          const base = text.toLowerCase().replace(/[^\w -]/g, '').replace(/ /g, '-');
          const count = anchors.get(base) || 0;
          anchors.set(base, count + 1);
          const anchor = sourceHeadings ? sourceHeadings[headings.length]?.anchor : count ? `${base}-${count}` : base;
          if (!anchor || (sourceHeadings && sourceHeadings[headings.length]?.depth !== depth)) throw new Error(`${entry.source}: headings differ from English`);
          headings.push({ title: text, anchor, depth });
          return `<h${depth} id="${anchor}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
        },
      },
      walkTokens(token) {
        if (!['link', 'image'].includes(token.type)) return;
        let href = token.href;
        if (href.startsWith('assets/')) {
          if (!existsSync(resolve(root, href.split('#')[0]))) throw new Error(`${entry.source}: missing asset ${href}`);
          if (locale !== 'en' && /\.(?:svg|mmd|html)$/.test(href) && !href.includes(`.${locale}.`)) throw new Error(`${entry.source}: untranslated diagram ${href}`);
          href = `/assets/developer-docs/${href}`;
        }
        else if (/^[a-z-]+\.(?:en|zh-TW|zh-CN)\.md(?:#.*)?$/.test(href)) {
          if (!slugs.includes(href.split('.')[0])) throw new Error(`Unknown page: ${href}`);
          href = `/console/developer-docs/${href.split('.')[0]}${href.includes('#') ? `#${href.split('#')[1]}` : ''}`;
        }
        if (!/^(https:\/\/|#|\/console\/|\/assets\/developer-docs\/assets\/)/.test(href)) throw new Error(`Unsupported link: ${href}`);
        token.href = href;
      },
    });
    const html = renderer.parse(body);
    if (sourceHeadings && headings.length !== sourceHeadings.length) throw new Error(`${entry.source}: headings differ from English`);
    if (locale === 'en') englishHeadings.set(entry.slug, headings);
    pages.push({ ...entry, ...metadata, html, headings, text: body, url: `/console/developer-docs/${entry.slug}` });
  }
  const pageBySlug = new Map(pages.map(page => [page.slug, page]));
  for (const page of pages) {
    for (const [, href] of page.html.matchAll(/href="([^"]+)"/g)) {
      if (!href.startsWith('#') && !href.startsWith('/console/developer-docs/')) continue;
      const [path, anchor] = href.split('#');
      if (!anchor) continue;
      const target = path ? pageBySlug.get(path.split('/').at(-1)) : page;
      if (!target?.headings.some(heading => heading.anchor === decodeURIComponent(anchor))) throw new Error(`${locale}: invalid chapter link ${page.slug} -> ${href}`);
    }
  }
  await mkdir(output, { recursive: true });
  const catalog = `${JSON.stringify({ title: index.title, pages })}\n`;
  catalogVersions[locale] = createHash('sha256').update(catalog).digest('hex');
  await writeFile(resolve(output, `index.${locale}.json`), catalog);
  console.log(`Published ${pages.length} ${locale} Developer Docs pages.`);
}
for (const file of await readdir(resolve(root, 'assets'))) {
  if (!file.endsWith('.mmd')) continue;
  const source = await readFile(resolve(root, 'assets', file));
  const svg = await readFile(resolve(root, 'assets', file.replace('.mmd', '.svg')), 'utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  if (!svg.includes(`source-sha256: ${hash}`)) throw new Error(`Regenerate diagram ${file}`);
}
for (const file of await readdir(resolve(root, 'assets'))) {
  if (!file.endsWith('.html') || /\.(?:zh-TW|zh-CN)\.html$/.test(file)) continue;
  const english = await readFile(resolve(root, 'assets', file), 'utf8');
  const textCount = [...english.matchAll(/<text\b[^>]*>[^<>]*<\/text>/g)].length;
  for (const locale of configuredLocales.filter(value => value !== 'en')) {
    const target = file.replace(/\.html$/, `.${locale}.html`);
    const localized = await readFile(resolve(root, 'assets', target), 'utf8');
    const htmlLang = locale === 'zh-TW' ? 'zh-Hant' : 'zh-Hans';
    if (!localized.includes(`<html lang="${htmlLang}">`) || [...localized.matchAll(/<text\b[^>]*>[^<>]*<\/text>/g)].length !== textCount || !/[\u3400-\u9fff]/.test(localized)) {
      throw new Error(`Invalid localized sequence diagram ${target}`);
    }
  }
}
await cp(resolve(root, 'assets'), resolve(output, 'assets'), { recursive: true });
await writeFile(resolve(import.meta.dirname, '../src/developer-docs-version.generated.mjs'), `// Generated by build-developer-docs.mjs.\nexport const developerDocsVersions = Object.freeze(${JSON.stringify(catalogVersions)});\n`);
