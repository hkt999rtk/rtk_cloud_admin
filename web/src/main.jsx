import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { customerNavItems, platformNavItems, routeFromLocation, titleFor } from './routes.mjs';
import { postJSON } from './http.mjs';
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
          setLoading(false);
          return;
        }

        const prefix = useAdminApi ? '/api/admin' : '/api';
        const baseRequests = [
          fetchJSON(`${prefix}/summary`),
          fetchJSON(`${prefix}/customers`),
          fetchJSON(`${prefix}/devices`),
          fetchJSON(`${prefix}/operations`),
          fetchJSON(`${prefix}/service-health`),
          fetchJSON(`${prefix}/audit`),
        ];
        const [nextSummary, nextCustomers, nextDevices, nextOperations, nextHealth, nextAudit] = await Promise.all(baseRequests);
        if (!alive) return;
        setSummary(nextSummary);
        setCustomers(nextCustomers);
        setDevices(nextDevices);
        setOperations(nextOperations);
        setHealth(nextHealth);
        setAudit(nextAudit);
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
    updateDevicesLocation({ deviceId: '', health: '', firmware: version });
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
    window.history.pushState({}, '', '/console/operations');
    setActive('operations');
  }

  async function handleLogin(kind, credentials) {
    setError('');
    const url = kind === 'platform' ? '/api/auth/platform/login' : '/api/auth/customer/login';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (!response.ok) {
      setError(`${kind} login failed with ${response.status}`);
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
          <span className="brand-logo-shell">
            <img src="/assets/realtek-logo.png" alt="Realtek" />
          </span>
          <div>
            <strong>Connect+</strong>
            <small>Admin Console</small>
          </div>
        </div>
        <div className="view-switcher">
          <small>Workspace</small>
          <div className="view-switcher-buttons">
            <button className={!isPlatformView ? 'active' : ''} onClick={() => switchView('customer')}>
              Customer View
            </button>
            <button className={isPlatformView ? 'active' : ''} onClick={() => switchView('platform')}>
              Platform View
            </button>
          </div>
        </div>
        <nav>
          {visibleNavItems.map((item) => (
            <button
              key={item.id}
              className={active === item.id ? 'active' : ''}
              onClick={() => navigate(item)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Tenant-first B2B operations</p>
            <h1>{titleFor(active)}</h1>
          </div>
          <div className="session-strip">
            <span>{me?.authenticated ? `${me.email} / ${me.kind}` : 'Demo mode'}</span>
            {me?.kind === 'customer' && (me?.memberships?.length ?? 0) > 1 ? (
              <select
                className="org-switcher"
                value={me.active_org_id || ''}
                onChange={(e) => handleSwitchOrg(e.target.value)}
              >
                {(me.memberships || []).map((m) => (
                  <option key={m.organization_id} value={m.organization_id}>{m.organization}</option>
                ))}
              </select>
            ) : (
              <span>{me?.active_org_id || 'all orgs'}</span>
            )}
            {me?.authenticated ? <button onClick={handleLogout}>Logout</button> : null}
          </div>
        </header>

        {error ? <div className="error">{error}</div> : null}

        {needsPlatformAccess ? <PlatformAccessGate active={active} onLogin={handleLogin} /> : null}
        {!needsPlatformAccess && active === 'overview' ? (
          <Overview
            summary={summary}
            fleetHealth={fleetHealth}
            streamStats={streamStats}
            recentAlerts={recentAlerts}
            overviewWindow={overviewWindow}
            setOverviewWindow={setOverviewWindow}
            me={me}
            loading={loading}
            onLogin={handleLogin}
            onHealthFilter={filterDevicesByHealth}
            onRequestQuotaRaise={handleQuotaRaiseRequest}
          />
        ) : null}
        {!needsPlatformAccess && active === 'devices' ? (
          <Devices
            active={active}
            devices={devices}
            selectedDevice={selectedDevice}
            deviceDrawerOpen={deviceDrawerOpen}
            setSelectedDeviceId={selectDevice}
            closeDeviceDrawer={closeDeviceDrawer}
            onAction={runDeviceAction}
          />
        ) : null}
        {!needsPlatformAccess && active === 'firmware-ota' ? (
          <FirmwareOTAPage
            loading={loading}
            distribution={firmwareDistribution}
            onViewDevices={openDevicesForFirmware}
          />
        ) : null}
        {!needsPlatformAccess && active === 'operations' ? <Operations operations={operations} /> : null}
        {!needsPlatformAccess && active === 'stream-health' ? (
          <StreamHealthPage
            loading={loading}
            stats={streamStats}
            streamWindow={streamWindow}
            setWindow={setStreamWindow}
          />
        ) : null}
        {!needsPlatformAccess && active === 'groups' ? <GroupsPage /> : null}
        {!needsPlatformAccess && active === 'platform-health' ? <PlatformHealth summary={summary} health={health} /> : null}
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
  onLogin,
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
  const onlineRate = fleetHealth?.online_rate_7d_pct ?? '-';
  const needsAttention = current.warning !== undefined || current.critical !== undefined
    ? (current.warning || 0) + (current.critical || 0)
    : '-';
  const activeStreams = streamStats?.active_sessions ?? '-';

  return (
    <div className="overview-layout">
      <section className="panel hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Customer View</p>
          <h2>Fleet Health Overview</h2>
          <p>Single-glance fleet health, trend, and alert awareness for Tier 2 operators.</p>
        </div>
        {!me?.authenticated ? <LoginPanel mode="customer" title="Customer Account Manager login" onLogin={onLogin} /> : null}
      </section>

      <section className="metrics overview-metrics">
        <MetricCard label="Online" value={onlineCount} hint={summary ? `${summary.total_devices ?? 0} total devices` : 'Waiting for summary data'} tone="good" />
        <MetricCard label="Online Rate (7d)" value={formatPercent(onlineRate)} hint={fleetHealth ? 'Daily online share across the current window' : 'Sign in to load fleet health'} tone="info" />
        <MetricCard label="Needs Attention" value={needsAttention} hint={fleetHealth ? 'Devices in warning or critical health' : 'No health summary yet'} tone={needsAttention === 0 ? 'good' : 'warn'} />
        <MetricCard label="Active Streams" value={activeStreams} hint={streamStats ? 'Open sessions right now' : 'Stream stats unavailable'} tone="info" />
      </section>

      <section className="overview-grid">
        <FleetHealthTrendPanel
          loading={loading}
          trend={fleetHealth?.trend || []}
          window={overviewWindow}
          onWindowChange={setOverviewWindow}
        />
        <HealthDistributionPanel
          loading={loading}
          current={fleetHealth?.current}
          onFilter={onHealthFilter}
        />
      </section>

      <section className="panel split-panel">
        <div>
          <h2>Tier and quota</h2>
          <p>{me?.authenticated ? `${tierLabel} account for ${activeMembership?.organization || 'your active organization'}.` : 'Sign in to see the current tier and quota for your organization.'}</p>
          {me?.authenticated ? <div className="quota-pill">{tierLabel} {isEvaluation ? quotaRatio : 'Contact sales'}</div> : null}
          {nearQuota ? <p className="auth-status">This fleet is near its evaluation cap. Request a higher limit before the next device is added.</p> : null}
        </div>
        {me?.authenticated && isEvaluation ? (
          <QuotaRaiseForm
            organizationId={activeMembership?.organization_id}
            organizationName={activeMembership?.organization}
            currentQuota={quotaLimit}
            onSubmit={onRequestQuotaRaise}
          />
        ) : null}
      </section>

      <RecentAlertsPanel loading={loading} alerts={recentAlerts} />
    </div>
  );
}

function FirmwareOTAPage({ loading, distribution, onViewDevices }) {
  const [expandedCampaignId, setExpandedCampaignId] = useState('');
  const versions = distribution?.versions || [];
  const campaigns = distribution?.campaigns || [];
  const totalDevices = versions.reduce((sum, version) => sum + (version.count || 0), 0);
  const activeCampaigns = campaigns.filter((campaign) => ['active', 'scheduled'].includes(String(campaign.state || '').toLowerCase())).length;

  useEffect(() => {
    if (campaigns.length === 0) {
      setExpandedCampaignId('');
      return;
    }
    if (!expandedCampaignId || !campaigns.some((campaign) => campaign.campaign_id === expandedCampaignId)) {
      setExpandedCampaignId(campaigns[0].campaign_id);
    }
  }, [campaigns, expandedCampaignId]);

  const latestVersion = versions.find((version) => version.is_latest)?.version || versions[0]?.version || '—';

  return (
    <section className="panel firmware-ota-page">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Customer View</p>
          <h2>Firmware &amp; OTA</h2>
          <p>Track which firmware versions are live across the fleet and how each OTA campaign is progressing.</p>
        </div>
        <div className="firmware-page-metrics">
          <div>
            <strong>{totalDevices}</strong>
            <span>Devices</span>
          </div>
          <div>
            <strong>{versions.length}</strong>
            <span>Versions</span>
          </div>
          <div>
            <strong>{activeCampaigns}</strong>
            <span>Active campaigns</span>
          </div>
          <div>
            <strong>{latestVersion}</strong>
            <span>Latest version</span>
          </div>
        </div>
      </div>

      {loading && !distribution ? <p className="empty-state">Loading firmware distribution.</p> : null}

      {distribution ? (
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

          <section className="panel firmware-panel">
            <div className="panel-head">
              <div>
                <h3>OTA campaigns</h3>
                <p>Click a campaign to inspect its device-level rollout breakdown.</p>
              </div>
            </div>
            {campaigns.length ? (
              <div className="firmware-campaign-list">
                {campaigns.map((campaign) => {
                  const expanded = expandedCampaignId === campaign.campaign_id;
                  return (
                    <article key={campaign.campaign_id} className={`firmware-campaign${expanded ? ' is-expanded' : ''}`}>
                      <button
                        type="button"
                        className="firmware-campaign__header"
                        onClick={() => setExpandedCampaignId(expanded ? '' : campaign.campaign_id)}
                      >
                        <div className="firmware-campaign__title">
                          <strong>{campaign.campaign_id}</strong>
                          <span>{campaign.target_version}</span>
                        </div>
                        <StatusBadge value={normalizeStatusKey(campaign.state)} label={toTitleCase(campaign.state || 'unknown')} />
                      </button>

                      <div className="firmware-campaign__summary">
                        <div>
                          <span>Policy</span>
                          <strong>{campaign.policy || 'normal'}</strong>
                        </div>
                        <div>
                          <span>Started</span>
                          <strong>{campaign.started_at ? formatRelativeTime(campaign.started_at) : '—'}</strong>
                        </div>
                        <div className="firmware-progress">
                          <div className="firmware-progress__bar" aria-hidden="true">
                            <span style={{ width: `${campaign.total ? Math.max((campaign.applied / campaign.total) * 100, campaign.applied ? 8 : 0) : 0}%` }} />
                          </div>
                          <small>{campaign.applied} applied of {campaign.total || 0}</small>
                        </div>
                      </div>

                      <div className="firmware-campaign__counts">
                        <span>Applied {campaign.applied}</span>
                        <span>Pending {campaign.pending}</span>
                        <span>Failed {campaign.failed}</span>
                        <span>Skipped {campaign.skipped}</span>
                      </div>

                      {expanded ? (
                        <div className="firmware-rollout-table">
                          {campaign.rollouts?.length ? (
                            <>
                              <div className="firmware-rollout-table__head">
                                <span>Device</span>
                                <span>Current</span>
                                <span>Target</span>
                                <span>Status</span>
                                <span>Reason</span>
                                <span>Updated</span>
                              </div>
                              {campaign.rollouts.map((rollout) => (
                                <div className="firmware-rollout-table__row" key={`${campaign.campaign_id}:${rollout.device_id}`}>
                                  <strong>{rollout.device_name || rollout.device_id}</strong>
                                  <span>{rollout.current_version || '—'}</span>
                                  <span>{rollout.target_version || campaign.target_version || '—'}</span>
                                  <StatusBadge value={normalizeStatusKey(rollout.rollout_status)} label={toTitleCase(rollout.rollout_status || 'pending')} />
                                  <span>{rollout.failure_reason || '—'}</span>
                                  <time title={rollout.last_updated}>{rollout.last_updated ? formatRelativeTime(rollout.last_updated) : '—'}</time>
                                </div>
                              ))}
                            </>
                          ) : (
                            <p className="empty-state">No rollout rows available for this campaign.</p>
                          )}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="empty-state">No campaigns active.</p>
            )}
          </section>
        </div>
      ) : (
        <p className="empty-state">No firmware distribution data available yet.</p>
      )}
    </section>
  );
}

function StreamHealthPage({ loading, stats, streamWindow, setWindow }) {
  const trend = stats?.trend || [];
  const modeTrends = stats?.trend_by_mode || [];
  const devices = stats?.worst_devices || [];
  const byMode = stats?.by_mode || {};
  const windowLabel = String(streamWindow || '7d').toUpperCase();
  const chart = useMemo(() => buildStreamHealthChart(trend, modeTrends), [trend, modeTrends]);
  const kpis = [
    {
      key: 'success-rate',
      label: `Stream Success Rate (${windowLabel})`,
      value: formatPercent(stats?.success_rate_pct ?? '-'),
      hint: 'Percent of stream requests that succeeded in the selected window',
    },
    {
      key: 'avg-duration',
      label: 'Avg Stream Duration',
      value: stats ? formatDurationMinutes(stats.avg_duration_seconds) : '-',
      hint: 'Average session length across observed requests',
    },
    {
      key: 'active-sessions',
      label: 'Active Sessions Now',
      value: stats?.active_sessions ?? '-',
      hint: 'Count of currently open stream sessions',
    },
    {
      key: 'never-streamed',
      label: 'Devices Never Streamed',
      value: stats?.never_streamed_count ?? '-',
      hint: 'Online devices that have no stream history',
    },
  ];

  return (
    <section className="panel stream-health-page">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Customer View</p>
          <h2>Stream Health</h2>
          <p>Are device streams succeeding for end users, and where are the worst failures concentrated?</p>
        </div>
        <div className="window-toggle" role="tablist" aria-label="Stream health window">
          {['7d', '30d'].map((value) => (
            <button
              key={value}
              type="button"
              className={streamWindow === value ? 'active' : ''}
              onClick={() => setWindow(value)}
            >
              {value.toUpperCase()}
            </button>
          ))}
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

      {loading && !stats ? (
        <p className="empty-state">Loading stream health data.</p>
      ) : stats ? (
        <div className="stream-health-layout">
          <section className="panel stream-trend-panel">
            <div className="panel-head">
              <div>
                <h3>Success trend</h3>
                <p>Daily request volume with overall and per-mode success-rate lines.</p>
              </div>
            </div>

            {chart.points.length ? (
              <>
                <div className="stream-chart-legend">
                  <span><i className="legend-bar legend-requests" /> Requests</span>
                  <span><i className="legend-line legend-overall" /> Overall</span>
                  <span><i className="legend-line legend-rtsp" /> RTSP</span>
                  <span><i className="legend-line legend-relay" /> Relay</span>
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
                <p className="chart-footnote">Bars show request volume; lines show the overall and mode-level success rate for the selected window.</p>
              </>
            ) : (
              <p className="empty-state">No stream data yet.</p>
            )}

            <div className="stream-mode-summary">
              {['rtsp', 'relay', 'webrtc'].map((mode) => {
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

            {devices.length ? (
              <div className="stream-device-table">
                <div className="stream-device-table__head">
                  <span>Device</span>
                  <span>Mode Used</span>
                  <span>Success Rate ({windowLabel})</span>
                  <span>Total Requests ({windowLabel})</span>
                  <span>Last Stream</span>
                  <span>Status</span>
                </div>
                {devices.map((device) => (
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
              <p className="empty-state">No stream data yet.</p>
            )}
          </section>
        </div>
      ) : (
        <p className="empty-state">No stream data yet.</p>
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

function PlatformAccessGate({ active, onLogin }) {
  return (
    <>
      <LoginPanel mode="platform" title="Platform admin login" onLogin={onLogin} />
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

function MetricCard({ label, value, hint, tone = 'neutral' }) {
  return (
    <div className={`metric-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function FleetHealthTrendPanel({ loading, trend, window, onWindowChange }) {
  const chart = useMemo(() => buildFleetTrendChart(trend), [trend]);
  return (
    <section className="panel overview-panel trend-panel">
      <div className="panel-head">
        <div>
          <h2>Fleet health trend</h2>
          <p>Daily online share and warning/critical volume across the current window.</p>
        </div>
        <div className="window-toggle" role="tablist" aria-label="Fleet health window">
          {['7d', '30d'].map((value) => (
            <button
              key={value}
              type="button"
              className={window === value ? 'active' : ''}
              onClick={() => onWindowChange(value)}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {loading && !trend.length ? (
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

function HealthDistributionPanel({ loading, current, onFilter }) {
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
      {loading && !current ? (
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

function RecentAlertsPanel({ loading, alerts }) {
  return (
    <section className="panel overview-panel alerts-panel">
      <div className="panel-head">
        <div>
          <h2>Recent alerts</h2>
          <p>Last 10 telemetry events that resulted in a health change.</p>
        </div>
      </div>
      {loading && !alerts.length ? (
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
        <p className="empty-state">No recent alert events yet.</p>
      )}
    </section>
  );
}

function Devices({ active, devices, selectedDevice, deviceDrawerOpen, setSelectedDeviceId, closeDeviceDrawer, onAction }) {
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
      setHealthFilter(toTitleCase(health));
    } else {
      setHealthFilter('All');
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
      firmware_version_display: device.firmware_version || '—',
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
    { key: 'organization', label: 'Customer', value: (device) => device.organization },
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
      label: 'Readiness',
      value: (device) => device.readiness_display,
      render: (device) => <StatusBadge value={normalizeStatusKey(device.readiness)} label={device.readiness_display} />,
    },
    {
      key: 'last_seen_at',
      label: 'Last seen',
      value: (device) => device.last_seen_at,
      render: (device) => device.last_seen_at || 'No transport evidence',
    },
    {
      key: 'actions',
      label: 'Actions',
      sortable: false,
      value: () => '',
      render: (device) => (
        <div className="row-actions">
          <button onClick={(event) => runRowAction(event, onAction, device.id, 'provision')}>Provision</button>
          <button onClick={(event) => runRowAction(event, onAction, device.id, 'deactivate')}>Deactivate</button>
        </div>
      ),
    },
  ], [onAction]);

  const selectedTelemetry = selectedDevice ? telemetryById[selectedDevice.id] || null : null;
  const telemetryBusy = deviceDrawerOpen && selectedDevice?.id && telemetryLoadingId === selectedDevice.id && !selectedTelemetry;

  return (
    <section className="device-workspace">
      <div className="panel device-table-panel">
        <div className="panel-head">
          <div>
            <h2>Device fleet</h2>
            <p>Registry, video identity, readiness, and last known status.</p>
          </div>
        </div>
        <div className="device-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
          <label>
            Health
            <select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value)} style={{ marginLeft: '0.5rem' }}>
              {processedDevices.healthValues.map((value) => (
                <option key={`health-${value}`} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Readiness
            <select value={readinessFilter} onChange={(event) => setReadinessFilter(event.target.value)} style={{ marginLeft: '0.5rem' }}>
              {processedDevices.readinessValues.map((value) => (
                <option key={`readiness-${value}`} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Signal
            <select value={signalFilter} onChange={(event) => setSignalFilter(event.target.value)} style={{ marginLeft: '0.5rem' }}>
              {processedDevices.signalValues.map((value) => (
                <option key={`signal-${value}`} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Firmware
            <select value={firmwareFilter} onChange={(event) => setFirmwareFilter(event.target.value)} style={{ marginLeft: '0.5rem' }}>
              {processedDevices.firmwareValues.map((value) => (
                <option key={`firmware-${value}`} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              setReadinessFilter('All');
              setHealthFilter('All');
              setSignalFilter('All');
              setFirmwareFilter('All');
              updateDevicesLocation({ deviceId: '', health: '', firmware: '' });
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
      </div>
      {deviceDrawerOpen ? (
        <DeviceDrawer
          device={selectedDevice}
          telemetry={selectedTelemetry}
          loading={telemetryBusy}
          error={telemetryError}
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

function DeviceDrawer({ device, telemetry, loading, error, onClose, onAction }) {
  const drawerName = telemetry?.device_name || device?.name || 'Device selected';
  const drawerOrganization = telemetry?.organization || device?.organization || '—';
  const drawerModel = telemetry?.model || device?.model || '—';
  const drawerSerial = telemetry?.serial_number || device?.serial_number || '—';
  const drawerLastSeen = telemetry?.last_seen_at || device?.last_seen_at || '';
  const drawerFirmware = telemetry?.firmware_version || device?.firmware_version || '—';
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
            {error ? <p className="drawer-error">{error}</p> : null}

            <section className="drawer-summary">
              <div className="summary-card">
                <span>Health</span>
                <StatusBadge value={normalizeStatusKey(telemetry?.health || device.health || 'unknown')} label={toTitleCase(telemetry?.health || device.health || 'unknown')} />
                <small>{telemetry ? `Signals: ${telemetry.signals?.length ? telemetry.signals.map(formatTelemetrySignal).join(', ') : 'none reported'}` : 'Telemetry not loaded yet.'}</small>
              </div>
              <div className="summary-card">
                <span>Firmware</span>
                <strong>{drawerFirmware}</strong>
                <small>{telemetry?.recent_events?.[0]?.occurred_at ? `Last updated ${formatRelativeTime(telemetry.recent_events[0].occurred_at)}` : drawerLastSeen ? `Last seen ${formatRelativeTime(drawerLastSeen)}` : 'No update timestamp available.'}</small>
              </div>
              <div className="summary-card">
                <span>Active stream</span>
                <StatusBadge value={deriveStreamStatus(telemetry).tone} label={deriveStreamStatus(telemetry).label} />
                <small>{deriveStreamStatus(telemetry).detail}</small>
              </div>
            </section>

            <section className="drawer-charts">
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
            </section>

            <section className="drawer-events">
              <div className="panel-head">
                <div>
                  <h3>Recent events</h3>
                  <p>Last 10 telemetry events from this device.</p>
                </div>
              </div>
              {telemetry?.recent_events?.length ? (
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
                <p className="empty-state">No recent telemetry events available.</p>
              )}
            </section>

            <div className="drawer-actions">
              <button onClick={() => onAction(device.id, 'provision')}>Provision device</button>
              <button onClick={() => onAction(device.id, 'deactivate')}>Deactivate device</button>
            </div>
          </>
        )}
      </aside>
    </div>
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
  const events = telemetry?.recent_events || [];
  const joined = events
    .map((event) => `${event.event_type} ${event.summary}`.toLowerCase())
    .join(' ');
  if (/stream|session/.test(joined)) {
    if (/(started|opened|active|playing|live)/.test(joined)) {
      return {
        tone: 'healthy',
        label: 'Active',
        detail: 'Recent telemetry suggests a live stream session is open.',
      };
    }
    if (/(ended|closed|stopped|offline)/.test(joined)) {
      return {
        tone: 'inactive',
        label: 'Inactive',
        detail: 'Recent telemetry suggests no stream session is open.',
      };
    }
    return {
      tone: 'warning',
      label: 'Unknown',
      detail: 'Telemetry references stream activity but not an explicit open/closed state.',
    };
  }
  return {
    tone: 'unknown',
    label: 'Unknown',
    detail: 'No explicit stream-session event surfaced in recent telemetry.',
  };
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

function PlatformAdmin({ summary, health, devices, customers, operations, audit, me, onLogin }) {
  const customerCount = summary?.customers ?? '-';
  return (
    <>
      {me?.kind !== 'platform_admin' ? <LoginPanel mode="platform" title="Platform admin login" onLogin={onLogin} /> : null}
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

function LoginPanel({ mode, title, onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <section className="panel login-panel">
      <div>
        <h2>{title}</h2>
        <p>{mode === 'platform' ? 'Local SQLite platform admin session.' : 'Uses Account Manager when configured.'}</p>
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        onLogin(mode, { email, password });
      }}>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" />
        <button type="submit">Login</button>
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
  const modeOrder = ['rtsp', 'relay', 'webrtc'];
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
    rtsp: 'RTSP',
    relay: 'Relay',
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

function updateDevicesLocation({ deviceId, health, firmware } = {}) {
  const params = new URLSearchParams(window.location.search);
  if (deviceId !== undefined) {
    if (deviceId) {
      params.set('device', deviceId);
    } else {
      params.delete('device');
    }
  }
  if (health !== undefined) {
    if (health) {
      params.set('health', health);
    } else {
      params.delete('health');
    }
  }
  if (firmware !== undefined) {
    if (firmware) {
      params.set('firmware', firmware);
    } else {
      params.delete('firmware');
    }
  }
  const query = params.toString();
  const path = query ? `/console/devices?${query}` : '/console/devices';
  window.history.pushState({}, '', path);
}

function runRowAction(event, onAction, deviceId, action) {
  event.stopPropagation();
  onAction(deviceId, action);
}

createRoot(document.getElementById('root')).render(<App />);
