import { translate } from './i18n/index.mjs';
import React, { useEffect, useMemo, useState } from 'react';
import './support-tickets.css';
const maximumFiles = 5;
const maximumFileSize = 10 * 1024 * 1024;
const maximumRequestSize = 25 * 1024 * 1024;
function supportBase(cloudId, platform) {
  return platform ? '/api/admin/support/tickets' : `/api/developer/brand-clouds/${encodeURIComponent(cloudId)}/support/tickets`;
}
function supportPath(cloudId, platform) {
  return platform ? '/admin/support' : `/console/clouds/${encodeURIComponent(cloudId)}/support`;
}
function selectedTicketId(pathname) {
  return pathname.match(/\/support\/([1-9][0-9]*)\/?$/)?.[1] || '';
}
function requestError(response) {
  if (response.status === 401) return translate('Your session has expired. Sign in again.');
  if (response.status === 403) return translate('You no longer have access to this ticket.');
  if (response.status === 404) return translate('This ticket is unavailable in this Cloud.');
  if (response.status === 413) return translate('The upload exceeds the size limit.');
  if (response.status >= 500) return translate('Support service is temporarily unavailable. Your draft is still here.');
  return translate('Check the fields and try again.');
}
async function requestJSON(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options
  });
  if (!response.ok) throw new Error(requestError(response));
  return response.json();
}
function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function validateFiles(files) {
  const selected = Array.from(files || []);
  if (selected.length > maximumFiles) return translate('Attach up to 5 files.');
  if (selected.some(file => file.size > maximumFileSize)) return translate('Each file must be 10 MiB or smaller.');
  if (selected.reduce((total, file) => total + file.size, 0) > maximumRequestSize) return translate('The combined upload must be 25 MiB or smaller.');
  return '';
}
function SupportComposer({
  kind,
  platform,
  ticket,
  onSubmitted,
  canWrite
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('incident');
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = supportBase(ticket?.cloud_id || '', platform);
  if (!canWrite) return <p className="support-readonly">{translate("Replies require a Cloud editing membership.")}</p>;
  async function submit(event) {
    event.preventDefault();
    const problem = validateFiles(files);
    if (problem) {
      setError(problem);
      return;
    }
    if (!body.trim() || body.length > 20000) {
      setError(translate('Enter a message of at most 20,000 characters.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = new FormData();
      if (kind === 'new') {
        data.set('title', title.trim());
        data.set('category', category);
      }
      data.set('body', body.trim());
      if (platform) data.set('visibility', visibility);
      files.forEach(file => data.append('attachments', file));
      const path = kind === 'new' ? base : `${base}/${ticket.id}/articles`;
      const result = await requestJSON(path, {
        method: 'POST',
        body: data
      });
      setBody('');
      setFiles([]);
      setTitle('');
      onSubmitted(result);
    } catch (cause) {
      setError(cause.message || translate('The request failed. Refresh this ticket before retrying.'));
    } finally {
      setBusy(false);
    }
  }
  return <form className="support-composer panel" onSubmit={submit}>
    <div className="panel-head"><div><h3>{kind === 'new' ? translate('New support ticket') : translate('Reply to ticket')}</h3><p>{translate("Technical or service support for this Brand Cloud.")}</p></div></div>
    {kind === 'new' ? <>
      <label>{translate("Subject")}<input required minLength={3} maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>{translate("Category")}<select value={category} onChange={event => setCategory(event.target.value)}><option value="incident">{translate("Incident")}</option><option value="integration">{translate("Integration")}</option><option value="usage">{translate("Usage")}</option></select></label>
    </> : null}
    {platform ? <fieldset className="support-visibility"><legend>{translate("Visibility")}</legend>
      <label><input type="radio" name="visibility" value="public" checked={visibility === 'public'} onChange={() => setVisibility('public')} />{translate(" Public reply")}</label>
      <label><input type="radio" name="visibility" value="internal" checked={visibility === 'internal'} onChange={() => setVisibility('internal')} />{translate(" Internal note")}</label>
      <strong>{visibility === 'internal' ? translate('Staff only — Cloud members cannot see this note.') : translate('Visible to all members of the Cloud.')}</strong>
    </fieldset> : null}
    <label>{translate("Message")}<textarea required maxLength={20000} rows={6} value={body} onChange={event => setBody(event.target.value)} /></label>
    <label>{translate("Attachments")}<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" onChange={event => setFiles(Array.from(event.target.files || []))} /><small>{translate("Up to 5 files, 10 MiB each; 25 MiB total.")}</small></label>
    {ticket?.state === 'closed' && !platform ? <p>{translate("Sending a reply will reopen this ticket.")}</p> : null}
    {error ? <p role="alert" className="error">{error}</p> : null}
    <div className="support-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? translate('Sending…') : kind === 'new' ? translate('Create ticket') : visibility === 'internal' ? translate('Add internal note') : translate('Send reply')}</button></div>
  </form>;
}
export function SupportTickets({
  cloudId = '',
  platform = false,
  capabilities = []
}) {
  const path = supportPath(cloudId, platform);
  const base = supportBase(cloudId, platform);
  const [ticketId, setTicketId] = useState(() => selectedTicketId(window.location.pathname));
  const [creating, setCreating] = useState(() => window.location.pathname.endsWith('/support/new'));
  const [items, setItems] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const initial = useMemo(() => new URLSearchParams(window.location.search), []);
  const [query, setQuery] = useState(initial.get('q') || '');
  const [state, setState] = useState(initial.get('state') || '');
  const [queue, setQueue] = useState(initial.get('queue') || 'unassigned');
  const [page, setPage] = useState(Number(initial.get('page')) || 1);
  const [hasMore, setHasMore] = useState(false);
  const [agentQuery, setAgentQuery] = useState('');
  const [agents, setAgents] = useState([]);
  const [assigneeId, setAssigneeId] = useState('');
  const canWrite = capabilities.includes(platform ? 'ticket.support.reply' : 'ticket.write');
  async function searchAgents() {
    try {
      const result = await requestJSON(`/api/admin/support/agents?q=${encodeURIComponent(agentQuery.trim())}`);
      setAgents(result.items || []);
    } catch (cause) {
      setError(cause.message || translate('Agent search is unavailable.'));
    }
  }
  useEffect(() => {
    const onPop = () => {
      setTicketId(selectedTicketId(window.location.pathname));
      setCreating(window.location.pathname.endsWith('/support/new'));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (ticketId || creating) return;
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (state) params.set('state', state);
    if (platform) params.set('queue', queue);
    if (page > 1) params.set('page', String(page));
    window.history.replaceState({}, '', `${path}${params.size ? `?${params}` : ''}`);
  }, [path, query, state, queue, page, ticketId, creating, platform]);
  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        if (ticketId) {
          const result = await requestJSON(`${base}/${ticketId}`);
          if (!alive) return;
          setDetail(result);
          await requestJSON(`${base}/${ticketId}/seen`, {
            method: 'POST'
          });
        } else if (!creating) {
          const params = new URLSearchParams({
            page: String(page),
            per_page: '30'
          });
          if (query) params.set('q', query);
          if (state) params.set('state', state);
          if (platform) params.set('queue', queue);
          const result = await requestJSON(`${base}?${params}`);
          if (!alive) return;
          setItems(result.items || []);
          setHasMore(Boolean(result.has_more));
        }
      } catch (cause) {
        if (alive) setError(cause.message || translate('Support service unavailable.'));
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [base, ticketId, creating, query, state, queue, page, platform, refresh]);
  function navigate(suffix = '') {
    window.history.pushState({}, '', `${path}${suffix}`);
    setTicketId(suffix.match(/^\/([1-9][0-9]*)$/)?.[1] || '');
    setCreating(suffix === '/new');
    setDetail(null);
    setError('');
  }
  async function patch(update) {
    if (!detail || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await requestJSON(`${base}/${detail.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(update)
      });
      setDetail(result);
    } catch (cause) {
      setError(cause.message || translate('Update failed.'));
    } finally {
      setBusy(false);
    }
  }
  return <section className="support-page">
    <div className="page-intro"><div><p className="eyebrow">{platform ? translate('Platform support queue') : translate('Brand Cloud support')}</p><h2>{translate("Support")}</h2><p>{platform ? translate('Inspect and respond to tickets across Clouds.') : translate('All members of this Cloud can see its support conversations.')}</p></div>
      <div className="page-intro-actions">{ticketId || creating ? <button className="ghost-button" onClick={() => navigate()}>{translate("Back to tickets")}</button> : <button className="ghost-button" onClick={() => setRefresh(value => value + 1)}>{translate("Refresh")}</button>}{!platform && canWrite && !creating && !ticketId ? <button className="primary-button" onClick={() => navigate('/new')}>{translate("New ticket")}</button> : null}</div>
    </div>
    {error ? <div className="panel" role="alert"><p className="error">{error}</p><button className="ghost-button" onClick={() => setRefresh(value => value + 1)}>{translate("Try again")}</button></div> : null}
    {creating ? <SupportComposer kind="new" platform={false} ticket={{
      cloud_id: cloudId
    }} canWrite={canWrite} onSubmitted={result => {
      navigate(`/${result.id}`);
      setDetail(result);
    }} /> : null}
    {ticketId ? <>
      {loading && !detail ? <p className="empty-state">{translate("Loading conversation…")}</p> : null}
      {detail ? <>
        <section className="panel support-detail-head"><div><p className="eyebrow">{translate("Ticket #")}{detail.number || detail.id}</p><h3>{detail.title}</h3><p>{translate(detail.category || 'Support')} · {translate(detail.state || 'Open')}{translate(" · Updated ")}{formatTime(detail.updated_at)}</p>{platform ? <p>{translate("Cloud: ")}{detail.cloud_id}</p> : null}</div>
          {platform ? <div className="support-actions">{!detail.assignee_id && capabilities.includes('ticket.support.assign') ? <button className="ghost-button" disabled={busy} onClick={() => patch({
              owner_id: 0
            })}>{translate("Claim ticket")}</button> : null}<button className="ghost-button" disabled={busy || !capabilities.includes('ticket.support.reply')} onClick={() => patch({
              state: detail.state === 'closed' ? 'open' : 'closed'
            })}>{detail.state === 'closed' ? translate('Reopen') : translate('Close')}</button></div> : null}
        </section>
        {platform && capabilities.includes('ticket.support.reassign') ? <section className="panel support-assignment"><h3>{translate("Assign ticket")}</h3><div className="support-actions"><input value={agentQuery} onChange={event => setAgentQuery(event.target.value)} placeholder={translate("Search support agent")} aria-label={translate("Search support agent")} /><button className="ghost-button" type="button" onClick={searchAgents}>{translate("Search")}</button><select value={assigneeId} onChange={event => setAssigneeId(event.target.value)} aria-label={translate("Support agent")}><option value="">{translate("Select an agent")}</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name || agent.email}</option>)}</select><button className="ghost-button" type="button" disabled={!assigneeId || busy} onClick={() => patch({ owner_id: Number(assigneeId) })}>{translate("Assign")}</button></div></section> : null}
        <section className="support-conversation" aria-label={translate("Conversation")}>{(detail.articles || []).map(article => <article key={article.id} className={`panel support-message ${article.sender === 'Agent' ? 'support-agent-message' : ''}`}><div className="support-message-meta"><strong>{article.author || (article.sender === 'Agent' ? translate('Support') : translate('Cloud member'))}</strong><span>{article.visibility === 'internal' ? translate('Staff only note') : article.sender === 'Agent' ? translate('Support reply') : translate('Cloud message')}</span><time>{formatTime(article.created_at)}</time></div><p>{article.body}</p>{article.attachments?.length ? <div className="support-attachments">{article.attachments.map(file => <a key={file.id} href={file.url}>{file.filename || translate('Download attachment')}</a>)}</div> : null}</article>)}</section>
        <SupportComposer kind="reply" platform={platform} ticket={detail} canWrite={canWrite} onSubmitted={result => setDetail(result)} />
      </> : null}
    </> : null}
    {!ticketId && !creating ? <section className="panel support-list">
      <div className="support-filters"><label>{translate("Search")}<input value={query} placeholder={translate("Subject or ticket number")} onChange={event => {
            setQuery(event.target.value);
            setPage(1);
          }} /></label><label>{translate("State")}<select value={state} onChange={event => {
            setState(event.target.value);
            setPage(1);
          }}><option value="">{translate("All states")}</option><option value="new">{translate("New")}</option><option value="open">{translate("Open")}</option><option value="closed">{translate("Closed")}</option></select></label></div>
      {platform ? <div className="support-queues" role="group" aria-label={translate("Support queue")}>{[['unassigned', translate('Unassigned')], ['mine', translate('Mine')], ['team', translate('Team')]].map(([value, label]) => <button key={value} type="button" className={queue === value ? 'active' : ''} aria-pressed={queue === value} onClick={() => {
          setQueue(value);
          setPage(1);
        }}>{label}</button>)}</div> : null}
      {loading && !items.length ? <p className="empty-state">{translate("Loading tickets…")}</p> : null}
      {!loading && !items.length && !error ? <p className="empty-state">{translate("No tickets match this view.")}</p> : null}
      <div className="support-rows">{items.map(item => <button key={item.id} className="support-row" type="button" onClick={() => navigate(`/${item.id}`)}><span className="support-row-title">{item.unread ? <span className="support-unread" aria-label={translate("Unread")} /> : null}<strong>#{item.number} · {item.title}</strong><small>{translate(item.category || 'Support')} · {platform ? <>{translate("Cloud")} {item.cloud_id}</> : translate("Cloud ticket")}</small></span><span>{translate(item.state || 'Open')}</span><time>{formatTime(item.updated_at)}</time></button>)}</div>
      <div className="support-pagination"><button className="ghost-button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{translate("Previous")}</button><span>{translate("Page ")}{page}</span><button className="ghost-button" disabled={!hasMore} onClick={() => setPage(value => value + 1)}>{translate("Next")}</button></div>
    </section> : null}
  </section>;
}
