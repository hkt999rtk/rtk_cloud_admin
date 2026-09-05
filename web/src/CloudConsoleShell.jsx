import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cloudConsolePath, cloudRouteForSwitch, cloudShellNavGroups, titleFor } from './routes.mjs';
import { displayLabel } from './ConsoleUI.jsx';

function icon(name) {
  return <i className={`fa-solid fa-${name}`} aria-hidden="true" />;
}

function initials(email = '') {
  return email.split('@')[0].split(/[._-]/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'DM';
}

function cloudOptions(me, clouds, selectedCloud) {
  const items = [...(me?.memberships || []), ...(Array.isArray(clouds) ? clouds : []), ...(selectedCloud ? [selectedCloud] : [])];
  const byID = new Map();
  items.forEach((item) => {
    const id = item.id || item.organization_id;
    if (id) byID.set(id, { ...item, id, name: item.name || item.organization || id });
  });
  return [...byID.values()];
}

export function CloudConsoleShell({ me, cloud = null, clouds = [], active = 'my-clouds', title = '', children, onError = () => {}, navGroups, onNavigate, navigationPath, onSwitchCloud, onLogout, onSwitchView }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef(null);
  const menuRef = useRef(null);
  const options = useMemo(() => cloudOptions(me, clouds, cloud), [cloud, clouds, me]);
  const isPlatform = me?.kind === 'platform_admin';
  const cloudId = !isPlatform ? cloud?.id || '' : '';
  const capabilities = cloud?.capabilities || [];
  const isOwner = cloud?.my_role === 'owner' && (!me?.user_id || !cloud?.owner_user_id || cloud.owner_user_id === me.user_id);
  const showOwnerOnly = options.some((item) => (item.my_role || item.role) === 'owner' && (!me?.user_id || !item.owner_user_id || item.owner_user_id === me.user_id));
  const groups = (navGroups || cloudShellNavGroups(cloudId, capabilities, { isOwner, showOwnerOnly }))
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.disabled) })).filter((group) => group.items.length);
  const pageTitle = title || titleFor(active) || 'Brand Cloud';

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const focusable = () => [...(drawerRef.current?.querySelectorAll('button, select, a[href], [tabindex]:not([tabindex="-1"])') || [])]
      .filter((element) => !element.disabled && element.getAttribute('aria-hidden') !== 'true');
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    focusable()[0]?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKeyDown);
      menuRef.current?.focus();
    };
  }, [mobileOpen]);

  async function accountAction(view = '') {
    try {
      const response = await fetch(view ? '/api/me/view' : '/api/auth/logout', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(view ? { view } : {}),
      });
      if (!response.ok) throw new Error(view ? 'View switch failed.' : 'Logout failed.');
      window.location.assign(view === 'platform' ? '/admin' : view === 'customer' ? '/console/clouds' : '/login');
    } catch (error) {
      onError(error.message || 'Account action failed.');
    }
  }

  return <div className={`app-shell cloud-console-shell ${isPlatform ? 'platform-console-shell' : 'enterprise-console'}`}>
    <a className="skip-link" href="#console-content">Skip to content</a>
    <header className="mobile-appbar">
      <button ref={menuRef} type="button" className="mobile-menu-button" aria-label="Open navigation" aria-controls="primary-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>{icon('bars')}</button>
      <h1>{pageTitle}</h1><span className="mobile-appbar-mark" aria-hidden="true">C+</span>
    </header>
    <button type="button" className={`mobile-nav-overlay ${mobileOpen ? 'open' : ''}`} aria-label="Close navigation" tabIndex={mobileOpen ? 0 : -1} onClick={() => setMobileOpen(false)} />
    <aside id="primary-navigation" ref={drawerRef} className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`} aria-label="Primary navigation">
      <div className="brand"><a href={isPlatform ? "/admin" : "/console/clouds"} aria-label="Realtek Connect+ home"><img src="/assets/realtek-logo.png" alt="Realtek" /><strong>Connect+</strong></a><button type="button" className="mobile-nav-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>{icon('xmark')}</button></div>
      <nav className="sidebar-nav-groups">
        {groups.map((group) => <section className="sidebar-nav-group" key={group.id}>
          <p className="sidebar-section-label">{group.labelKey}</p>
          {group.items.map((item) => item.disabled
            ? <span key={item.id} className="sidebar-disabled" aria-disabled="true" title="Select a Brand Cloud to use this feature">{icon(item.icon)}{item.labelKey}</span>
            : <a key={item.id} className={item.id === active ? 'active' : ''} aria-current={item.id === active ? 'page' : undefined} href={navigationPath ? navigationPath(item) : cloudConsolePath(cloudId, item.id)} onClick={(event) => { setMobileOpen(false); if (onNavigate) { event.preventDefault(); onNavigate(item); } }}>{icon(item.icon)}{item.labelKey}</a>)}
        </section>)}
      </nav>
      {!cloudId && !navGroups && <p className="ui-nav-hint">Select a cloud to manage products, devices and team access.</p>}
      <div className="sidebar-account"><span className="avatar">{initials(me?.email)}</span><div><strong>{isPlatform ? 'Platform admin' : displayLabel(cloud?.my_role || 'developer')}</strong><small>{me?.email || 'Loading account…'}</small></div></div>
    </aside>
    <main id="console-content" tabIndex={-1}>
      <header className="topbar"><div className="topbar-title">{cloudId ? <nav className="ui-breadcrumb" aria-label="Breadcrumb"><a href="/console/clouds">My Clouds</a><span>/</span><a href={cloudConsolePath(cloudId)}>{cloud.name}</a></nav> : null}<h1>{pageTitle}</h1></div><div className="topbar-controls">
        {isPlatform && <span className="topbar-context-badge">Platform Admin</span>}
        {/video-cloud-(dev|staging)/.test(window.location.hostname) && <span className="ui-environment">{window.location.hostname.includes('-dev') ? 'Development' : 'Staging'}</span>}
        {!isPlatform && options.length ? <select className="org-switcher" value={cloudId} aria-label="Brand Cloud" onChange={(event) => onSwitchCloud ? onSwitchCloud(event.target.value) : window.location.assign(cloudRouteForSwitch(options.find((item) => item.id === event.target.value), active, me?.user_id))}><option value="" disabled>Select a cloud</option>{options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : null}
        {me?.authenticated ? <details className="ui-account-menu"><summary aria-label="Account menu">{icon('circle-user')}<span>Account</span></summary><div><strong>{me.email}</strong>
        {me.kind === 'customer' && (me.platform_capabilities?.length ?? 0) > 0 ? <button type="button" onClick={() => onSwitchView ? onSwitchView('platform') : accountAction('platform')}>Platform view</button> : null}
        {me.kind === 'platform_admin' ? <button type="button" onClick={() => onSwitchView ? onSwitchView('customer') : accountAction('customer')}>Brand Cloud view</button> : null}
        <button type="button" onClick={() => onLogout ? onLogout() : accountAction()}>{icon('right-from-bracket')}Logout</button></div></details> : null}
      </div></header>
      {children}
    </main>
  </div>;
}
