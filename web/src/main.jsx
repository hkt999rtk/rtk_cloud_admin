import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { customerNavItems, devicesPathWithFilters, platformNavItems, routeFromLocation, titleFor } from './routes.mjs';
import { postJSON, putJSON, startSSOLogin, userFacingSSOError } from './http.mjs';
import { shouldShowBreakGlass } from './auth-state.mjs';
import { deviceActionState, isReadOnlyRole } from './device-actions.mjs';
import { firmwareCampaignDetailRows, firmwareRiskRows, firmwareVersionFilterValue } from './firmware.mjs';
import { sourceAvailable, sourceMessage } from './source-state.mjs';
import './styles.css';

const DEFAULT_PAGE_SIZE = 8;

function App() {
  const [active, setActive] = useState(routeFromLocation());
  const [me, setMe] = useState(null);
  const [summary, setSummary] = useState(null);
  const [fleetHealth, setFleetHealth] = useState(null);
  const [streamStats, setStreamStats] = useState(null);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [operations, setOperations] = useState([]);
  const [health, setHealth] = useState([]);
  const [audit, setAudit] = useState([]);
  const [ssoProviders, setSSOProviders] = useState([]);
  const [firmwareDistribution, setFirmwareDistribution] = useState(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [deviceDrawerOpen, setDeviceDrawerOpen] = useState(false);
  const [overviewWindow, setOverviewWindow] = useState('7d');
  const [streamWindow, setStreamWindow] = useState('7d');
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const isPublicRoute = active === 'signup' || active === 'signup-check-email' || active === 'verify';
  const isPlatformView = active.startsWith('platform');
  const visibleNavItems = isPlatformView ? platformNavItems : customerNavItems;
  const needsPlatformAccess = isPlatformView && me?.kind !== 'platform_admin';
  const customerViewPending = !isPlatformView && !isPublicRoute && me === null;
  const customerViewBlocked = !isPlatformView && !isPublicRoute && me !== null && (me.authenticated === false || me.kind === 'platform_admin');
  const activeMembership = getActiveMembership(me);
  const activeOrgLabel = activeMembership?.organization || me?.active_org_id || 'Acme Smart Camera';
  const lastUpdatedAt = latestCustomerUpdate(devices, recentAlerts);

  useEffect(() => {
    if (isPublicRoute) {
      return;
    }
    let alive = true;
    async function loadData() {
      setError('');
      setLoading(true);
      try {
        const nextMe = await fetchJSON('/api/me');
        if (!alive) return;
        setMe(nextMe);

        const useAdminApi = isPlatformView && nextMe.kind === 'platform_admin';
        if (!isPlatformView && (!nextMe.authenticated || nextMe.kind === 'platform_admin')) {
          setSummary(null);
          setFleetHealth(null);
          setStreamStats(null);
          setRecentAlerts([]);
          setCustomers([]);
          setDevices([]);
          setOperations([]);
          setHealth([]);
          setAudit([]);
          setSSOProviders([]);
          setFirmwareDistribution(null);
          setLoading(false);
          return;
        }
        if (isPlatformView && nextMe.kind !== 'platform_admin') {
          setSummary(null);
          setFleetHealth(null);
          setStreamStats(null);
          setRecentAlerts([]);
          setCustomers([]);
          setDevices([]);
          setOperations([]);
          setHealth([]);
          setAudit([]);
          setSSOProviders([]);
          setLoading(false);
          return;
        }

        const prefix = useAdminApi ? '/api/admin' : '/api';
        const baseRequests = useAdminApi
          ? [
              fetchJSON(`${prefix}/summary`),
              fetchJSON(`${prefix}/customers`),
              fetchJSON(`${prefix}/devices`),
              fetchJSON(`${prefix}/operations`),
              fetchJSON(`${prefix}/service-health`),
              fetchJSON(`${prefix}/audit`),
            ]
          : [
              fetchJSON(`${prefix}/summary`),
              fetchJSON(`${prefix}/customers`),
              fetchJSON(`${prefix}/devices`),
              Promise.resolve([]),
              Promise.resolve([]),
              Promise.resolve([]),
            ];
        const [nextSummary, nextCustomers, nextDevices, nextOperations, nextHealth, nextAudit] = await Promise.all(baseRequests);
        if (!alive) return;
        setSummary(nextSummary);
        setCustomers(nextCustomers);
        setDevices(nextDevices);
        setOperations(nextOperations);
        setHealth(nextHealth);
        setAudit(nextAudit);
        if (useAdminApi && active === 'platform-sso') {
          const nextSSOProviders = await fetchJSON('/api/admin/sso/providers');
          if (!alive) return;
          setSSOProviders(nextSSOProviders.providers || []);
        } else {
          setSSOProviders([]);
        }
        if (active === 'firmware-ota' && nextMe.kind !== 'platform_admin') {
          const nextFirmwareDistribution = await fetchJSON('/api/fleet/firmware-distribution');
          if (!alive) return;
          setFirmwareDistribution(nextFirmwareDistribution);
        } else {
          setFirmwareDistribution(null);
        }

        if (nextMe.authenticated && nextMe.kind === 'customer' && !useAdminApi) {
          const streamWindowToUse = active === 'stream-health' ? streamWindow : overviewWindow;
          const [nextFleetHealth, nextStreamStats] = await Promise.all([
            fetchJSON(`/api/fleet/health-summary?window=${overviewWindow}`),
            fetchJSON(`/api/fleet/stream-stats?window=${streamWindowToUse}`),
          ]);
          if (!alive) return;
          setFleetHealth(nextFleetHealth);
          setStreamStats(nextStreamStats);
          if (active === 'overview') {
            const nextAlerts = await fetchRecentAlerts(nextDevices);
            if (!alive) return;
            setRecentAlerts(nextAlerts);
          } else {
            setRecentAlerts([]);
          }
        } else {
          setFleetHealth(null);
          setStreamStats(null);
          setRecentAlerts([]);
        }
      } catch (err) {
        if (!alive) return;
        if (err.isAuthError) {
          try {
            const freshMe = await fetch('/api/me').then((r) => r.json());
            if (alive) setMe(freshMe);
          } catch (_) {}
          setSummary(null);
          setCustomers([]);
          setDevices([]);
          setOperations([]);
          setHealth([]);
          setAudit([]);
          setSSOProviders([]);
          setFirmwareDistribution(null);
          setFleetHealth(null);
          setStreamStats(null);
          setRecentAlerts([]);
        }
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    loadData();
    return () => {
      alive = false;
    };
  }, [active, isPublicRoute, overviewWindow, refreshTick, streamWindow]);

  useEffect(() => {
    if (!isPublicRoute) return;
    setError('');
    setMe(null);
    setSummary(null);
    setCustomers([]);
    setDevices([]);
    setOperations([]);
    setHealth([]);
    setAudit([]);
    setSSOProviders([]);
    setFirmwareDistribution(null);
    setFleetHealth(null);
    setStreamStats(null);
    setRecentAlerts([]);
  }, [isPublicRoute]);

  useEffect(() => {
    const onPopState = () => {
      setActive(routeFromLocation());
      const deviceId = deviceIdFromLocation();
      setSelectedDeviceId(deviceId);
      setDeviceDrawerOpen(Boolean(deviceId));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const deviceId = deviceIdFromLocation();
    setSelectedDeviceId(deviceId);
    setDeviceDrawerOpen(Boolean(deviceId));
  }, [active]);

  function navigate(item) {
    window.history.pushState({}, '', item.path);
    setActive(item.id);
  }

  function switchView(targetActive) {
    const target = targetActive === 'platform' ? platformNavItems[0] : customerNavItems[0];
    navigate(target);
  }

  function selectDevice(deviceId) {
    setSelectedDeviceId(deviceId);
    setDeviceDrawerOpen(true);
    updateDevicesLocation({ deviceId });
    setActive('devices');
  }

  function filterDevicesByHealth(healthState) {
    updateDevicesLocation({ health: healthState, deviceId: '' });
    setActive('devices');
  }

  function closeDeviceDrawer() {
    setDeviceDrawerOpen(false);
    updateDevicesLocation({ deviceId: '' });
  }

  function openDevicesForFirmware(version) {
    setSelectedDeviceId('');
    setDeviceDrawerOpen(false);
    updateDevicesLocation({ deviceId: '', health: '', firmware: firmwareVersionFilterValue(version) });
    setActive('devices');
  }

  async function runDeviceAction(deviceId, action) {
    setError('');
    const response = await fetch(`/api/devices/${deviceId}/${action}`, { method: 'POST' });
    if (!response.ok) {
      setError(`${action} failed with ${response.status}`);
      return;
    }
    setRefreshTick((tick) => tick + 1);
    updateDevicesLocation({ deviceId });
    setActive('devices');
  }

  async function handleSSOProviderSave(orgID, config) {
    setError('');
    try {
      const result = await putJSON(`/api/admin/orgs/${encodeURIComponent(orgID)}/sso-provider`, config);
      setSSOProviders((providers) => upsertProvider(providers, result.provider));
    } catch (err) {
      setError(userFacingSSOError(err));
      throw err;
    }
  }

  async function handleSSOStart(email) {
    setError('');
    try {
      const result = await startSSOLogin(email, window.location.href);
      if (!result?.redirect_url) {
        setError('SSO start did not return a redirect URL');
        return;
      }
      window.location.assign(result.redirect_url);
    } catch (err) {
      setError(userFacingSSOError(err));
      throw err;
    }
  }

  async function handleBreakGlassLogin(credentials) {
    setError('');
    const response = await fetch('/api/auth/platform/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      setError(details || `break-glass login failed with ${response.status}`);
      return;
    }
    setRefreshTick((tick) => tick + 1);
  }

  async function handleSignup(payload) {
    setError('');
    try {
      const result = await postJSON('/api/auth/customer/signup', payload);
      window.history.pushState({}, '', `/signup/check-email?email=${encodeURIComponent(payload.email)}`);
      setActive('signup-check-email');
      setRefreshTick((tick) => tick + 1);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  async function handleVerify(token) {
    setError('');
    try {
      const result = await postJSON('/api/auth/customer/verify-email', { token });
      if (result.tokens?.access_token) {
        window.history.pushState({}, '', '/console/overview');
        setActive('overview');
        setRefreshTick((tick) => tick + 1);
      }
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  async function handleResendVerification(email) {
    setError('');
    try {
      return await postJSON('/api/auth/customer/resend-verification', { email });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  async function handleQuotaRaiseRequest(orgId, payload) {
    setError('');
    try {
      return await postJSON(`/api/orgs/${encodeURIComponent(orgId)}/quota-raise-requests`, payload);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  async function handleSwitchOrg(orgId) {
    setError('');
    const response = await fetch('/api/me/active-org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id: orgId }),
    });
    if (!response.ok) {
      setError(`org switch failed with ${response.status}`);
      return;
    }
    setRefreshTick((tick) => tick + 1);
  }

  async function handleLogout() {
    setError('');
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) {
      setError(`logout failed with ${response.status}`);
      return;
    }
    setRefreshTick((tick) => tick + 1);
  }

  const selectedDevice = useMemo(() => {
    if (!selectedDeviceId) return null;
    return devices.find((device) => device.id === selectedDeviceId) || null;
  }, [devices, selectedDeviceId]);

  if (isPublicRoute) {
    return (
      <PublicAuthPage
        active={active}
        error={error}
        onSignup={handleSignup}
        onVerify={handleVerify}
        onResendVerification={handleResendVerification}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">C+</span>
          <strong>Connect+ Ops</strong>
        </div>
        <p className="sidebar-section-label">{isPlatformView ? 'Platform View' : 'Customer View'}</p>
        <nav>
          {visibleNavItems.map((item) => (
            <button
              type="button"
              key={item.id}
              className={active === item.id ? 'active' : ''}
              onClick={() => navigate(item)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-platform-switch">
          <p className="sidebar-section-label">Platform View</p>
          <button type="button" onClick={() => switchView(isPlatformView ? 'customer' : 'platform')}>
            {isPlatformView ? 'Switch to Customer View' : 'Switch to Platform View'}
            <span aria-hidden="true">&gt;</span>
          </button>
        </div>
        <div className="sidebar-account">
          <span className="avatar">{me?.email ? initialsForEmail(me.email) : 'DM'}</span>
          <div>
            <strong>{sessionLabel(me)}</strong>
            <small>{me?.authenticated ? me.email : activeOrgLabel}</small>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="topbar-title">
            <h1>{titleFor(active)}</h1>
          </div>
          <div className="topbar-controls">
            {me?.kind === 'customer' && (me?.memberships?.length ?? 0) > 1 ? (
              <select
                className="org-switcher"
                value={me.active_org_id || ''}
                onChange={(e) => handleSwitchOrg(e.target.value)}
                aria-label="Active organization"
              >
                {(me.memberships || []).map((m) => (
                  <option key={m.organization_id} value={m.organization_id}>{m.organization}</option>
                ))}
              </select>
            ) : (
              <span className="org-chip">{activeOrgLabel}</span>
            )}
            {active === 'overview' ? <WindowToggle value={overviewWindow} onChange={setOverviewWindow} label="Fleet health window" disabled={!sourceAvailable(fleetHealth)} /> : null}
            {active === 'stream-health' ? <WindowToggle value={streamWindow} onChange={setStreamWindow} label="Stream health window" disabled={!sourceAvailable(streamStats)} /> : null}
            {active === 'firmware-ota' ? <StaticWindowToggle /> : null}
            <span className="last-updated">Last updated: {lastUpdatedAt ? formatRelativeTime(lastUpdatedAt) : 'just now'}</span>
            <button type="button" className="icon-button" onClick={() => setRefreshTick((tick) => tick + 1)} aria-label="Refresh dashboard">R</button>
            {me?.authenticated ? <button type="button" className="ghost-button" onClick={handleLogout}>Logout</button> : null}
          </div>
        </header>

        {error ? <div className="error">{error}</div> : null}

        {needsPlatformAccess ? (
          <PlatformAccessGate
            active={active}
            me={me}
            onSSOStart={handleSSOStart}
            onBreakGlassLogin={handleBreakGlassLogin}
          />
        ) : null}
        {!needsPlatformAccess && customerViewPending ? <section className="panel split-panel"><div><h2>Loading session</h2><p>Checking customer access before loading dashboard data.</p></div></section> : null}
        {!needsPlatformAccess && !customerViewPending && customerViewBlocked ? <CustomerAccessGate me={me} onSSOStart={handleSSOStart} /> : null}
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && active === 'overview' ? (
          <Overview
            summary={summary}
            fleetHealth={fleetHealth}
            streamStats={streamStats}
            recentAlerts={recentAlerts}
            overviewWindow={overviewWindow}
            setOverviewWindow={setOverviewWindow}
            me={me}
            loading={loading}
            devices={devices}
            onSSOStart={handleSSOStart}
            onHealthFilter={filterDevicesByHealth}
            onRequestQuotaRaise={handleQuotaRaiseRequest}
          />
        ) : null}
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && active === 'devices' ? (
          <Devices
            active={active}
            devices={devices}
            selectedDevice={selectedDevice}
            deviceDrawerOpen={deviceDrawerOpen}
            me={me}
            setSelectedDeviceId={selectDevice}
            closeDeviceDrawer={closeDeviceDrawer}
            onAction={runDeviceAction}
          />
        ) : null}
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && active === 'firmware-ota' ? (
          <FirmwareOTAPage
            loading={loading}
            distribution={firmwareDistribution}
            onViewDevices={openDevicesForFirmware}
          />
        ) : null}
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && active === 'stream-health' ? (
          <StreamHealthPage
            devices={devices}
            loading={loading}
            stats={streamStats}
            streamWindow={streamWindow}
            setWindow={setStreamWindow}
            onOpenDevice={selectDevice}
          />
        ) : null}
        {!needsPlatformAccess && active === 'platform-health' ? <PlatformHealth summary={summary} health={health} /> : null}
        {!needsPlatformAccess && active === 'platform-sso' ? (
          <PlatformSSOProviders providers={ssoProviders} customers={customers} onSave={handleSSOProviderSave} />
        ) : null}
        {!needsPlatformAccess && active === 'platform-operations' ? <Operations operations={operations} /> : null}
        {!needsPlatformAccess && active === 'platform-audit' ? <AuditLog audit={audit} /> : null}
      </main>
    </div>
  );
}

function PublicAuthPage({ active, error, onSignup, onVerify, onResendVerification }) {
  const params = new URLSearchParams(window.location.search);
  const email = params.get('email') || '';
  const token = params.get('token') || '';

  return (
    <div className="public-auth-shell">
      <section className="auth-hero">
        <p className="eyebrow">Evaluation tier access</p>
        <h1>{titleFor(active)}</h1>
        <p>Self-service signup and verification for the public evaluation tier.</p>
      </section>
      <section className="panel auth-panel">
        {active === 'signup' ? (
          <SignupForm onSignup={onSignup} />
        ) : active === 'signup-check-email' ? (
          <CheckEmailInterstitial email={email} onResendVerification={onResendVerification} />
        ) : (
          <VerifyForm token={token} onVerify={onVerify} />
        )}
        {error ? <div className="error">{error}</div> : null}
      </section>
    </div>
  );
}

function SignupForm({ onSignup }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(password);

  async function submit(event) {
    event.preventDefault();
    if (!acceptTerms || honeypot) return;
    setBusy(true);
    try {
      await onSignup({
        email,
        password,
        display_name: displayName,
        organization_name: organizationName,
        captcha_token: captchaToken,
      });
    } catch (_) {
      return;
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        Email
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} required />
      </label>
      <label>
        Organization name
        <input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Acme Camera Fleet" required />
      </label>
      <label>
        Display name
        <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Optional contact name" />
      </label>
      <label className="auth-honeypot">
        Leave this field empty
        <input value={honeypot} onChange={(event) => setHoneypot(event.target.value)} tabIndex={-1} autoComplete="off" />
      </label>
      <label>
        CAPTCHA token
        <input value={captchaToken} onChange={(event) => setCaptchaToken(event.target.value)} placeholder="Optional if enabled" />
      </label>
      <div className="auth-strength">
        <span>Password strength</span>
        <strong>{strength}</strong>
      </div>
      <label className="auth-terms">
        <input type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} />
        I accept the evaluation-tier terms.
      </label>
      <button type="submit" disabled={busy || !acceptTerms || !!honeypot}>Create account</button>
    </form>
  );
}

function CheckEmailInterstitial({ email, onResendVerification }) {
  const [resendEmail, setResendEmail] = useState(email);
  const [status, setStatus] = useState('');
  const [error, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);

  async function resend(event) {
    event.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      const result = await onResendVerification(resendEmail);
      if (!result) {
        setLocalError('Failed to request a new verification link.');
        return;
      }
      setStatus('Verification link requested again.');
    } catch (_) {
      setLocalError('Failed to request a new verification link.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-stack">
      <p>We sent a verification link to {email || 'your email address'}.</p>
      <form className="auth-inline" onSubmit={resend}>
        <input type="email" value={resendEmail} onChange={(event) => setResendEmail(event.target.value)} placeholder="Email address" required />
        <button type="submit" disabled={busy}>Resend</button>
      </form>
      {status ? <p className="auth-status">{status}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

function VerifyForm({ token, onVerify }) {
  const [value, setValue] = useState(token);
  const [status, setStatus] = useState('Waiting for verification link.');
  const [error, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!value || attempted) return;
    setAttempted(true);
    setBusy(true);
    setLocalError('');
    onVerify(value)
      .then((result) => {
        if (!result) {
          setLocalError('Verification failed. Check the token and try again.');
        } else if (result.tokens?.access_token) {
          setStatus('Verification completed. Redirecting to the dashboard.');
        } else {
          setStatus('Email verified. Sign in to continue.');
        }
      })
      .catch(() => setLocalError('Verification failed. Check the token and try again.'))
      .finally(() => setBusy(false));
  }, [attempted, onVerify, value]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      const result = await onVerify(value);
      if (!result) {
        setLocalError('Verification failed. Check the token and try again.');
      } else if (result.tokens?.access_token) {
        setStatus('Verification completed. Redirecting to the dashboard.');
      } else {
        setStatus('Email verified. Sign in to continue.');
      }
    } catch (_) {
      setLocalError('Verification failed. Check the token and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-stack">
      <p>Paste the email verification token from your inbox link.</p>
      <form className="auth-inline" onSubmit={submit}>
        <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Verification token" required />
        <button type="submit" disabled={busy}>Verify</button>
      </form>
      <p className="auth-status">{status}</p>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

function QuotaRaiseForm({ organizationId, organizationName, currentQuota, onSubmit }) {
  const [requestedQuota, setRequestedQuota] = useState(currentQuota);
  const [useCase, setUseCase] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [lastStatus, setLastStatus] = useState('');
  const [error, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      const result = await onSubmit(organizationId, {
        requested_quota: Number(requestedQuota),
        use_case: useCase,
        contact_info: {
          email: contactEmail,
          name: contactName,
          organization: organizationName,
        },
      });
      if (!result) {
        setLocalError('Quota-raise request failed.');
        return;
      }
      setLastStatus(result?.quota_raise_request?.status ? `Latest request: ${result.quota_raise_request.status}` : 'Latest request submitted.');
    } catch (_) {
      setLocalError('Quota-raise request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="quota-form" onSubmit={submit}>
      <p className="auth-status">Current evaluation cap: {currentQuota} devices.</p>
      <label>
        Requested quota
        <input type="number" min="1" max="200" value={requestedQuota} onChange={(event) => setRequestedQuota(event.target.value)} />
      </label>
      <label>
        Use case
        <input value={useCase} onChange={(event) => setUseCase(event.target.value)} placeholder="Why do you need more devices?" required />
      </label>
      <label>
        Contact email
        <input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} required />
      </label>
      <label>
        Contact name
        <input value={contactName} onChange={(event) => setContactName(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>Request quota raise</button>
      {lastStatus ? <p className="auth-status">{lastStatus}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

function Overview({
  summary,
  fleetHealth,
  streamStats,
  recentAlerts,
  overviewWindow,
  setOverviewWindow,
  me,
  loading,
  devices,
  onSSOStart,
  onHealthFilter,
  onRequestQuotaRaise,
}) {
  const activeMembership = getActiveMembership(me);
  const tierLabel = formatTierLabel(activeMembership?.tier);
  const quotaLimit = activeMembership?.evaluation_device_quota ?? 5;
  const activeDevices = summary?.total_devices ?? 0;
  const quotaRatio = `${activeDevices} / ${quotaLimit} devices`;
  const isEvaluation = (activeMembership?.tier || '').toLowerCase() === 'evaluation';
  const nearQuota = isEvaluation && activeDevices >= Math.max(quotaLimit - 1, 1);
  const current = fleetHealth?.current || {};
  const onlineCount = summary?.online_devices ?? '-';
  const telemetryAvailable = sourceAvailable(fleetHealth);
  const streamAvailable = sourceAvailable(streamStats);
  const onlineRate = telemetryAvailable ? fleetHealth?.online_rate_7d_pct : null;
  const needsAttention = telemetryAvailable && (current.warning !== undefined || current.critical !== undefined)
    ? (current.warning || 0) + (current.critical || 0)
    : 'Unavailable';
  const activeStreams = streamAvailable ? (streamStats?.active_sessions ?? 0) : 'Unavailable';
  const telemetryReason = sourceMessage(fleetHealth, 'No telemetry source configured.');
  const streamReason = sourceMessage(streamStats, 'No stream source configured.');
  const attentionDevices = buildAttentionQueue(devices, recentAlerts);

  return (
    <div className="overview-layout">
      {!me?.authenticated ? <SSOLoginPanel title="Sign in with SSO" onSSOStart={onSSOStart} /> : null}

      <section className="metrics overview-metrics">
        <MetricCard icon="ON" label="Online" value={summary ? `${onlineCount} / ${summary.total_devices ?? 0}` : onlineCount} hint="Devices online" tone="info" />
        <MetricCard icon="%" label="Online Rate" value={telemetryAvailable ? formatPercent(onlineRate) : 'Unavailable'} hint={telemetryAvailable ? 'vs 7d trend' : telemetryReason} tone="info" />
        <MetricCard icon="!" label="Needs Attention" value={needsAttention} hint={telemetryAvailable ? `${current.warning || 0} warning / ${current.critical || 0} critical` : telemetryReason} tone={needsAttention === 0 ? 'good' : 'warn'} />
        <MetricCard icon="ST" label="Active Streams" value={activeStreams} hint={streamAvailable ? `of ${summary?.total_devices ?? 0} devices` : streamReason} tone="info" />
      </section>

      {!telemetryAvailable ? <SourceBlockedState title="Telemetry source unavailable" message={telemetryReason} /> : null}

      <section className="overview-grid">
        <FleetHealthTrendPanel
          loading={loading}
          trend={fleetHealth?.trend || []}
          window={overviewWindow}
          onWindowChange={setOverviewWindow}
          source={fleetHealth}
        />
        <HealthDistributionPanel
          loading={loading}
          current={fleetHealth?.current}
          onFilter={onHealthFilter}
          source={fleetHealth}
        />
      </section>

      <section className="overview-lower-grid">
        <RecentAlertsPanel loading={loading} alerts={recentAlerts} source={fleetHealth} />
        <AttentionQueuePanel loading={loading} items={attentionDevices} onOpenDevice={(deviceId) => updateDevicesLocation({ deviceId })} />
      </section>

      {me?.authenticated && isEvaluation && nearQuota ? (
        <section className="panel quota-callout">
          <div>
            <h2>Evaluation quota</h2>
            <p>{tierLabel} account for {activeMembership?.organization || 'your active organization'} is near its {quotaRatio} cap.</p>
          </div>
          <QuotaRaiseForm
            organizationId={activeMembership?.organization_id}
            organizationName={activeMembership?.organization}
            currentQuota={quotaLimit}
            onSubmit={onRequestQuotaRaise}
          />
        </section>
      ) : null}
    </div>
  );
}

function FirmwareOTAPage({ loading, distribution, onViewDevices }) {
  const versions = distribution?.versions || [];
  const campaigns = distribution?.campaigns || [];
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const available = sourceAvailable(distribution);
  const unavailableText = sourceMessage(distribution, 'Firmware observation source is not configured.');
  const totalDevices = versions.reduce((sum, version) => sum + (version.count || 0), 0);
  const activeCampaigns = campaigns.filter((campaign) => ['active', 'scheduled'].includes(String(campaign.state || '').toLowerCase())).length;
  const latestVersionRow = versions.find((version) => version.is_latest) || versions[0] || null;
  const latestVersion = latestVersionRow?.version || '—';
  const currentDevices = latestVersionRow?.count || 0;
  const primaryCampaign = campaigns[0] || null;
  const selectedCampaign = campaigns.find((campaign) => campaign.campaign_id === selectedCampaignId) || null;
  const pendingUpdate = primaryCampaign?.pending ?? Math.max(totalDevices - currentDevices, 0);
  const failedRollout = primaryCampaign?.failed ?? 0;

  return (
    <section className="panel firmware-ota-page">
      <div className="panel-head">
        <div>
          <h2>Firmware &amp; OTA</h2>
          <p>Track which firmware versions are live across the fleet and how each OTA campaign is progressing.</p>
        </div>
      </div>

      <section className="metrics firmware-page-metrics">
        <MetricCard icon="FW" label="Latest Version" value={available ? latestVersion : 'Unavailable'} hint={available ? 'Current target release' : unavailableText} tone="info" />
        <MetricCard icon="OK" label="Devices Current" value={available ? currentDevices : 'Unavailable'} hint={available ? `${formatPercent(latestVersionRow?.pct || 0)} of fleet` : unavailableText} tone="good" />
        <MetricCard icon="UP" label="Pending Update" value={available ? pendingUpdate : 'Unavailable'} hint={available ? (primaryCampaign ? `${formatPercent(primaryCampaign.total ? pendingUpdate / primaryCampaign.total * 100 : 0)} of rollout` : 'No active rollout') : unavailableText} tone="info" />
        <MetricCard icon="!" label="Failed Rollout" value={available ? failedRollout : 'Unavailable'} hint={available ? (primaryCampaign ? `${formatPercent(primaryCampaign.total ? failedRollout / primaryCampaign.total * 100 : 0)} of rollout` : 'No active rollout') : unavailableText} tone={failedRollout ? 'danger' : 'good'} />
      </section>

      {loading && !distribution ? <p className="empty-state">Loading firmware distribution.</p> : null}
      {distribution && !available ? <SourceBlockedState title="Firmware source unavailable" message={unavailableText} /> : null}

      {distribution && available ? (
        <>
        <div className="firmware-layout">
          <section className="panel firmware-panel">
            <div className="panel-head">
              <div>
                <h3>Firmware distribution</h3>
                <p>Horizontal share by version. Click a row to open the Devices table with that version prefiltered.</p>
              </div>
            </div>
            {versions.length ? (
              <div className="firmware-version-list">
                {versions.map((version) => (
                  <button
                    key={version.version}
                    type="button"
                    className={`firmware-version-row${version.is_latest ? ' is-latest' : ''}`}
                    onClick={() => onViewDevices(version.version)}
                  >
                    <div className="firmware-version-row__meta">
                      <div>
                        <strong>{version.version}</strong>
                        {version.is_latest ? <span className="version-badge">Latest</span> : null}
                      </div>
                      <small>{version.count} devices</small>
                    </div>
                    <div className="firmware-version-row__bar" aria-hidden="true">
                      <span style={{ width: `${Math.max(version.pct || 0, version.count ? 8 : 0)}%` }} />
                    </div>
                    <strong className="firmware-version-row__pct">{formatPercent(version.pct || 0)}</strong>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-state">No firmware versions are available yet.</p>
            )}
          </section>

          <FirmwareCampaignSummary campaign={primaryCampaign} />
        </div>

        <div className="firmware-lower-grid">
          <section className="panel firmware-panel">
            <div className="panel-head">
              <div>
                <h3>Rollout Campaigns <span>(Read-only)</span></h3>
                <p>Campaign status is displayed for visibility only; create/edit flows are out of scope.</p>
              </div>
            </div>
            {campaigns.length ? (
              <div className="campaign-table">
                <div className="campaign-table-head">
                  <span>Campaign</span>
                  <span>Target</span>
                  <span>Policy</span>
                  <span>State</span>
                  <span>Applied</span>
                  <span>Pending</span>
                  <span>Failed</span>
                  <span>Started</span>
                </div>
                {campaigns.map((campaign) => {
                  return (
                    <button
                      key={campaign.campaign_id}
                      type="button"
                      className={`campaign-table-row${selectedCampaign?.campaign_id === campaign.campaign_id ? ' is-selected' : ''}`}
                      onClick={() => setSelectedCampaignId(campaign.campaign_id)}
                    >
                      <strong>{campaign.campaign_id}</strong>
                      <span>{campaign.target_version}</span>
                      <span>{campaign.policy || 'normal'}</span>
                      <StatusBadge value={normalizeStatusKey(campaign.state)} label={toTitleCase(campaign.state || 'unknown')} />
                      <span>{campaign.applied} ({formatPercent(campaign.total ? campaign.applied / campaign.total * 100 : 0)})</span>
                      <span>{campaign.pending} ({formatPercent(campaign.total ? campaign.pending / campaign.total * 100 : 0)})</span>
                      <span>{campaign.failed} ({formatPercent(campaign.total ? campaign.failed / campaign.total * 100 : 0)})</span>
                      <time>{campaign.started_at ? formatRelativeTime(campaign.started_at) : '—'}</time>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="empty-state">No campaigns active.</p>
            )}
          </section>

          <FirmwareCampaignDetail campaign={selectedCampaign} />
          <FirmwareRiskQueue campaigns={campaigns} onViewDevices={onViewDevices} />
        </div>
        </>
      ) : !distribution ? (
        <p className="empty-state">No firmware distribution data available.</p>
      ) : (
        <p className="empty-state">{unavailableText}</p>
      )}
    </section>
  );
}

function FirmwareCampaignDetail({ campaign }) {
  const rows = firmwareCampaignDetailRows(campaign || {});
  return (
    <section className="panel firmware-panel firmware-campaign-detail">
      <div className="panel-head">
        <div>
          <h3>Campaign Detail</h3>
          <p>{campaign ? `${campaign.campaign_id} device rollout status` : 'Select a rollout campaign to inspect device-level status.'}</p>
        </div>
      </div>
      {campaign && rows.length ? (
        <div className="firmware-rollout-table">
          <div className="firmware-rollout-table__head">
            <span>Device</span>
            <span>Current Version</span>
            <span>Target Version</span>
            <span>Rollout Status</span>
            <span>Reason</span>
            <span>Last Updated</span>
          </div>
          {rows.map((rollout) => (
            <div className="firmware-rollout-table__row" key={`${campaign.campaign_id}:${rollout.device_id}`}>
              <strong>{rollout.device_name || rollout.device_id}</strong>
              <span>{rollout.current_version}</span>
              <span>{rollout.target_version || campaign.target_version || '—'}</span>
              <StatusBadge value={normalizeStatusKey(rollout.rollout_status)} label={toTitleCase(rollout.rollout_status || 'pending')} />
              <span>{rollout.reason || '—'}</span>
              <time>{rollout.last_updated ? formatRelativeTime(rollout.last_updated) : '—'}</time>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">{campaign ? 'No device rollout rows are available for this campaign.' : 'No campaign selected.'}</p>
      )}
    </section>
  );
}

function FirmwareCampaignSummary({ campaign }) {
  if (!campaign) {
    return (
      <section className="panel firmware-panel rollout-summary">
        <div className="panel-head">
          <div>
            <h3>Rollout Campaign Summary</h3>
            <p>No active campaign is available.</p>
          </div>
        </div>
      </section>
    );
  }
  const total = campaign.total || 0;
  const segments = [
    { key: 'applied', label: 'Applied', count: campaign.applied, tone: 'good' },
    { key: 'pending', label: 'Pending', count: campaign.pending, tone: 'info' },
    { key: 'failed', label: 'Failed', count: campaign.failed, tone: 'danger' },
    { key: 'skipped', label: 'Skipped', count: campaign.skipped, tone: 'neutral' },
  ];
  return (
    <section className="panel firmware-panel rollout-summary">
      <div className="panel-head">
        <div>
          <h3>Rollout Campaign Summary</h3>
          <p>Target {campaign.target_version} / {campaign.policy || 'normal'} / {campaign.started_at ? formatRelativeTime(campaign.started_at) : 'not started'}</p>
        </div>
        <StatusBadge value={normalizeStatusKey(campaign.state)} label={toTitleCase(campaign.state || 'unknown')} />
      </div>
      <div className="rollout-summary-grid">
        {segments.map((segment) => (
          <div key={segment.key}>
            <span>{segment.label}</span>
            <strong>{segment.count}</strong>
            <small>{formatPercent(total ? segment.count / total * 100 : 0)}</small>
          </div>
        ))}
        <div>
          <span>Total</span>
          <strong>{total}</strong>
          <small>100%</small>
        </div>
      </div>
      <div className="rollout-progress" aria-label="Rollout progress">
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={`tone-${segment.tone}`}
            style={{ width: `${total ? Math.max(segment.count / total * 100, segment.count ? 6 : 0) : 0}%` }}
          />
        ))}
      </div>
    </section>
  );
}

function FirmwareRiskQueue({ campaigns, onViewDevices }) {
  const rows = firmwareRiskRows(campaigns, 6);
  return (
    <section className="panel firmware-panel firmware-risk-queue">
      <div className="panel-head">
        <div>
          <h3>Firmware Risk Queue</h3>
          <p>Devices behind latest, failed, pending, or reporting unknown firmware.</p>
        </div>
        <span>{rows.length} devices</span>
      </div>
      {rows.length ? (
        <div className="risk-table">
          <div className="risk-table-head">
            <span>Device</span>
            <span>Current Version</span>
            <span>Status</span>
            <span>Last Seen</span>
          </div>
          {rows.map((rollout) => (
            <button
              type="button"
              className="risk-table-row"
              key={`${rollout.campaign.campaign_id}:${rollout.device_id}`}
              onClick={() => onViewDevices(firmwareVersionFilterValue(rollout.current_version))}
            >
              <strong>{rollout.device_name || rollout.device_id}</strong>
              <span>{rollout.current_version}</span>
              <StatusBadge value={normalizeStatusKey(rollout.rollout_status)} label={toTitleCase(rollout.rollout_status || 'pending')} />
              <time>{rollout.last_updated ? formatRelativeTime(rollout.last_updated) : '—'}</time>
            </button>
          ))}
        </div>
      ) : (
        <p className="empty-state">No firmware risk items.</p>
      )}
    </section>
  );
}

function StreamHealthPage({ devices, loading, stats, streamWindow, setWindow, onOpenDevice }) {
  const trend = stats?.trend || [];
  const modeTrends = stats?.trend_by_mode || [];
  const worstDevices = stats?.worst_devices || [];
  const byMode = stats?.by_mode || {};
  const available = sourceAvailable(stats);
  const unavailableText = sourceMessage(stats, 'WebRTC session event source is not configured.');
  const windowLabel = String(streamWindow || '7d').toUpperCase();
  const chart = useMemo(() => buildStreamHealthChart(trend, modeTrends), [trend, modeTrends]);
  const kpis = [
    {
      key: 'success-rate',
      label: `Stream Success Rate (${windowLabel})`,
      value: available ? formatPercent(stats?.success_rate_pct ?? 0) : 'Unavailable',
      hint: available ? 'Percent of stream requests that succeeded in the selected window' : unavailableText,
    },
    {
      key: 'avg-duration',
      label: 'Avg Stream Duration',
      value: available ? formatDurationMinutes(stats.avg_duration_seconds) : 'Unavailable',
      hint: available ? 'Average session length across observed requests' : unavailableText,
    },
    {
      key: 'active-sessions',
      label: 'Active Sessions Now',
      value: available ? (stats?.active_sessions ?? 0) : 'Unavailable',
      hint: available ? 'Count of currently open stream sessions' : unavailableText,
    },
    {
      key: 'never-streamed',
      label: 'Devices Never Streamed',
      value: available ? (stats?.never_streamed_count ?? 0) : 'Unavailable',
      hint: available ? 'Online devices that have no stream history' : unavailableText,
    },
  ];

  return (
    <section className="panel stream-health-page">
      <div className="panel-head">
        <div>
          <h2>Stream Health</h2>
          <p>Are device streams succeeding for end users, and where are the worst failures concentrated?</p>
        </div>
      </div>

      <section className="metrics stream-health-metrics">
        {kpis.map(({ key, label, value, hint }) => (
          <MetricCard
            key={key}
            label={label}
            value={value}
            hint={hint}
            tone="info"
          />
        ))}
      </section>

      {!available && stats ? <SourceBlockedState title="Stream source unavailable" message={unavailableText} /> : null}

      {loading && !stats ? (
        <p className="empty-state">Loading stream health data.</p>
      ) : stats && available ? (
        <div className="stream-health-layout">
          <section className="panel stream-trend-panel">
            <div className="panel-head">
              <div>
                <h3>Success trend</h3>
                <p>Daily WebRTC request volume and success-rate lines.</p>
              </div>
            </div>

            {chart.points.length ? (
              <>
                <div className="stream-chart-legend">
                  <span><i className="legend-bar legend-requests" /> Requests</span>
                  <span><i className="legend-line legend-overall" /> Overall</span>
                  <span><i className="legend-line legend-webrtc" /> WebRTC</span>
                </div>
                <svg viewBox="0 0 720 300" className="trend-chart stream-trend-chart" role="img" aria-label="Stream success trend chart">
                  <defs>
                    <linearGradient id="streamRequestsFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="rgba(6, 116, 194, 0.26)" />
                      <stop offset="100%" stopColor="rgba(6, 116, 194, 0.02)" />
                    </linearGradient>
                  </defs>
                  {chart.grid.map((line, index) => (
                    <line key={`grid-${index}`} x1="52" x2="676" y1={line} y2={line} className="chart-grid-line" />
                  ))}
                  <line x1="52" x2="676" y1="228" y2="228" className="chart-axis-line" />
                  {chart.requestBars.map((bar) => (
                    <rect
                      key={bar.date}
                      x={bar.x}
                      y={bar.y}
                      width={bar.width}
                      height={bar.height}
                      rx="4"
                      className="chart-bar chart-bar-requests"
                    />
                  ))}
                  <polyline points={chart.overallPoints} className="chart-line chart-line-overall" />
                  {chart.modeSeries.map((series) => (
                    <polyline key={series.mode} points={series.points} className={`chart-line ${series.className}`} />
                  ))}
                  {chart.points.map((point, index) => (
                    <g key={point.date}>
                      <circle cx={point.x} cy={point.overallY} r="4" className="chart-dot chart-dot-overall" />
                      {index % chart.labelStep === 0 ? (
                        <text x={point.x} y="258" textAnchor="middle" className="chart-label">
                          {point.label}
                        </text>
                      ) : null}
                    </g>
                  ))}
                  <text x="14" y="34" className="chart-axis-label">100%</text>
                  <text x="14" y="228" className="chart-axis-label">0%</text>
                  <text x="700" y="34" textAnchor="end" className="chart-axis-label">{chart.maxRequests}</text>
                  <text x="700" y="228" textAnchor="end" className="chart-axis-label">0</text>
                </svg>
                <p className="chart-footnote">Bars show WebRTC request volume; lines show the overall and WebRTC success rate for the selected window.</p>
              </>
            ) : (
              <p className="empty-state">No stream requests in selected window.</p>
            )}

            <div className="stream-mode-summary">
              {['webrtc'].map((mode) => {
                const statsForMode = byMode[mode] || {};
                return (
                  <div key={mode} className="stream-mode-summary__item">
                    <span>{streamModeLabel(mode)}</span>
                    <strong>{formatPercent(statsForMode.success_rate_pct ?? 0)}</strong>
                    <small>{statsForMode.requests ?? 0} requests</small>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel stream-table-panel">
            <div className="panel-head">
              <div>
                <h3>Worst devices</h3>
                <p>Devices ordered by failure rate, worst first.</p>
              </div>
            </div>

            {worstDevices.length ? (
              <div className="stream-device-table">
                <div className="stream-device-table__head">
                  <span>Device</span>
                  <span>Mode Used</span>
                  <span>Success Rate ({windowLabel})</span>
                  <span>Total Requests ({windowLabel})</span>
                  <span>Last Stream</span>
                  <span>Status</span>
                </div>
                {worstDevices.map((device) => (
                  <div key={device.device_id} className="stream-device-table__row">
                    <strong>{device.device_name || device.device_id}</strong>
                    <span>{streamModeLabel(device.mode_used)}</span>
                    <span>{formatPercent(device.success_rate_pct ?? 0)}</span>
                    <span>{device.requests ?? 0}</span>
                    <time title={device.last_stream_at || ''}>{device.last_stream_at ? formatRelativeTime(device.last_stream_at) : '—'}</time>
                    <StatusBadge value={normalizeStatusKey(device.readiness)} label={formatReadinessLabel(device.readiness)} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">No stream requests in selected window.</p>
            )}
          </section>
          <StreamAttentionPanel devices={devices} onOpenDevice={onOpenDevice} />
        </div>
      ) : (
        <p className="empty-state">{unavailableText}</p>
      )}
    </section>
  );
}

function GroupsPage() {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Groups</h2>
          <p>Customer group management and membership assignment will be added here.</p>
        </div>
      </div>
      <p className="placeholder-subtitle">Placeholder area for customer group workspace.</p>
    </section>
  );
}

function CustomerAccessGate({ me, onSSOStart }) {
  if (me?.kind === 'platform_admin') {
    return (
      <section className="panel split-panel">
        <div>
          <h2>Platform admin cannot use Customer View</h2>
          <p>Switch to Platform View to inspect service health, SSO providers, operations, and audit data across tenants.</p>
        </div>
      </section>
    );
  }
  return (
    <>
      <SSOLoginPanel title="Sign in with SSO" onSSOStart={onSSOStart} />
      <section className="panel split-panel">
        <div>
          <h2>Customer access required</h2>
          <p>Sign in with a customer account to open the operations console.</p>
        </div>
      </section>
    </>
  );
}

function PlatformAccessGate({ active, me, onSSOStart, onBreakGlassLogin }) {
  return (
    <>
      <SSOLoginPanel title="Platform SSO sign in" onSSOStart={onSSOStart} />
      {shouldShowBreakGlass(me) ? (
        <BreakGlassLoginPanel title="Break-glass platform access" onLogin={onBreakGlassLogin} />
      ) : null}
      <section className="panel split-panel">
        <div>
          <h2>Platform access required</h2>
          <p>Sign in with a platform admin session to open {titleFor(active)}.</p>
        </div>
      </section>
    </>
  );
}

function PlatformHealth({ summary, health }) {
  const customerCount = summary?.customers ?? '-';
  const demoServices = health.filter((item) => item.status === 'demo');
  const hasDemo = demoServices.length > 0;
  return (
    <>
      <section className="panel split-panel">
        <div>
          <h2>Platform Operations</h2>
          <p>Cross-customer view for service and operations support teams.</p>
          <div className="admin-kpis">
            <div><strong>{customerCount}</strong><span>Customers</span></div>
            <div><strong>{health.length}</strong><span>Service checks</span></div>
          </div>
        </div>
        <ServiceHealth health={health} compact />
      </section>
      {hasDemo ? <section className="panel demo-banner"><p>{`Demo services active: ${demoServices.map((service) => service.name).join(', ')}`}</p></section> : null}
    </>
  );
}

function PlatformSSOProviders({ providers, customers, onSave }) {
  const providerByOrg = useMemo(() => {
    const byOrg = new Map();
    for (const provider of providers || []) {
      byOrg.set(provider.organization_id, provider);
    }
    return byOrg;
  }, [providers]);
  const rows = (customers || []).map((customer) => providerByOrg.get(customer.organization_id) || {
    organization_id: customer.organization_id,
    organization: customer.organization,
    enabled: false,
    configured: false,
    status: 'not_configured',
    verified_domains: [],
  });

  return (
    <>
      <section className="panel split-panel">
        <div>
          <h2>SSO Providers</h2>
          <p>Platform Admin-managed customer organization identity provider settings.</p>
          <div className="admin-kpis">
            <div><strong>{rows.filter((provider) => provider.configured).length}</strong><span>Configured</span></div>
            <div><strong>{rows.filter((provider) => provider.enabled).length}</strong><span>Enabled</span></div>
          </div>
        </div>
        <div className="sso-note">
          <strong>Secret handling</strong>
          <span>Client secrets are sent only to Account Manager and are never returned by this console.</span>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Organization SSO status</h2>
            <p>Review setup state, verified domains, issuer, and client identifier by customer organization.</p>
          </div>
        </div>
        <div className="sso-provider-list">
          {rows.map((provider) => (
            <SSOProviderCard
              key={provider.organization_id}
              provider={provider}
              onSave={onSave}
            />
          ))}
          {!rows.length ? <p className="empty-state">No customer organizations are available.</p> : null}
        </div>
      </section>
    </>
  );
}

function SSOProviderCard({ provider, onSave }) {
  const [issuer, setIssuer] = useState(provider.issuer || '');
  const [clientID, setClientID] = useState(provider.client_id || '');
  const [clientSecret, setClientSecret] = useState('');
  const [domains, setDomains] = useState((provider.verified_domains || []).join(', '));
  const [enabled, setEnabled] = useState(Boolean(provider.enabled));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setIssuer(provider.issuer || '');
    setClientID(provider.client_id || '');
    setDomains((provider.verified_domains || []).join(', '));
    setEnabled(Boolean(provider.enabled));
    setClientSecret('');
  }, [provider]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave(provider.organization_id, {
        issuer,
        client_id: clientID,
        client_secret: clientSecret,
        verified_domains: domains.split(',').map((domain) => domain.trim()).filter(Boolean),
        enabled,
      });
      setClientSecret('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sso-provider-card" onSubmit={submit}>
      <div className="sso-provider-head">
        <div>
          <strong>{provider.organization || provider.organization_id}</strong>
          <small>{provider.organization_id}</small>
        </div>
        <span className={`status-pill ${provider.enabled ? 'ok' : provider.configured ? 'warn' : 'neutral'}`}>
          {provider.enabled ? 'Enabled' : provider.configured ? 'Configured' : 'Not configured'}
        </span>
      </div>
      <div className="sso-provider-grid">
        <label>
          <span>Issuer</span>
          <input value={issuer} onChange={(event) => setIssuer(event.target.value)} placeholder="https://idp.example.com" />
        </label>
        <label>
          <span>Client ID</span>
          <input value={clientID} onChange={(event) => setClientID(event.target.value)} placeholder="oidc-client-id" />
        </label>
        <label>
          <span>Verified domains</span>
          <input value={domains} onChange={(event) => setDomains(event.target.value)} placeholder="example.com, example.co.jp" />
        </label>
        <label>
          <span>Client secret</span>
          <input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="Only sent to Account Manager" autoComplete="new-password" />
        </label>
      </div>
      <div className="sso-provider-foot">
        <label className="toggle-row">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>Enable provider</span>
        </label>
        <span className="muted">{provider.status || 'not_configured'}{provider.last_validated_at ? ` · validated ${formatRelativeTime(provider.last_validated_at)}` : ''}</span>
        <button type="submit" disabled={busy}>{busy ? 'Saving' : 'Save provider'}</button>
      </div>
    </form>
  );
}

function MetricGrid({ summary }) {
  const data = summary || {};
  const metrics = [
    ['Total devices', data.total_devices ?? '-'],
    ['Online', data.online_devices ?? '-'],
    ['Activated', data.activated_devices ?? '-'],
    ['Pending', data.pending_devices ?? '-'],
    ['Failed', data.failed_devices ?? '-'],
    ['Open ops', data.open_operations ?? '-'],
  ];
  return (
    <section className="metrics">
      {metrics.map(([label, value]) => (
        <div className="metric" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function MetricCard({ icon, label, value, hint, tone = 'neutral' }) {
  return (
    <div className={`metric-card tone-${tone}`}>
      {icon ? <span className="metric-icon" aria-hidden="true">{icon}</span> : null}
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </div>
  );
}

function WindowToggle({ value, onChange, label, disabled = false }) {
  return (
    <div className="window-toggle" role="tablist" aria-label={label}>
      {['7d', '30d'].map((option) => (
        <button
          key={option}
          type="button"
          className={value === option ? 'active' : ''}
          disabled={disabled}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function StaticWindowToggle() {
  return (
    <div className="window-toggle" aria-label="Firmware data window">
      <button type="button" className="active">7d</button>
      <button type="button">30d</button>
    </div>
  );
}

function SourceBlockedState({ title, message }) {
  return (
    <section className="panel source-blocked">
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
    </section>
  );
}

function FleetHealthTrendPanel({ loading, trend, source }) {
  const chart = useMemo(() => buildFleetTrendChart(trend), [trend]);
  const available = sourceAvailable(source);
  return (
    <section className="panel overview-panel trend-panel">
      <div className="panel-head">
        <div>
          <h2>Fleet health trend</h2>
          <p>Daily online share and warning/critical volume across the current window.</p>
        </div>
      </div>
      {!available ? (
        <p className="empty-state">{sourceMessage(source, 'No telemetry source configured.')}</p>
      ) : loading && !trend.length ? (
        <p className="empty-state">Loading fleet trend data.</p>
      ) : chart.points.length ? (
        <>
          <div className="chart-legend">
            <span><i className="legend-line legend-online" /> Online %</span>
            <span><i className="legend-line legend-alerts" /> Warning + critical</span>
          </div>
          <svg viewBox="0 0 720 280" className="trend-chart" role="img" aria-label="Fleet health trend chart">
            <defs>
              <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(0, 104, 183, 0.22)" />
                <stop offset="100%" stopColor="rgba(0, 104, 183, 0.03)" />
              </linearGradient>
            </defs>
            {chart.grid.map((line, index) => (
              <line key={`grid-${index}`} x1="52" x2="676" y1={line} y2={line} className="chart-grid-line" />
            ))}
            <line x1="52" x2="676" y1="228" y2="228" className="chart-axis-line" />
            <polyline points={chart.onlinePoints} className="chart-line chart-line-online" />
            <polyline points={chart.alertPoints} className="chart-line chart-line-alerts" />
            {chart.points.map((point, index) => (
              <g key={point.date}>
                <circle cx={point.x} cy={point.onlineY} r="4" className="chart-dot chart-dot-online" />
                <circle cx={point.x} cy={point.alertY} r="4" className="chart-dot chart-dot-alerts" />
                {index % chart.labelStep === 0 ? (
                  <text x={point.x} y="256" textAnchor="middle" className="chart-label">
                    {point.label}
                  </text>
                ) : null}
              </g>
            ))}
            <text x="14" y="34" className="chart-axis-label">{chart.maxPct}%</text>
            <text x="14" y="228" className="chart-axis-label">0%</text>
            <text x="700" y="34" textAnchor="end" className="chart-axis-label">{chart.maxAlerts}</text>
            <text x="700" y="228" textAnchor="end" className="chart-axis-label">0</text>
          </svg>
          <p className="chart-footnote">
            Alert counts are plotted on the same grid as a normalized line for the selected window.
          </p>
        </>
      ) : (
        <p className="empty-state">No fleet health trend data available.</p>
      )}
    </section>
  );
}

function HealthDistributionPanel({ loading, current, onFilter, source }) {
  const available = sourceAvailable(source);
  const items = [
    { key: 'healthy', label: 'Healthy', count: current?.healthy ?? 0, tone: 'good' },
    { key: 'warning', label: 'Warning', count: current?.warning ?? 0, tone: 'warn' },
    { key: 'critical', label: 'Critical', count: current?.critical ?? 0, tone: 'danger' },
    { key: 'unknown', label: 'Unknown', count: current?.unknown ?? 0, tone: 'neutral' },
  ];
  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <section className="panel overview-panel distribution-panel">
      <div className="panel-head">
        <div>
          <h2>Health distribution</h2>
          <p>Breakdown of the current fleet by telemetry health state.</p>
        </div>
      </div>
      {!available ? (
        <p className="empty-state">{sourceMessage(source, 'No telemetry source configured.')}</p>
      ) : loading && !current ? (
        <p className="empty-state">Loading fleet health distribution.</p>
      ) : total > 0 ? (
        <div className="distribution-stack">
          <div className="distribution-bar" aria-label="Fleet health distribution">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`distribution-segment tone-${item.tone}`}
                style={{ width: `${Math.max(item.count / total * 100, item.count ? 8 : 0)}%` }}
                onClick={() => onFilter(item.key)}
              >
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </button>
            ))}
          </div>
          <div className="distribution-list">
            {items.map((item) => (
              <button key={`legend-${item.key}`} type="button" className="distribution-row" onClick={() => onFilter(item.key)}>
                <span className={`status status-${item.key}`}>{item.label}</span>
                <strong>{item.count}</strong>
                <small>{formatPercent(total ? (item.count / total) * 100 : 0)}</small>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="empty-state">No health data available yet.</p>
      )}
    </section>
  );
}

function RecentAlertsPanel({ loading, alerts, source }) {
  const available = sourceAvailable(source);
  return (
    <section className="panel overview-panel alerts-panel">
      <div className="panel-head">
        <div>
          <h2>Recent alerts</h2>
          <p>Last 10 telemetry events that resulted in a health change.</p>
        </div>
      </div>
      {!available ? (
        <p className="empty-state">{sourceMessage(source, 'No telemetry source configured.')}</p>
      ) : loading && !alerts.length ? (
        <p className="empty-state">Loading recent alerts.</p>
      ) : alerts.length ? (
        <div className="alerts-table">
          <div className="alerts-table-head">
            <span>Time</span>
            <span>Device</span>
            <span>Signal</span>
            <span>Health</span>
          </div>
          {alerts.map((alert) => (
            <div className="alerts-table-row" key={alert.id}>
              <time title={alert.occurred_at}>{formatRelativeTime(alert.occurred_at)}</time>
              <strong>{alert.device_name}</strong>
              <span>{alert.signal}</span>
              <StatusBadge value={normalizeStatusKey(alert.health)} label={toTitleCase(alert.health)} />
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">No alerts in selected window.</p>
      )}
    </section>
  );
}

function AttentionQueuePanel({ loading, items, onOpenDevice }) {
  return (
    <section className="panel overview-panel attention-panel">
      <div className="panel-head">
        <div>
          <h2>Attention Queue ({items.length})</h2>
          <p>Devices sorted by current health, signal, and alert impact.</p>
        </div>
      </div>
      {loading && !items.length ? (
        <p className="empty-state">Loading attention queue.</p>
      ) : items.length ? (
        <div className="attention-list">
          <div className="attention-list-head">
            <span>Device</span>
            <span>Issue</span>
            <span>Since</span>
            <span>Action</span>
          </div>
          {items.slice(0, 7).map((item) => (
            <div className="attention-row" key={item.device_id}>
              <strong>{item.device_name}</strong>
              <span className={`attention-issue tone-${item.tone}`}>{item.issue}</span>
              <time>{item.since}</time>
              <button type="button" onClick={() => onOpenDevice(item.device_id)}>Investigate</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">No devices require attention.</p>
      )}
    </section>
  );
}

function StreamAttentionPanel({ devices, onOpenDevice }) {
  const items = buildStreamAttentionItems(devices);
  return (
    <section className="panel stream-attention-panel">
      <div className="panel-head">
        <div>
          <h3>Devices needing stream attention</h3>
          <p>Customer-readable stream reliability risks.</p>
        </div>
      </div>
      {items.length ? (
        <div className="stream-attention-list">
          {items.map((item) => (
            <div className="stream-attention-row" key={item.device_id}>
              <div>
                <strong>{item.device_name}</strong>
                <small>{item.issue}</small>
              </div>
              <StatusBadge value={normalizeStatusKey(item.health)} label={formatHealthLabel(item.health)} />
              <button type="button" onClick={() => onOpenDevice(item.device_id)}>View device</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">No stream attention items.</p>
      )}
    </section>
  );
}

function Devices({ active, devices, selectedDevice, deviceDrawerOpen, me, setSelectedDeviceId, closeDeviceDrawer, onAction }) {
  const [readinessFilter, setReadinessFilter] = useState('All');
  const [healthFilter, setHealthFilter] = useState('All');
  const [signalFilter, setSignalFilter] = useState('All');
  const [firmwareFilter, setFirmwareFilter] = useState('All');
  const [telemetryById, setTelemetryById] = useState({});
  const [telemetryLoadingId, setTelemetryLoadingId] = useState('');
  const [telemetryError, setTelemetryError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const health = params.get('health');
    if (health) {
      setHealthFilter(filterLabelFromQuery(health));
    } else {
      setHealthFilter('All');
    }
    const status = params.get('status');
    if (status) {
      setReadinessFilter(filterLabelFromQuery(status));
    } else {
      setReadinessFilter('All');
    }
    const signal = params.get('signal');
    if (signal) {
      setSignalFilter(filterLabelFromQuery(signal));
    } else {
      setSignalFilter('All');
    }
    const firmware = params.get('firmware');
    if (firmware) {
      setFirmwareFilter(firmware);
    } else {
      setFirmwareFilter('All');
    }
  }, [active]);

  useEffect(() => {
    if (!deviceDrawerOpen || !selectedDevice?.id) return;
    if (telemetryById[selectedDevice.id]) {
      setTelemetryError('');
      setTelemetryLoadingId('');
      return;
    }
    let alive = true;
    setTelemetryError('');
    setTelemetryLoadingId(selectedDevice.id);
    fetchJSON(`/api/devices/${selectedDevice.id}/telemetry`)
      .then((payload) => {
        if (!alive) return;
        setTelemetryById((current) => ({
          ...current,
          [selectedDevice.id]: payload,
        }));
      })
      .catch((err) => {
        if (!alive) return;
        setTelemetryError(err.message);
      })
      .finally(() => {
        if (!alive) return;
        setTelemetryLoadingId('');
      });
    return () => {
      alive = false;
    };
  }, [deviceDrawerOpen, selectedDevice?.id, telemetryById]);

  useEffect(() => {
    if (!deviceDrawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeDeviceDrawer();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [deviceDrawerOpen, closeDeviceDrawer]);

  const processedDevices = useMemo(() => {
    const withDeviceSignals = devices.map((device) => ({
      ...device,
      firmware_version_display: firmwareVersionFilterValue(device.firmware_version),
      health_display: formatHealthLabel(device.health),
      signal_display: device.signal_quality || '—',
      readiness_display: formatReadinessLabel(device.readiness),
    }));

    const signalValues = new Set(['—', 'Good', 'Fair', 'Poor', 'Unknown']);
    return {
      rows: withDeviceSignals,
      firmwareValues: ['All', ...new Set(withDeviceSignals.map((device) => device.firmware_version_display))],
      readinessValues: ['All', ...new Set(withDeviceSignals.map((device) => device.readiness_display))],
      healthValues: ['All', ...new Set(withDeviceSignals.map((device) => device.health_display))],
      signalValues: ['All', ...new Set(withDeviceSignals.map((device) => device.signal_display).filter((value) => signalValues.has(value)))],
    };
  }, [devices]);

  const tableRows = useMemo(() => {
    const readinessMatch = (row) => readinessFilter === 'All' || row.readiness_display === readinessFilter;
    const healthMatch = (row) => healthFilter === 'All' || row.health_display === healthFilter;
    const signalMatch = (row) => signalFilter === 'All' || row.signal_display === signalFilter;
    const firmwareMatch = (row) => firmwareFilter === 'All' || row.firmware_version_display === firmwareFilter;

    return processedDevices.rows.filter((device) => readinessMatch(device) && healthMatch(device) && signalMatch(device) && firmwareMatch(device));
  }, [processedDevices.rows, readinessFilter, healthFilter, signalFilter, firmwareFilter]);

  const columns = useMemo(() => [
    {
      key: 'name',
      label: 'Device',
      value: (device) => device.name,
      render: (device) => (
        <>
          <strong>{device.name}</strong>
          <small>{device.serial_number}</small>
        </>
      ),
    },
    { key: 'organization', label: 'Organization', value: (device) => device.organization },
    { key: 'model', label: 'Model', value: (device) => device.model },
    {
      key: 'firmware',
      label: 'Firmware',
      value: (device) => device.firmware_version_display,
      render: (device) => device.firmware_version_display,
    },
    {
      key: 'health',
      label: 'Health',
      value: (device) => device.health_display,
      render: (device) => <StatusBadge value={normalizeStatusKey(device.health_display)} label={device.health_display} />,
    },
    {
      key: 'signal',
      label: 'Signal',
      value: (device) => device.signal_display,
      render: (device) => <StatusBadge value={normalizeStatusKey(device.signal_display)} label={device.signal_display} />,
    },
    {
      key: 'readiness',
      label: 'Status',
      value: (device) => device.readiness_display,
      render: (device) => <StatusBadge value={normalizeStatusKey(device.readiness)} label={device.readiness_display} />,
    },
    {
      key: 'last_seen_at',
      label: 'Last seen',
      value: (device) => device.last_seen_at,
      render: (device) => device.last_seen_at ? <time title={device.last_seen_at}>{formatRelativeTime(device.last_seen_at)}</time> : 'No transport evidence',
    },
  ], []);

  const selectedTelemetry = selectedDevice ? telemetryById[selectedDevice.id] || null : null;
  const telemetryBusy = deviceDrawerOpen && selectedDevice?.id && telemetryLoadingId === selectedDevice.id && !selectedTelemetry;
  const readOnly = isReadOnlyRole(getActiveMembership(me)?.role);

  function updateFilter(next = {}) {
    const nextReadiness = next.readiness ?? readinessFilter;
    const nextHealth = next.health ?? healthFilter;
    const nextSignal = next.signal ?? signalFilter;
    const nextFirmware = next.firmware ?? firmwareFilter;
    if (next.readiness !== undefined) setReadinessFilter(nextReadiness);
    if (next.health !== undefined) setHealthFilter(nextHealth);
    if (next.signal !== undefined) setSignalFilter(nextSignal);
    if (next.firmware !== undefined) setFirmwareFilter(nextFirmware);
    updateDevicesLocation({
      deviceId: '',
      health: filterQueryValue(nextHealth),
      status: filterQueryValue(nextReadiness),
      signal: filterQueryValue(nextSignal),
      firmware: nextFirmware === 'All' ? '' : nextFirmware,
    });
  }

  return (
    <section className="device-workspace">
      <div className="panel device-table-panel">
        <div className="panel-head">
          <div>
            <h2>Devices</h2>
            <p>Search, filter, and inspect fleet devices without exposing internal platform identifiers.</p>
          </div>
        </div>
        <div className="device-filters">
          <label className="device-filter">
            <span>Health</span>
            <select value={healthFilter} onChange={(event) => updateFilter({ health: event.target.value })}>
              {processedDevices.healthValues.map((value) => (
                <option key={`health-${value}`} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="device-filter">
            <span>Readiness</span>
            <select value={readinessFilter} onChange={(event) => updateFilter({ readiness: event.target.value })}>
              {processedDevices.readinessValues.map((value) => (
                <option key={`readiness-${value}`} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="device-filter">
            <span>Signal</span>
            <select value={signalFilter} onChange={(event) => updateFilter({ signal: event.target.value })}>
              {processedDevices.signalValues.map((value) => (
                <option key={`signal-${value}`} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="device-filter">
            <span>Firmware</span>
            <select value={firmwareFilter} onChange={(event) => updateFilter({ firmware: event.target.value })}>
              {processedDevices.firmwareValues.map((value) => (
                <option key={`firmware-${value}`} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="filter-clear-button"
            onClick={() => {
              setReadinessFilter('All');
              setHealthFilter('All');
              setSignalFilter('All');
              setFirmwareFilter('All');
              updateDevicesLocation({ deviceId: '', health: '', status: '', signal: '', firmware: '' });
            }}
          >
            Clear filters
          </button>
        </div>
        <DataTable
          columns={columns}
          rows={tableRows}
          rowKey={(device) => device.id}
          initialSortKey="name"
          searchPlaceholder="Search devices"
          emptyLabel="No devices match the current filter."
          rowClassName={(device) => deviceDrawerOpen && selectedDevice?.id === device.id ? 'selected-row' : ''}
          onRowClick={(device) => setSelectedDeviceId(device.id)}
        />
        <div className="mobile-device-list" aria-label="Compact device list">
          {tableRows.length ? tableRows.map((device) => (
            <button key={device.id} type="button" className="mobile-device-row" onClick={() => setSelectedDeviceId(device.id)}>
              <span>
                <strong>{device.name}</strong>
                <small>{device.serial_number}</small>
              </span>
              <span>
                <StatusBadge value={normalizeStatusKey(device.health_display)} label={device.health_display} />
                <StatusBadge value={normalizeStatusKey(device.readiness)} label={device.readiness_display} />
              </span>
              <time title={device.last_seen_at || ''}>{device.last_seen_at ? formatRelativeTime(device.last_seen_at) : 'No transport evidence'}</time>
            </button>
          )) : <p className="empty-state">No devices match the current filter.</p>}
        </div>
      </div>
      {deviceDrawerOpen ? (
        <DeviceDrawer
          device={selectedDevice}
          telemetry={selectedTelemetry}
          loading={telemetryBusy}
          error={telemetryError}
          readOnly={readOnly}
          onClose={closeDeviceDrawer}
          onAction={onAction}
        />
      ) : null}
    </section>
  );
}

function Customers({ customers }) {
  const columns = useMemo(() => [
    {
      key: 'organization',
      label: 'Customer',
      value: (customer) => customer.organization,
      render: (customer) => (
        <>
          <strong>{customer.organization}</strong>
          <small>{customer.organization_id}</small>
        </>
      ),
    },
    { key: 'total_devices', label: 'Total', value: (customer) => customer.total_devices },
    { key: 'online_devices', label: 'Online', value: (customer) => customer.online_devices },
    { key: 'activated_devices', label: 'Activated', value: (customer) => customer.activated_devices },
    { key: 'pending_devices', label: 'Pending', value: (customer) => customer.pending_devices },
    { key: 'failed_devices', label: 'Failed', value: (customer) => customer.failed_devices },
    {
      key: 'last_seen_at',
      label: 'Last seen',
      value: (customer) => customer.last_seen_at,
      render: (customer) => customer.last_seen_at || 'No activity',
    },
  ], []);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Customers</h2>
          <p>Organization-level fleet health aggregated from cached device projections.</p>
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={customers}
        rowKey={(customer) => customer.organization_id}
        initialSortKey="organization"
        searchPlaceholder="Search customers"
        emptyLabel="No customers match the current filter."
        tableClassName="customers-table"
      />
    </section>
  );
}

function DeviceDrawer({ device, telemetry, loading, error, readOnly, onClose, onAction }) {
  const drawerName = telemetry?.device_name || device?.name || 'Device selected';
  const drawerOrganization = telemetry?.organization || device?.organization || '—';
  const drawerModel = telemetry?.model || device?.model || '—';
  const drawerSerial = telemetry?.serial_number || device?.serial_number || '—';
  const drawerLastSeen = telemetry?.last_seen_at || device?.last_seen_at || '';
  const drawerFirmware = telemetry?.firmware_version || device?.firmware_version || '—';
  const telemetryAvailable = telemetry?.telemetry_status === 'available';
  const telemetryUnavailableText = telemetry?.unavailable_reason || error || 'Telemetry source is unavailable for this device.';
  const streamStatus = deriveStreamStatus(telemetry);
  const actionContext = { readOnly, telemetryStatus: telemetry?.telemetry_status };
  const provisionState = deviceActionState(device, 'provision', actionContext);
  const deactivateState = deviceActionState(device, 'deactivate', actionContext);
  function runDrawerAction(action) {
    const label = action === 'deactivate' ? 'deactivate this device' : 'provision this device';
    if (!window.confirm(`Confirm you want to ${label}.`)) return;
    onAction(device.id, action);
  }
  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="drawer-panel" role="dialog" aria-modal="true" aria-label="Device detail drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Device detail</p>
            <h2>{drawerName}</h2>
            <p>{device ? `${drawerOrganization} · ${drawerModel}` : 'Select a device row to inspect its telemetry.'}</p>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close device drawer">
            Close
          </button>
        </div>

        {!device ? (
          <p className="empty-state">No device selected.</p>
        ) : (
          <>
            <section className="drawer-identity">
              <div>
                <span>Device</span>
                <strong>{drawerName}</strong>
              </div>
              <div>
                <span>Serial</span>
                <strong>{drawerSerial}</strong>
              </div>
              <div>
                <span>Model</span>
                <strong>{drawerModel}</strong>
              </div>
              <div>
                <span>Organization</span>
                <strong>{drawerOrganization}</strong>
              </div>
            </section>

            {loading ? <p className="empty-state">Loading telemetry for this device.</p> : null}
            {!loading && (error || (telemetry && !telemetryAvailable)) ? (
              <section className="drawer-unavailable">
                <strong>Telemetry unavailable</strong>
                <p>{telemetryUnavailableText}</p>
              </section>
            ) : null}

            <section className="drawer-summary">
              <div className="summary-card">
                <span>Health</span>
                <StatusBadge value={normalizeStatusKey(telemetry?.health || device.health || 'unknown')} label={toTitleCase(telemetry?.health || device.health || 'unknown')} />
                <small>{telemetryAvailable ? `Signals: ${telemetry.signals?.length ? telemetry.signals.map(formatTelemetrySignal).join(', ') : 'none reported'}` : telemetryUnavailableText}</small>
              </div>
              <div className="summary-card">
                <span>Firmware</span>
                <strong>{drawerFirmware}</strong>
                <small>{telemetry?.recent_events?.[0]?.occurred_at ? `Last updated ${formatRelativeTime(telemetry.recent_events[0].occurred_at)}` : drawerLastSeen ? `Last seen ${formatRelativeTime(drawerLastSeen)}` : 'No update timestamp available.'}</small>
              </div>
              <div className="summary-card">
                <span>Active stream</span>
                <StatusBadge value={streamStatus.tone} label={streamStatus.label} />
                <small>{streamStatus.detail}</small>
              </div>
            </section>

            <SourceFactsTimeline facts={device.source_facts || []} />

            {telemetryAvailable ? <section className="drawer-charts">
              <TelemetryChart
                title="RSSI history"
                subtitle="Daily average dBm and quality bucket"
                samples={telemetry?.rssi_7d || []}
                valueKey="avg_dbm"
                valueFormatter={(value) => `${value} dBm`}
                tone="brand"
                ariaLabel="RSSI history sparkline"
                emptyLabel="No RSSI samples available."
                sampleLabel={(sample) => `${sample.date}: ${sample.avg_dbm} dBm (${toTitleCase(sample.quality)})`}
              />
              <TelemetryChart
                title="Uptime history"
                subtitle="Daily online percentage"
                samples={telemetry?.uptime_7d || []}
                valueKey="online_pct"
                valueFormatter={(value) => `${value.toFixed(1)}%`}
                tone="accent"
                ariaLabel="Uptime history sparkline"
                emptyLabel="No uptime samples available."
                sampleLabel={(sample) => `${sample.date}: ${sample.online_pct.toFixed(1)}% online`}
              />
            </section> : null}

            <section className="drawer-events">
              <div className="panel-head">
                <div>
                  <h3>Recent events</h3>
                  <p>Last 10 telemetry events from this device.</p>
                </div>
              </div>
              {telemetryAvailable && telemetry?.recent_events?.length ? (
                <div className="event-list">
                  {telemetry.recent_events.map((event) => (
                    <article className="event-row" key={`${event.occurred_at}:${event.event_type}`}>
                      <div>
                        <strong>{formatTelemetryEventType(event.event_type)}</strong>
                        <span>{event.summary}</span>
                      </div>
                      <time title={event.occurred_at}>{formatRelativeTime(event.occurred_at)}</time>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-state">{telemetryAvailable ? 'No recent telemetry events available.' : telemetryUnavailableText}</p>
              )}
            </section>

            <div className="drawer-actions">
              <button type="button" disabled={!provisionState.enabled} title={provisionState.reason} onClick={() => runDrawerAction('provision')}>Provision device</button>
              <button type="button" className="destructive" disabled={!deactivateState.enabled} title={deactivateState.reason} onClick={() => runDrawerAction('deactivate')}>Deactivate device</button>
              <small>{!provisionState.enabled ? provisionState.reason : !deactivateState.enabled ? deactivateState.reason : 'Actions are queued through lifecycle orchestration.'}</small>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function SourceFactsTimeline({ facts }) {
  return (
    <section className="source-facts">
      <h3>Readiness / Source Facts</h3>
      {facts.length ? facts.map((fact) => (
        <article className="source-fact" key={`${fact.layer}:${fact.operation_id || fact.updated_at || fact.state}`}>
          <div>
            <strong>{sourceFactLayerLabel(fact.layer)}</strong>
            <span>{sourceFactStateLabel(fact.state)}</span>
            <small>{fact.detail}</small>
          </div>
          <time>{fact.updated_at ? formatRelativeTime(fact.updated_at) : '—'}</time>
        </article>
      )) : (
        <p className="empty-state">No source facts available.</p>
      )}
    </section>
  );
}

function TelemetryChart({ title, subtitle, samples, valueKey, valueFormatter, tone, ariaLabel, emptyLabel, sampleLabel }) {
  const chart = useMemo(() => buildTelemetryChart(samples, valueKey), [samples, valueKey]);
  const latestSample = samples.length ? samples[samples.length - 1] : null;
  const latestValue = latestSample ? latestSample[valueKey] : null;

  return (
    <article className={`telemetry-card tone-${tone}`}>
      <div className="panel-head">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        {latestValue !== null && latestValue !== undefined ? <strong>{valueFormatter(latestValue)}</strong> : null}
      </div>
      {chart.points.length ? (
        <>
          <svg viewBox="0 0 420 126" className="sparkline-chart" role="img" aria-label={ariaLabel}>
            <defs>
              <linearGradient id={`sparkFill-${tone}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(0, 104, 183, 0.22)" />
                <stop offset="100%" stopColor="rgba(0, 104, 183, 0.03)" />
              </linearGradient>
            </defs>
            <polyline points={chart.areaPoints} className="sparkline-area" />
            <polyline points={chart.linePoints} className={`sparkline-line tone-${tone}`} />
            {chart.points.map((point, index) => (
              <circle
                key={`${point.label}-${index}`}
                cx={point.x}
                cy={point.y}
                r="3.5"
                className={`sparkline-dot tone-${tone}`}
              >
                <title>{sampleLabel(samples[index])}</title>
              </circle>
            ))}
          </svg>
          <div className="sparkline-foot">
            <span>{chart.minLabel}</span>
            <span>{chart.maxLabel}</span>
          </div>
        </>
      ) : (
        <p className="empty-state">{emptyLabel}</p>
      )}
    </article>
  );
}

function buildTelemetryChart(samples, valueKey) {
  if (!samples.length) {
    return { points: [], linePoints: '', areaPoints: '', minLabel: '-', maxLabel: '-' };
  }
  const values = samples
    .map((sample) => Number(sample[valueKey]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) {
    return { points: [], linePoints: '', areaPoints: '', minLabel: '-', maxLabel: '-' };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max === min ? 1 : max - min;
  const width = 360;
  const left = 24;
  const top = 18;
  const bottom = 92;
  const points = samples.map((sample, index) => {
    const value = Number(sample[valueKey]);
    const x = left + (index * width) / Math.max(samples.length - 1, 1);
    const normalized = Number.isFinite(value) ? (value - min) / range : 0.5;
    const y = bottom - normalized * (bottom - top);
    return {
      x,
      y,
      label: sample.date || `${index}`,
      value,
    };
  });
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(' ');
  const areaPoints = `${points.map((point) => `${point.x},${point.y}`).join(' ')} ${points.at(-1)?.x ?? left},108 ${points[0]?.x ?? left},108`;
  return {
    points,
    linePoints,
    areaPoints,
    minLabel: formatTelemetryChartValue(min, valueKey),
    maxLabel: formatTelemetryChartValue(max, valueKey),
  };
}

function formatTelemetryChartValue(value, valueKey) {
  if (valueKey === 'avg_dbm') return `${value} dBm`;
  if (valueKey === 'online_pct') return `${value.toFixed(1)}%`;
  return String(value);
}

function formatTelemetrySignal(signal) {
  const map = {
    low_rssi: 'Low RSSI',
    recent_reboot: 'Recent reboot',
    low_memory: 'Low memory',
    recent_crash: 'Recent crash',
    offline_risk: 'Offline risk',
  };
  return map[signal] || toTitleCase(signal);
}

function deriveStreamStatus(telemetry) {
  switch (telemetry?.active_stream_status) {
    case 'active':
      return { tone: 'healthy', label: 'Active', detail: 'Stream source reports an active session.' };
    case 'inactive':
      return { tone: 'inactive', label: 'Inactive', detail: 'Stream source reports no active session.' };
    case 'unavailable':
      return { tone: 'unknown', label: 'Unavailable', detail: telemetry?.unavailable_reason || 'Active stream status is unavailable.' };
    case 'unknown':
    default:
      return { tone: 'unknown', label: 'Unknown', detail: 'Active stream status is not provided by the source.' };
  }
}

function formatTelemetryEventType(eventType) {
  const map = {
    'device.health.summary': 'Health summary',
    'device.health.rssi_sample': 'RSSI sample',
    'device.health.memory_sample': 'Memory sample',
    'device.health.offline_risk': 'Offline risk',
    'device.reboot.reported': 'Device reboot',
    'device.crash.reported': 'Device crash',
    'firmware.version.observed': 'Firmware observed',
  };
  if (map[eventType]) return map[eventType];
  return toTitleCase(String(eventType || '').replaceAll(/[._]/g, ' '));
}

function Operations({ operations }) {
  const [stateFilter, setStateFilter] = useState('all');
  const filteredOperations = useMemo(() => {
    if (stateFilter === 'all') return operations;
    const filter = stateFilter.toLowerCase();
    return operations.filter((operation) => operation.state === filter);
  }, [operations, stateFilter]);

  const columns = useMemo(() => [
    {
      key: 'summary',
      label: 'Friendly Summary',
      value: (operation) => operationSummary(operation),
      render: (operation) => (
        <div className="operation-summary">
          <strong>{operationSummary(operation)}</strong>
          <span className="operation-summary__raw">
            <small>Raw type: {operation.type}</small>
            <small>Raw state: <StatusBadge value={operation.state} /></small>
          </span>
        </div>
      ),
    },
    { key: 'organization', label: 'Customer', value: (operation) => operation.organization },
    { key: 'device_name', label: 'Device', value: (operation) => operation.device_name },
    { key: 'updated_at', label: 'Updated', value: (operation) => operation.updated_at },
    { key: 'message', label: 'Message', value: (operation) => operation.message },
  ], []);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Lifecycle operations</h2>
          <p>Provisioning and deactivation commands projected from account/video contracts.</p>
        </div>
        <label className="operation-filter">
          <span>State</span>
          <select
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)}
            aria-label="Filter operations by state"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="dead_lettered">Dead Lettered</option>
          </select>
        </label>
      </div>
      <DataTable
        columns={columns}
        rows={filteredOperations}
        rowKey={(operation) => operation.id}
        initialSortKey="updated_at"
        initialDirection="desc"
        searchPlaceholder="Search operations"
        emptyLabel="No operations match the current filter."
        tableClassName="operations-table"
      />
    </section>
  );
}

function OperationList({ operations, detailed = false }) {
  if (!operations.length) return <p>No operations.</p>;
  return (
    <div className="operation-list">
      {operations.map((operation) => (
        <article key={operation.id} className="operation">
          <div>
            <strong>{operation.type}</strong>
            <span>{operation.organization} / {operation.device_name}</span>
            {detailed ? <p>{operation.message}</p> : null}
          </div>
          <StatusBadge value={operation.state} />
        </article>
      ))}
    </div>
  );
}

function PlatformAdmin({ summary, health, devices, customers, operations, audit, me, onSSOStart, onBreakGlassLogin }) {
  const customerCount = summary?.customers ?? '-';
  return (
    <>
      {me?.kind !== 'platform_admin' ? (
        <>
          <SSOLoginPanel title="Platform SSO sign in" onSSOStart={onSSOStart} />
          {shouldShowBreakGlass(me) ? (
            <BreakGlassLoginPanel title="Break-glass platform access" onLogin={onBreakGlassLogin} />
          ) : null}
        </>
      ) : null}
      <section className="panel split-panel">
        <div>
          <h2>Platform Operations</h2>
          <p>Cross-customer view for support and service operators.</p>
          <div className="admin-kpis">
            <div><strong>{customerCount}</strong><span>Customers</span></div>
            <div><strong>{devices.length}</strong><span>Devices cached</span></div>
          </div>
        </div>
        <ServiceHealth health={health} compact />
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Lifecycle operations</h2>
            <p>Cross-customer provisioning and deactivation activity.</p>
          </div>
        </div>
        <OperationList operations={operations} detailed />
      </section>
      <Customers customers={customers} />
      <AuditLog audit={audit.slice(0, 5)} compact />
    </>
  );
}

function AuditLog({ audit, compact = false }) {
  const columns = useMemo(() => [
    { key: 'action', label: 'Action', value: (event) => event.action },
    { key: 'actor', label: 'Actor', value: (event) => event.actor },
    { key: 'target', label: 'Target', value: (event) => event.target },
    { key: 'created_at', label: 'Created', value: (event) => event.created_at },
  ], []);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{compact ? 'Recent audit' : 'Audit log'}</h2>
          <p>Local operator actions captured by the Go BFF.</p>
        </div>
      </div>
      {compact && audit.length ? (
        <div className="audit-list">
          {audit.map((event) => (
            <article className="audit-event" key={event.id}>
              <div>
                <strong>{event.action}</strong>
                <span>{event.actor} / {event.target}</span>
                <small>{[event.actor_kind, event.organization_id, event.result, event.upstream_operation_id].filter(Boolean).join(' / ')}</small>
              </div>
              <time>{event.created_at}</time>
            </article>
          ))}
        </div>
      ) : compact ? (
        <p>No audit events yet.</p>
      ) : (
        <DataTable
          columns={columns}
          rows={audit}
          rowKey={(event) => event.id}
          initialSortKey="created_at"
          initialDirection="desc"
          searchPlaceholder="Search audit"
          emptyLabel="No audit events match the current filter."
          tableClassName="audit-table"
        />
      )}
    </section>
  );
}

function DataTable({
  columns,
  rows,
  rowKey,
  initialSortKey,
  initialDirection = 'asc',
  searchPlaceholder,
  emptyLabel,
  rowClassName,
  onRowClick,
  tableClassName = '',
  pageSize = DEFAULT_PAGE_SIZE,
}) {
  const {
    filter,
    setFilter,
    sort,
    requestSort,
    visibleRows,
    totalRows,
    page,
    maxPage,
    setPage,
  } = useTableControls(rows, columns, initialSortKey, initialDirection, pageSize);

  return (
    <>
      <div className="table-toolbar">
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={searchPlaceholder} />
        <span>{totalRows} of {rows.length}</span>
      </div>
      <table className={tableClassName}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>
                {column.sortable === false ? (
                  column.label
                ) : (
                  <button className="sort-button" onClick={() => requestSort(column.key)}>
                    <span>{column.label}</span>
                    <span aria-hidden="true">{sort.key === column.key ? (sort.direction === 'asc' ? '^' : 'v') : '-'}</span>
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr
              key={rowKey(row)}
              className={[onRowClick ? 'clickable-row' : '', rowClassName ? rowClassName(row) : ''].filter(Boolean).join(' ')}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td key={column.key}>{column.render ? column.render(row) : displayValue(column.value(row))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!visibleRows.length ? <p className="empty-table">{emptyLabel}</p> : null}
      <div className="pagination">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page} of {maxPage}</span>
        <button disabled={page >= maxPage} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </>
  );
}

function useTableControls(rows, columns, initialSortKey, initialDirection, pageSize) {
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState({ key: initialSortKey, direction: initialDirection });
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [filter, rows]);

  const filteredRows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      columns.some((column) => String(column.value(row) ?? '').toLowerCase().includes(needle)),
    );
  }, [columns, filter, rows]);

  const sortedRows = useMemo(() => {
    const column = columns.find((candidate) => candidate.key === sort.key) || columns[0];
    const direction = sort.direction === 'desc' ? -1 : 1;
    return [...filteredRows].sort((left, right) => compareValues(column.value(left), column.value(right)) * direction);
  }, [columns, filteredRows, sort]);

  const maxPage = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, maxPage);
  const start = (safePage - 1) * pageSize;
  const visibleRows = sortedRows.slice(start, start + pageSize);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  function requestSort(key) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  return {
    filter,
    setFilter,
    sort,
    requestSort,
    visibleRows,
    totalRows: sortedRows.length,
    page: safePage,
    maxPage,
    setPage,
  };
}

function compareValues(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined || left === '') return 1;
  if (right === null || right === undefined || right === '') return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  return value;
}

function ServiceHealth({ health, compact = false }) {
  return (
    <section className={compact ? 'health compact' : 'panel health'}>
      {!compact ? <h2>Service health</h2> : null}
      {health.map((item) => (
        <div className="health-row" key={item.name}>
          <strong>{item.name}</strong>
          <StatusBadge value={item.status} />
          <span>{item.detail}</span>
          {item.latency_ms ? <small>{item.latency_ms} ms</small> : null}
          {item.last_checked_at ? <time>{item.last_checked_at}</time> : null}
        </div>
      ))}
    </section>
  );
}

function SSOLoginPanel({ title, onSSOStart }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSSOStart(email);
    } catch (_) {
      setBusy(false);
    }
  }
  return (
    <section className="panel login-panel">
      <div>
        <h2>{title}</h2>
        <p>Use your organization email to continue through Account Manager SSO.</p>
      </div>
      <form onSubmit={submit}>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required />
        <button type="submit" disabled={busy}>{busy ? 'Redirecting' : 'Continue with SSO'}</button>
      </form>
    </section>
  );
}

function BreakGlassLoginPanel({ title, onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <section className="panel login-panel">
      <div>
        <h2>{title}</h2>
        <p>Emergency local admin access for SSO or Account Manager outage recovery.</p>
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        onLogin({ email, password });
      }}>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Break-glass email" />
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" />
        <button type="submit">Use break-glass</button>
      </form>
    </section>
  );
}

function StatusBadge({ value, label }) {
  const text = label ?? value;
  return <span className={`status status-${String(value).replaceAll('_', '-')}`}>{text}</span>;
}

function formatReadinessLabel(readiness) {
  const map = {
    registered: 'Registered',
    cloud_activation_pending: 'Cloud Activation',
    activated: 'Activated',
    online: 'Online',
    offline: 'Offline',
  };
  if (readiness === null || readiness === undefined) return 'Unknown';
  return map[readiness] || toTitleCase(String(readiness).replaceAll('_', ' '));
}

function formatHealthLabel(health) {
  if (health === null || health === undefined || health === '') return 'Unknown';
  return toTitleCase(String(health).replaceAll('_', ' '));
}

function getActiveMembership(me) {
  if (!me?.authenticated) return null;
  const memberships = me.memberships || [];
  if (!memberships.length) return null;
  return memberships.find((membership) => membership.organization_id === me.active_org_id) || memberships[0];
}

function upsertProvider(providers, provider) {
  if (!provider?.organization_id) return providers;
  const next = [...providers];
  const index = next.findIndex((item) => item.organization_id === provider.organization_id);
  if (index >= 0) {
    next[index] = provider;
  } else {
    next.push(provider);
  }
  return next;
}

function initialsForEmail(email) {
  if (!email) return 'FM';
  const name = String(email).split('@')[0].replace(/[._-]+/g, ' ').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || 'F').toUpperCase() + (parts[1]?.[0] || parts[0]?.[1] || 'M').toUpperCase();
}

function latestCustomerUpdate(devices, alerts) {
  const values = [
    ...devices.map((device) => device.updated_at || device.last_seen_at).filter(Boolean),
    ...alerts.map((alert) => alert.occurred_at).filter(Boolean),
  ];
  return values.sort().at(-1) || '';
}

function sessionLabel(me) {
  if (!me?.authenticated) return 'Not signed in';
  if (me.kind === 'platform_admin') return 'Platform Admin · All tenants';
  const membership = getActiveMembership(me);
  return `${roleLabel(membership?.role)} · ${membership?.organization || me.active_org_id || 'Active organization'}`;
}

function roleLabel(role) {
  const normalized = String(role || '').toLowerCase().replaceAll('-', '_');
  const labels = {
    owner: 'Fleet Owner',
    admin: 'Fleet Admin',
    manager: 'Fleet Manager',
    operator: 'Fleet Operator',
    viewer: 'Read-only Observer',
    observer: 'Read-only Observer',
    read_only: 'Read-only Observer',
    readonly: 'Read-only Observer',
  };
  return labels[normalized] || toTitleCase(role || 'Customer User');
}

function sourceFactLayerLabel(layer) {
  const map = {
    account_registry: 'Account Registry',
    cloud_activation: 'Cloud Activation',
    transport_online: 'Transport Online',
    device_facts: 'Device Facts',
  };
  return map[layer] || toTitleCase(String(layer || 'unknown').replaceAll('_', ' '));
}

function sourceFactStateLabel(state) {
  const map = {
    present: 'Registered',
    activated: 'Activated',
    online: 'Online',
    failed: 'Failed',
    missing: 'Missing',
    pending: 'Pending',
    stale: 'Stale',
  };
  return map[state] || toTitleCase(String(state || 'unknown').replaceAll('_', ' '));
}

function buildAttentionQueue(devices, alerts) {
  const alertByDevice = new Map();
  for (const alert of alerts) {
    if (!alertByDevice.has(alert.device_id)) {
      alertByDevice.set(alert.device_id, alert);
    }
  }
  return devices
    .map((device) => {
      const health = String(device.health || '').toLowerCase();
      const signal = String(device.signal_quality || '').toLowerCase();
      const readiness = String(device.readiness || '').toLowerCase();
      const alert = alertByDevice.get(device.id);
      let issue = alert?.signal ? formatTelemetrySignal(alert.signal) : 'Health needs review';
      let tone = 'warn';
      let score = 0;
      if (health === 'critical' || readiness === 'failed') {
        issue = alert?.signal ? formatTelemetrySignal(alert.signal) : 'Device offline';
        tone = 'danger';
        score += 100;
      } else if (health === 'warning' || signal === 'poor') {
        issue = signal === 'poor' ? 'Poor signal quality' : issue;
        score += 50;
      } else if (readiness.includes('pending') || signal === 'fair') {
        issue = signal === 'fair' ? 'Signal needs review' : 'Readiness pending';
        score += 20;
      }
      if (!score) return null;
      return {
        device_id: device.id,
        device_name: device.name,
        issue,
        tone,
        since: alert?.occurred_at ? formatRelativeTime(alert.occurred_at) : device.last_seen_at ? formatRelativeTime(device.last_seen_at) : '—',
        score,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.device_name.localeCompare(right.device_name));
}

function buildStreamAttentionItems(devices) {
  return devices
    .map((device) => {
      const health = String(device.health || 'unknown').toLowerCase();
      const signal = String(device.signal_quality || '').toLowerCase();
      const readiness = String(device.readiness || '').toLowerCase();
      if (health === 'critical') return { device_id: device.id, device_name: device.name, health, issue: 'Low success rate or offline risk' };
      if (signal === 'poor') return { device_id: device.id, device_name: device.name, health, issue: 'Intermittent stream signal' };
      if (readiness !== 'online' && readiness !== 'activated') return { device_id: device.id, device_name: device.name, health, issue: 'Never streamed or not ready' };
      return null;
    })
    .filter(Boolean)
    .slice(0, 5);
}

function formatTierLabel(tier) {
  if (!tier) return 'Unknown';
  if (tier === 'evaluation') return 'Evaluation';
  if (tier === 'commercial') return 'Commercial';
  return toTitleCase(String(tier).replaceAll('_', ' '));
}

function passwordStrength(password) {
  if (!password) return 'Empty';
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return ['Weak', 'Fair', 'Good', 'Strong', 'Excellent'][Math.min(score, 4)];
}

function normalizeStatusKey(value) {
  if (value === null || value === undefined || value === '') return 'unknown';
  return String(value).toLowerCase().replaceAll(' ', '-');
}

function toTitleCase(value) {
  return String(value)
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function operationSummary(operation) {
  const typeSummary = operationTypeSummary(operation.type);
  const stateSummary = operationStateSummary(operation.state);
  return stateSummary ? `${typeSummary} — ${stateSummary}` : typeSummary;
}

function operationTypeSummary(type) {
  const map = {
    DeviceProvisionRequested: 'Provisioning requested',
    DeviceProvisionRequestedFailed: 'Provisioning failed',
    DeviceProvisionSucceeded: 'Provisioning succeeded',
    DeviceDeactivateRequested: 'Deactivation requested',
    DeviceDeactivateRequestedFailed: 'Deactivation failed',
    DeviceDeactivateSucceeded: 'Deactivation succeeded',
  };
  if (map[type]) return map[type];
  return toTitleCase(String(type).replaceAll(/[._]/g, ' '));
}

function operationStateSummary(state) {
  const map = {
    pending: 'Pending',
    published: 'Published',
    succeeded: 'Succeeded',
    failed: 'Failed',
    retrying: 'Retrying',
    dead_lettered: 'Failed after retries — needs investigation',
  };
  return map[(state || '').toLowerCase()];
}

class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.isAuthError = true;
  }
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (response.status === 401) throw new AuthError(401, 'Session expired; please sign in again.');
  if (response.status === 403) throw new AuthError(403, 'Access denied.');
  if (!response.ok) throw new Error(`${url} failed with ${response.status}`);
  return response.json();
}

async function fetchRecentAlerts(devices) {
  if (!devices.length) return [];
  const settled = await Promise.allSettled(
    devices.map((device) => fetchJSON(`/api/devices/${device.id}/telemetry`)),
  );
  const alerts = [];
  settled.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const device = devices[index];
    const telemetry = result.value || {};
    for (const event of telemetry.recent_events || []) {
      alerts.push({
        id: `${device.id}:${event.occurred_at}:${event.event_type}`,
        occurred_at: event.occurred_at,
        device_name: device.name,
        signal: alertSignalLabel(event.event_type, event.summary),
        health: telemetry.health || 'unknown',
      });
    }
  });
  alerts.sort((left, right) => compareValues(right.occurred_at, left.occurred_at));
  return alerts.slice(0, 10);
}

function alertSignalLabel(eventType, summary) {
  const map = {
    'device.health.rssi_sample': 'Low RSSI',
    'device.health.summary': 'Health summary',
    'device.health.memory_sample': 'Memory sample',
    'device.health.offline_risk': 'Offline risk',
    'device.reboot.reported': 'Recent reboot',
    'device.crash.reported': 'Recent crash',
    'firmware.version.observed': 'Firmware observed',
  };
  if (map[eventType]) return map[eventType];
  if (summary) return summary;
  return toTitleCase(String(eventType || '').replaceAll(/[._]/g, ' '));
}

function formatPercent(value) {
  if (value === null || value === undefined || value === '-') return '-';
  if (typeof value !== 'number') return value;
  return `${value.toFixed(1)}%`;
}

function formatDurationMinutes(seconds) {
  if (seconds === null || seconds === undefined || seconds === '-') return '-';
  if (typeof seconds !== 'number') return seconds;
  return `${(seconds / 60).toFixed(1)} min`;
}

function formatRelativeTime(iso) {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return iso || '-';
  const deltaSeconds = Math.round((Date.now() - timestamp) / 1000);
  const abs = Math.abs(deltaSeconds);
  if (abs < 60) return deltaSeconds >= 0 ? `${abs}s ago` : `in ${abs}s`;
  const minutes = Math.round(abs / 60);
  if (minutes < 60) return deltaSeconds >= 0 ? `${minutes}m ago` : `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return deltaSeconds >= 0 ? `${hours}h ago` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return deltaSeconds >= 0 ? `${days}d ago` : `in ${days}d`;
}

function buildFleetTrendChart(trend) {
  if (!trend.length) {
    return { points: [], onlinePoints: '', alertPoints: '', grid: [], maxPct: 100, maxAlerts: 0, labelStep: 1 };
  }
  const width = 624;
  const height = 184;
  const top = 28;
  const bottom = 228;
  const maxAlerts = Math.max(
    ...trend.map((point) => trendPointValue(point, 'warning_count', 'WarningCount') + trendPointValue(point, 'critical_count', 'CriticalCount')),
    1,
  );
  const points = trend.map((point, index) => {
    const x = 52 + (index * width) / Math.max(trend.length - 1, 1);
    const onlinePct = trendPointValue(point, 'online_pct', 'OnlinePct');
    const warningCount = trendPointValue(point, 'warning_count', 'WarningCount');
    const criticalCount = trendPointValue(point, 'critical_count', 'CriticalCount');
    const onlineY = bottom - ((onlinePct || 0) / 100) * (bottom - top);
    const alerts = warningCount + criticalCount;
    const alertY = bottom - ((alerts / maxAlerts) * (bottom - top));
    return {
      date: point.date || point.Date,
      label: formatTrendLabel(point.date || point.Date),
      x,
      onlineY,
      alertY,
    };
  });
  return {
    points,
    onlinePoints: points.map((point) => `${point.x},${point.onlineY}`).join(' '),
    alertPoints: points.map((point) => `${point.x},${point.alertY}`).join(' '),
    grid: [68, 108, 148, 188],
    maxPct: 100,
    maxAlerts,
    labelStep: Math.max(1, Math.ceil(points.length / 6)),
  };
}

function buildStreamHealthChart(trend, modeTrends) {
  if (!trend.length) {
    return { points: [], requestBars: [], overallPoints: '', modeSeries: [], grid: [], maxRequests: 0, labelStep: 1 };
  }
  const width = 624;
  const top = 28;
  const bottom = 228;
  const maxRequests = Math.max(...trend.map((point) => trendPointValue(point, 'requests', 'Requests')), 1);
  const points = trend.map((point, index) => {
    const x = 52 + (index * width) / Math.max(trend.length - 1, 1);
    const requests = trendPointValue(point, 'requests', 'Requests');
    const successPct = trendPointValue(point, 'success_rate_pct', 'SuccessRatePct');
    const overallY = bottom - ((successPct || 0) / 100) * (bottom - top);
    const barHeight = (requests / maxRequests) * (bottom - top);
    return {
      date: point.date || point.Date,
      label: formatTrendLabel(point.date || point.Date),
      x,
      overallY,
      requestBarX: x - 5,
      requestBarY: bottom - barHeight,
      requestBarHeight: barHeight,
    };
  });
  const modeOrder = ['webrtc'];
  const modeSeries = modeOrder.map((mode) => {
    const series = modeTrends.find((item) => String(item.mode || item.Mode || '').toLowerCase() === mode);
    const pointsForMode = (series?.points || series?.Points || []).map((point, index) => {
      const x = 52 + (index * width) / Math.max(trend.length - 1, 1);
      const successPct = trendPointValue(point, 'success_rate_pct', 'SuccessRatePct');
      const y = bottom - ((successPct || 0) / 100) * (bottom - top);
      return `${x},${y}`;
    });
    return {
      mode,
      className: `chart-line-${mode}`,
      points: pointsForMode.join(' '),
    };
  });
  return {
    points,
    requestBars: points.filter((point) => point.requestBarHeight > 0).map((point) => ({
      date: point.date,
      x: point.requestBarX,
      y: point.requestBarY,
      width: 10,
      height: point.requestBarHeight,
    })),
    overallPoints: points.map((point) => `${point.x},${point.overallY}`).join(' '),
    modeSeries,
    grid: [68, 108, 148, 188],
    maxRequests,
    labelStep: Math.max(1, Math.ceil(points.length / 6)),
  };
}

function streamModeLabel(mode) {
  const key = String(mode || '').toLowerCase();
  const map = {
    webrtc: 'WebRTC',
  };
  return map[key] || toTitleCase(String(mode || '').replaceAll('_', ' '));
}

function trendPointValue(point, snakeKey, camelKey) {
  const snake = point?.[snakeKey];
  if (snake !== undefined && snake !== null) return snake;
  const camel = point?.[camelKey];
  if (camel !== undefined && camel !== null) return camel;
  return 0;
}

function formatTrendLabel(date) {
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) return date;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(parsed));
}

function deviceIdFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return params.get('device') || '';
}

function filterLabelFromQuery(value) {
  return toTitleCase(String(value || '').replaceAll(/[_-]/g, ' '));
}

function filterQueryValue(value) {
  if (!value || value === 'All') return '';
  return String(value).toLowerCase().replaceAll(/\s+/g, '_');
}

function updateDevicesLocation({ deviceId, health, status, signal, firmware } = {}) {
  const current = new URLSearchParams(window.location.search);
  const path = devicesPathWithFilters({
    deviceId: deviceId === undefined ? current.get('device') || '' : deviceId,
    health: health === undefined ? current.get('health') || '' : health,
    status: status === undefined ? current.get('status') || '' : status,
    signal: signal === undefined ? current.get('signal') || '' : signal,
    firmware: firmware === undefined ? current.get('firmware') || '' : firmware,
  });
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

createRoot(document.getElementById('root')).render(<App />);
