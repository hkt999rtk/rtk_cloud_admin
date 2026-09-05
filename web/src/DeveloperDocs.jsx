import React, { useEffect, useRef, useState } from 'react';
import { developerDocsURL, searchDeveloperDocs, documentationSnippet } from './developer-docs.mjs';
import './developer-docs.css';
import './developer-docs-ui.css';

const categoryIcons = { 'Start here': 'compass', Tutorials: 'play', Concepts: 'diagram-project', 'Build integrations': 'code', 'Operate and troubleshoot': 'wrench', Reference: 'book-open' };
const topicIcons = { authentication: 'shield-halved', 'credential-setup': 'key', 'credential-recovery': 'key', 'mqtt-topics': 'route', 'mqtt-connection': 'network-wired', 'mqtt-quickstart': 'network-wired', 'shadow-concepts': 'arrows-rotate', 'shadow-quickstart': 'arrows-rotate', 'shadow-interfaces': 'arrows-rotate', 'shadow-reference': 'arrows-rotate', debugging: 'bug', 'integration-test-kit': 'flask', 'api-examples': 'code', 'device-presence': 'signal', 'ownership-sharing': 'users' };
function DocsIcon({ name }) { return <i className={`fa-solid fa-${name}`} aria-hidden="true" />; }

// Keep copy-status updates from replacing the generated HTML and its copy controls.
const DocumentationBody = React.memo(function DocumentationBody({ html, bodyRef }) {
  return <div ref={bodyRef} className="docs-body" dangerouslySetInnerHTML={{ __html: html }} />;
});

function SearchHighlight({ text, query }) {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return text;
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text.split(pattern).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part);
}

