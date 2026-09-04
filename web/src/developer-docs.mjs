export function searchDeveloperDocs(pages, query) {
  const terms = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  return pages.filter((page) => {
    const content = `${page.title} ${page.description} ${page.keywords.join(' ')} ${page.text}`.toLowerCase();
    return terms.every((term) => content.includes(term));
  });
}

export function developerDocsURL(slug = '', search = '') {
  const query = new URLSearchParams(search);
  const context = new URLSearchParams();
  if (query.get('cloudId')) context.set('cloudId', query.get('cloudId'));
  return `/console/developer-docs${slug ? `/${slug}` : ''}${context.size ? `?${context}` : ''}`;
}
