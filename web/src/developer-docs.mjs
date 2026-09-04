export function searchDeveloperDocs(pages, query) {
  const phrase = String(query || '').toLowerCase().trim();
  const terms = phrase.split(/\s+/).filter(Boolean);
  if (!terms.length) return pages;
  return pages.map((page) => {
    const title = page.title.toLowerCase();
    const description = page.description.toLowerCase();
    const keywords = page.keywords.join(' ').toLowerCase();
    const headings = (page.headings || []).map((heading) => heading.title).join(' ').toLowerCase();
    const content = `${title} ${description} ${keywords} ${page.text}`.toLowerCase();
    const score = (title === phrase ? 1000 : title.includes(phrase) ? 100 : 0) + terms.reduce((sum, term) => sum + (title.includes(term) ? 20 : 0) + (headings.includes(term) ? 10 : 0) + (keywords.includes(term) ? 5 : 0) + (description.includes(term) ? 3 : 0), 0);
    return { page, score, matches: terms.every((term) => content.includes(term)) };
  }).filter((item) => item.matches).sort((a, b) => b.score - a.score).map((item) => item.page);
}

export function documentationSnippet(page, query) {
  const terms = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return page.description;
  if (terms.some((term) => page.description.toLowerCase().includes(term))) return page.description;
  const text = String(page.text || '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|?[\s:|-]+\|\s*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/```[^\n]*\n|```/g, '')
    .replace(/`/g, '')
    .replace(/\|/g, ' · ')
    .replace(/\s+/g, ' ');
  const positions = terms.map((term) => text.toLowerCase().indexOf(term)).filter((index) => index >= 0);
  if (!positions.length) return page.description;
  const start = Math.max(0, Math.min(...positions) - 65);
  const end = Math.min(text.length, start + 230);
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export function developerDocsURL(slug = '', search = '') {
  const query = new URLSearchParams(search);
  const context = new URLSearchParams();
  if (query.get('cloudId')) context.set('cloudId', query.get('cloudId'));
  return `/console/developer-docs${slug ? `/${slug}` : ''}${context.size ? `?${context}` : ''}`;
}