export function DeveloperDocs() {
  const [category, setCategory] = useState('');
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const contentRef = useRef(null);
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') || '');
  const slug = window.location.pathname.replace(/^\/console\/developer-docs\/?/, '').replace(/\/$/, '');
  const page = catalog?.pages.find((item) => item.slug === slug);
  const browsing = !slug || Boolean(query);
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
  useEffect(() => {
    setCopyStatus('');
    if (!page || browsing || !contentRef.current) return undefined;
    let active = true;
    const removers = [...contentRef.current.querySelectorAll('pre')].map((block, index) => {
      const code = block.querySelector('code') || block;
      const text = code.textContent;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'docs-copy-code';
      button.textContent = 'Copy';
      button.setAttribute('aria-label', `Copy code example ${index + 1}`);
      const copy = async () => {
        button.disabled = true;
        button.textContent = 'Copying…';
        try {
          if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(text);
          if (active) {
            button.textContent = 'Copied';
            button.removeAttribute('title');
            setCopyStatus(`Code example ${index + 1} copied.`);
          }
        } catch {
          if (active) {
            button.textContent = 'Copy unavailable';
            button.title = 'Select the code and copy it manually.';
            setCopyStatus(`Could not copy code example ${index + 1}. Select the code and copy it manually.`);
          }
        } finally {
          if (active) button.disabled = false;
        }
      };
      button.addEventListener('click', copy);
      block.classList.add('docs-copyable');
      block.append(button);
      return () => {
        button.removeEventListener('click', copy);
        button.remove();
        block.classList.remove('docs-copyable');
      };
    });
    return () => { active = false; removers.forEach((remove) => remove()); };
  }, [page, browsing]);
  function keepCloudContext(event) {
    const link = event.target.closest('a');
    if (!link || !link.pathname.startsWith('/console/')) return;
    const context = new URLSearchParams(window.location.search).get('cloudId');
    if (context) { const next = new URL(link.href); next.searchParams.set('cloudId', context); link.href = next.href; }
  }
  if (error) return <section className="panel" role="alert">{error}</section>;
  if (!catalog) return <section className="panel" role="status">Loading documentation…</section>;
  const matches = searchDeveloperDocs(catalog.pages, query);
  const results = matches.filter((item) => !category || item.category === category);
  const groups = [...new Set(catalog.pages.map((item) => item.category))];
  const resultGroups = query.trim() ? [{ title: 'Search results · most relevant first', items: results }] : groups.map((group) => ({ title: group, items: results.filter((item) => item.category === group) }));
  function updateQuery(value) {
    setQuery(value);
    const next = new URL(window.location.href);
    if (value) next.searchParams.set('q', value); else next.searchParams.delete('q');
    window.history.replaceState(window.history.state, '', next);
  }
  return <section className="developer-docs" lang="en">
    {browsing ? <><p className="docs-intro">Build with MQTT and Device Shadow. <a href={href('documentation-map')}><DocsIcon name="compass" /> Find your learning path</a></p>
    <label className="docs-mobile-chapters">Choose a chapter<select value={page?.slug || ''} onChange={(event) => window.location.assign(href(event.target.value))}><option value="">All documentation</option>{groups.map((group) => <optgroup key={group} label={group}>{catalog.pages.filter((item) => item.category === group).map((item) => <option key={item.slug} value={item.slug}>{item.title}</option>)}</optgroup>)}</select></label></> : <nav className="docs-breadcrumb" aria-label="Documentation navigation"><a href={href()}><DocsIcon name="arrow-left" /> Back to documents</a>{page ? <label className="docs-jump">On this page<select aria-label="Jump to section" defaultValue="" onChange={(event) => { window.location.hash = event.target.value; }}><option value="" disabled>Jump to section…</option>{page.headings.filter((heading) => heading.depth === 2).map((heading) => <option key={heading.anchor} value={heading.anchor}>{heading.title}</option>)}</select></label> : null}</nav>}
    <div className={`docs-layout ${browsing ? 'docs-browse' : 'docs-detail'}`}>
      {browsing ? <nav className="docs-categories" aria-label="Documentation categories">
        <h2>Browse documentation</h2>
        <button type="button" aria-pressed={!category} onClick={() => setCategory('')}><DocsIcon name="layer-group" /><span>All documents</span><small>{matches.length}</small></button>
        {groups.map((group) => <button type="button" key={group} aria-pressed={category === group} onClick={() => setCategory(group)}><DocsIcon name={categoryIcons[group]} /><span>{group}</span><small>{matches.filter((item) => item.category === group).length}</small></button>)}
      </nav> : null}
      <div className="docs-reading">
        {browsing ? <form className="docs-search panel" action="/console/developer-docs" role="search" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="docs-query"><DocsIcon name="magnifying-glass" /> Search documentation</label>
          <div><input id="docs-query" name="q" type="search" maxLength={200} value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="Search topics, API paths, errors…" />
          {new URLSearchParams(window.location.search).get('cloudId') ? <input type="hidden" name="cloudId" value={new URLSearchParams(window.location.search).get('cloudId')} /> : null}
          <button className="primary-button" type="submit">Search</button></div>
        </form> : null}
        {!slug || query ? <div className="docs-results" aria-label="Documentation results">
          <p role="status">{results.length} {results.length === 1 ? 'document' : 'documents'}{query ? ` matching “${query}”` : ''}</p>
          {!results.length ? <p className="panel">No matching documents. Try MQTT, desired, certificate, or version.</p> : null}
          {resultGroups.filter((group) => group.items.length).map((group) => <section className="docs-result-section" key={group.title}>
            <h2 className="docs-result-group"><DocsIcon name={query.trim() ? 'magnifying-glass' : categoryIcons[group.title]} />{group.title}<span>{group.items.length}</span></h2>
            <div className="docs-result-list">{group.items.map((item) => <article className="docs-result" key={item.slug}>
              <span className="docs-topic-icon"><DocsIcon name={topicIcons[item.slug] || categoryIcons[item.category]} /></span>
              <div>{query.trim() ? <small className="docs-match-category">{item.category}</small> : null}<h3><a href={href(item.slug)}><SearchHighlight text={item.title} query={query} /></a></h3><p><SearchHighlight text={documentationSnippet(item, query)} query={query} /></p></div>
              <DocsIcon name="chevron-right" />
            </article>)}</div>
          </section>)}
        </div> : page ? <article className="panel docs-article" onClick={keepCloudContext}>
          <header><p className="docs-category"><DocsIcon name={categoryIcons[page.category]} /> {page.category}</p><h2>{page.title}</h2><p>{page.description}</p><small>Last verified: {String(page.last_verified)} · {page.verification}</small>
          <details><summary>Applicable versions</summary><pre>{typeof page.applies_to === 'string' ? page.applies_to : JSON.stringify(page.applies_to, null, 2)}</pre></details></header>
          <details className="docs-toc"><summary>On this page</summary>{page.headings.filter((heading) => heading.depth === 2).map((heading) => <a href={`#${heading.anchor}`} key={heading.anchor}>{heading.title}</a>)}</details>
          {/* HTML is generated at build time from the curated source; raw HTML is rejected by the publisher. */}
          <p className="docs-copy-status" role="status" aria-live="polite" aria-atomic="true">{copyStatus}</p>
          <DocumentationBody bodyRef={contentRef} html={page.html} />
        </article> : <div className="panel"><h2>Document not found</h2><a href={href()}>Browse all documentation</a></div>}
      </div>
      {!browsing && page?.headings.some((heading) => heading.depth === 2) ? <nav className="docs-section-nav" aria-label="Article sections"><h2>On this page</h2>{page.headings.filter((heading) => heading.depth === 2).map((heading) => <a href={`#${heading.anchor}`} key={heading.anchor}>{heading.title}</a>)}</nav> : null}
    </div>
  </section>;
}
