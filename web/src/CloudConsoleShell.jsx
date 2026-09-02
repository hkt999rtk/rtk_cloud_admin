import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cloudConsolePath, cloudNavGroupsForCapabilities, cloudRouteForSwitch, titleFor } from './routes.mjs';

function icon(name) {
  return <i className={`fa-solid fa-${name}`} aria-hidden="true" />;
}

function initials(email = '') {
  return email.split('@')[0].split(/[._-]/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'DM';
}

function cloudOptions(me, clouds) {
  const items = Array.isArray(clouds) && clouds.length ? clouds : me?.memberships || [];
  const seen = new Set();
  return items.flatMap((item) => {
    const id = item.id || item.organization_id;
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ ...item, id, name: item.name || item.organization || id }];
  });
}

export function CloudConsoleShell({ me, cloud = null, clouds = [], active = 'my-clouds', title = '', children, onError = () => {} }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef(null);
  const menuRef = useRef(null);
  const options = useMemo(() => cloudOptions(me, clouds), [clouds, me]);
  const cloudId = cloud?.id || '';
  const capabilities = cloud?.capabilities || [];
  const isOwner = cloud?.my_role === 'owner' && (!me?.user_id || !cloud?.owner_user_id || cloud.owner_user_id === me.user_id);
  const groups = cloudNavGroupsForCapabilities(cloudId, capabilities, { isOwner });
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

  return <div className="app-shell cloud-console-shell">
    <header className="mobile-appbar">
      <button ref={menuRef} type="button" className="mobile-menu-button" aria-label="Open navigation" aria-controls="primary-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>{icon('bars')}</button>
      <h1>{pageTitle}</h1><span className="mobile-appbar-mark" aria-hidden="true">C+</span>
    </header>
    <button type="button" className={`mobile-nav-overlay ${mobileOpen ? 'open' : ''}`} aria-label="Close navigation" tabIndex={mobileOpen ? 0 : -1} onClick={() => setMobileOpen(false)} />
    <aside id="primary-navigation" ref={drawerRef} className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`} aria-label="Primary navigation">
      <div className="brand"><span className="brand-mark" aria-hidden="true">C+</span><strong>Connect+</strong><button type="button" className="mobile-nav-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>{icon('xmark')}</button></div>
      <nav className="sidebar-nav-groups">
        {groups.map((group) => <section className="sidebar-nav-group" key={group.id}>
          <p className="sidebar-section-label">{group.labelKey}</p>
          {group.items.map((item) => <a key={item.id} className={item.id === active ? 'active' : ''} aria-current={item.id === active ? 'page' : undefined} href={cloudConsolePath(cloudId, item.id)} onClick={() => setMobileOpen(false)}>{icon(item.icon)}{item.labelKey}</a>)}
        </section>)}
      </nav>
      <div className="sidebar-account"><span className="avatar">{initials(me?.email)}</span><div><strong>{cloud?.my_role || 'Developer'}</strong><small>{me?.email || 'Loading account'}</small></div>{me?.authenticated ? <button type="button" className="sidebar-logout" onClick={() => accountAction()}>{icon('right-from-bracket')}Logout</button> : null}</div>
    </aside>
    <main>
      <header className="topbar"><div className="topbar-title"><h1>{pageTitle}</h1></div><div className="topbar-controls">
        {cloudId && options.length > 1 ? <select className="org-switcher" value={cloudId} aria-label="Brand Cloud" onChange={(event) => window.location.assign(cloudRouteForSwitch(options.find((item) => item.id === event.target.value), active, me?.user_id))}>{options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : null}
        {me?.authenticated && me?.kind === 'customer' && (me?.platform_capabilities?.length ?? 0) > 0 ? <button type="button" className="ghost-button view-switch-button" onClick={() => accountAction('platform')}>Platform view</button> : null}
        {me?.authenticated && me?.kind === 'platform_admin' ? <button type="button" className="ghost-button view-switch-button" onClick={() => accountAction('customer')}>Brand Cloud view</button> : null}
        {me?.authenticated ? <button type="button" className="ghost-button icon-text-button" onClick={() => accountAction()}>{icon('right-from-bracket')}Logout</button> : null}
      </div></header>
      {children}
    </main>
  </div>;
}
