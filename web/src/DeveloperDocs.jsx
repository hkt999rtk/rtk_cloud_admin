import React, { useEffect, useState } from 'react';
import { developerDocsURL, searchDeveloperDocs } from './developer-docs.mjs';
import './developer-docs.css';

export function DeveloperDocs() {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') || '');
  const slug = window.location.pathname.replace(/^\/console\/developer-docs\/?/, '').replace(/\/$/, '');
  const page = catalog?.pages.find((item) => item.slug === slug);
  const href = (value = '') => developerDocsURL(value, window.location.search);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/assets/developer-docs/index.en.json', { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Documents are temporarily unavailable. Please reload the page.'); return response.json(); })
      .then(setCatalog).catch((err) => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!page) return;
    document.title = `${page.title} · Developer Docs`;
    if (window.location.hash) document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView();
  }, [page]);
  function keepCloudContext(event) {
    const link = event.target.closest('a');
    if (!link || !link.pathname.startsWith('/console/')) return;
    const context = new URLSearchParams(window.location.search).get('cloudId');
    if (context) { const next = new URL(link.href); next.searchParams.set('cloudId', context); link.href = next.href; }
  }
  if (error) return <section className="panel" role="alert">{error}</section>;
  if (!catalog) return <section className="panel" role="status">Loading documentation…</section>;
  const results = searchDeveloperDocs(catalog.pages, query);
  return <section className="developer-docs" lang="en">
    <p className="docs-intro">Build with MQTT and Device Shadow. Follow a quickstart, explore the protocol reference, or search the documentation.</p>
    <label className="docs-mobile-chapters">Choose a chapter<select value={page?.slug || ''} onChange={(event) => window.location.assign(href(event.target.value))}><option value="">All documentation</option>{catalog.pages.map((item) => <option key={item.slug} value={item.slug}>{item.title}</option>)}</select></label>
    <div className="docs-layout">
      <nav className="docs-chapters panel" aria-label="Documentation chapters">
        <a className="docs-home" href={href()}>All documentation</a>
        {catalog.pages.map((item) => <a key={item.slug} href={href(item.slug)} aria-current={page?.slug === item.slug ? 'page' : undefined}>{item.title}</a>)}
      </nav>
      <div className="docs-reading">
        <form className="docs-search panel" action="/console/developer-docs" role="search">
          <label htmlFor="docs-query">Search documentation</label>
          <div><input id="docs-query" name="q" type="search" maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search topics, API paths, errors…" />
          {new URLSearchParams(window.location.search).get('cloudId') ? <input type="hidden" name="cloudId" value={new URLSearchParams(window.location.search).get('cloudId')} /> : null}
          <button className="primary-button" type="submit">Search</button></div>
        </form>
        {!slug || query ? <div className="docs-results" aria-label="Documentation results">
          <p role="status">{results.length} {results.length === 1 ? 'document' : 'documents'}{query ? ` matching “${query}”` : ''}</p>
          {!results.length ? <p className="panel">No matching documents. Try MQTT, desired, certificate, or version.</p> : null}
          {results.map((item) => <article className="panel docs-result" key={item.slug}><small>{item.category}</small><h2><a href={href(item.slug)}>{item.title}</a></h2><p>{item.description}</p></article>)}
        </div> : page ? <article className="panel docs-article" onClick={keepCloudContext}>
          <header><p className="docs-category">{page.category}</p><h2>{page.title}</h2><p>{page.description}</p><small>Last verified: {String(page.last_verified)} · {page.verification}</small>
          <details><summary>Applicable versions</summary><pre>{typeof page.applies_to === 'string' ? page.applies_to : JSON.stringify(page.applies_to, null, 2)}</pre></details></header>
          <details className="docs-toc"><summary>On this page</summary>{page.headings.filter((heading) => heading.depth === 2).map((heading) => <a href={`#${heading.anchor}`} key={heading.anchor}>{heading.title}</a>)}</details>
          {/* HTML is generated at build time from the curated source; raw HTML is rejected by the publisher. */}
          <div className="docs-body" dangerouslySetInnerHTML={{ __html: page.html }} />
        </article> : <div className="panel"><h2>Document not found</h2><a href={href()}>Browse all documentation</a></div>}
      </div>
    </div>
  </section>;
}
