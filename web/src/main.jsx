import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  customerNavItems,
  devicesPathWithFilters,
  isPlatformRouteId,
  isPublicRouteId,
  navItemsForRoute,
  platformNavItems,
  routeFromLocation,
  titleFor,
} from './routes.mjs';
import {
  postJSON,
  putJSON,
  startSSOLogin,
  userFacingLoginActivationError,
  userFacingPasswordResetError,
  userFacingSignupError,
  userFacingSSOError,
  userFacingVerificationError,
} from './http.mjs';
import {
  brandCloudKPIs,
  brandCloudOwner,
  brandCloudQuotaLabel,
  brandCloudRegion,
  brandCloudStatusKey,
  brandCloudStatusLabel,
  brandCloudTier,
  brandCloudUserStatus,
  userFacingBrandCloudError,
} from './brand-clouds.mjs';
import {
  destinationForSession,
  loginNextFromLocation,
  loginPathFor,
  passwordLoginOrderForNext,
  protectedPathFromLocation,
} from './auth-routing.mjs';
import { quotaRaiseErrorMessage, quotaUsageLabel } from './auth-state.mjs';
import { canUseCapability, deviceActionState, isReadOnlyRole } from './device-actions.mjs';
import { firmwareCampaignDetailRows, firmwarePolicyLabel, firmwareRiskRows, firmwareVersionFilterValue } from './firmware.mjs';
import {
  auditCoverageCopy,
  formatResourcePercent,
  formatThroughputBPS,
  resourceStatusLabel,
  resourceStatusTone,
  ssoProtocolLabel,
  workloadStatusLabel,
  workloadStatusTone,
} from './platform-view.mjs';
import {
  sourceAvailable,
  sourceMessage,
  sourceStateForPanel,
  sourceUnavailableFromError,
  telemetrySourceState,
} from './source-state.mjs';
import { streamAttentionRows, streamModeRows, streamWorstDeviceRows } from './stream.mjs';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles.css';

const DEFAULT_PAGE_SIZE = 8;

function brandCloudsURL({ query, status, tier, limit, offset }) {
  const params = new URLSearchParams();
  params.set('limit', String(limit || 25));
  params.set('offset', String(offset || 0));
  if (String(query || '').trim()) params.set('q', String(query).trim());
  if (status && status !== 'all') params.set('status', status);
  if (tier && tier !== 'all') params.set('tier', tier);
  return `/api/admin/brand-clouds?${params.toString()}`;
}

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
  const [serviceLogs, setServiceLogs] = useState(null);
  const [audit, setAudit] = useState([]);
  const [platformDashboard, setPlatformDashboard] = useState(null);
  const [brandClouds, setBrandClouds] = useState([]);
  const [brandCloudPagination, setBrandCloudPagination] = useState({ limit: 25, offset: 0, total: 0 });
  const [brandCloudQuery, setBrandCloudQuery] = useState('');
  const [brandCloudStatus, setBrandCloudStatus] = useState('all');
  const [brandCloudTierFilter, setBrandCloudTierFilter] = useState('all');
  const [brandCloudSource, setBrandCloudSource] = useState({ status: 'idle', message: '' });
  const [selectedBrandCloudId, setSelectedBrandCloudId] = useState('');
  const [brandCloudDrawerMode, setBrandCloudDrawerMode] = useState('');
  const [ssoProviders, setSSOProviders] = useState([]);
  const [firmwareDistribution, setFirmwareDistribution] = useState(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [deviceDrawerOpen, setDeviceDrawerOpen] = useState(false);
  const [overviewWindow, setOverviewWindow] = useState('7d');
  const [streamWindow, setStreamWindow] = useState('7d');
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const isPublicRoute = isPublicRouteId(active);
  const isLoginRoute = active === 'login';
  const isAuthEntryRoute = active === 'login' || active === 'login-check-email' || active === 'login-activate' || active === 'forgot-password' || active === 'reset-password';
  const isPlatformView = isPlatformRouteId(active);
  const visibleNavItems = navItemsForRoute(active).filter((item) => item.id !== 'platform-brand-clouds' || me?.upstream_account_manager);
  const needsPlatformAccess = isPlatformView && me?.kind !== 'platform_admin';
  const brandCloudsBlocked = active === 'platform-brand-clouds' && me?.kind === 'platform_admin' && !me?.upstream_account_manager;
  const customerViewPending = !isPlatformView && !isPublicRoute && me === null;
  const customerViewBlocked = !isPlatformView && !isPublicRoute && me !== null && (me.authenticated === false || me.kind === 'platform_admin');

  function clearDashboardState() {
    setSummary(null);
    setFleetHealth(null);
    setStreamStats(null);
    setRecentAlerts([]);
    setCustomers([]);
    setDevices([]);
    setOperations([]);
    setHealth([]);
    setServiceLogs(null);
    setAudit([]);
    setPlatformDashboard(null);
    setBrandClouds([]);
    setBrandCloudPagination({ limit: 25, offset: 0, total: 0 });
    setBrandCloudSource({ status: 'idle', message: '' });
    setSelectedBrandCloudId('');
    setBrandCloudDrawerMode('');
    setSSOProviders([]);
    setFirmwareDistribution(null);
  }

  useEffect(() => {
    if (isPublicRoute && !isLoginRoute) {
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

        if (isLoginRoute) {
          if (nextMe.authenticated) {
            window.location.replace(destinationForSession(nextMe, loginNextFromLocation(window.location)));
            return;
          }
          clearDashboardState();
          setLoading(false);
          return;
        }

        if (!nextMe.authenticated) {
          window.location.replace(loginPathFor(protectedPathFromLocation(window.location)));
          return;
        }

        const useAdminApi = isPlatformView && nextMe.kind === 'platform_admin';
        if (!isPlatformView && nextMe.kind === 'platform_admin') {
          clearDashboardState();
          setLoading(false);
          return;
        }
        if (isPlatformView && nextMe.kind !== 'platform_admin') {
          clearDashboardState();
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
              fetchJSON(`${prefix}/platform-dashboard`),
            ]
          : [
              fetchJSON(`${prefix}/summary`),
              fetchJSON(`${prefix}/customers`),
              fetchJSON(`${prefix}/devices`),
              Promise.resolve([]),
              Promise.resolve([]),
              Promise.resolve([]),
              Promise.resolve(null),
            ];
        const [nextSummary, nextCustomers, nextDevices, nextOperations, nextHealth, nextAudit, nextPlatformDashboard] = await Promise.all(baseRequests);
        if (!alive) return;
        setSummary(nextSummary);
        setCustomers(nextCustomers);
        setDevices(nextDevices);
        setOperations(nextOperations);
        setHealth(nextHealth);
        if (useAdminApi && active === 'platform-logs') {
          const logs = await fetchJSON('/api/admin/service-logs?service=workspace-readiness').catch((err) => ({
            status: 'degraded',
            message: err.message || 'Central service logging is unavailable.',
            events: [],
          }));
          if (!alive) return;
          setServiceLogs(logs);
        } else {
          setServiceLogs(null);
        }
        setAudit(nextAudit);
        setPlatformDashboard(nextPlatformDashboard);
        if (useAdminApi && active === 'platform-brand-clouds' && nextMe.upstream_account_manager) {
          try {
            const result = await fetchJSON(brandCloudsURL({
              query: brandCloudQuery,
              status: brandCloudStatus,
              tier: brandCloudTierFilter,
              limit: brandCloudPagination.limit,
              offset: brandCloudPagination.offset,
            }));
            if (!alive) return;
            setBrandClouds(result.brand_clouds || []);
            setBrandCloudPagination(result.pagination || {
              limit: brandCloudPagination.limit,
              offset: brandCloudPagination.offset,
              total: result.brand_clouds?.length || 0,
            });
            setBrandCloudSource({ status: 'ready', message: '' });
          } catch (err) {
            if (err.isAuthError) throw err;
            if (!alive) return;
            setBrandClouds([]);
            setBrandCloudPagination((current) => ({ ...current, total: 0 }));
            setBrandCloudSource({ status: 'unavailable', message: userFacingBrandCloudError(err) });
          }
        } else if (active === 'platform-brand-clouds') {
          setBrandClouds([]);
          setBrandCloudPagination((current) => ({ ...current, total: 0 }));
          setBrandCloudSource({ status: 'unavailable', message: 'Brand Clouds requires Account Manager Platform Admin login.' });
        } else {
          setBrandClouds([]);
          setBrandCloudPagination((current) => ({ ...current, offset: 0, total: 0 }));
          setBrandCloudSource({ status: 'idle', message: '' });
          setSelectedBrandCloudId('');
          setBrandCloudDrawerMode('');
        }
        if (useAdminApi && active === 'platform-sso') {
          const nextSSOProviders = await fetchJSON('/api/admin/sso/providers');
          if (!alive) return;
          setSSOProviders(nextSSOProviders.providers || []);
        } else {
          setSSOProviders([]);
        }
        if (active === 'firmware-ota' && nextMe.kind !== 'platform_admin') {
          const nextFirmwareDistribution = await fetchJSON('/api/fleet/firmware-distribution')
            .catch((err) => {
              if (err.isAuthError) throw err;
              return sourceUnavailableFromError('firmware', err);
            });
          if (!alive) return;
          setFirmwareDistribution(nextFirmwareDistribution);
        } else {
          setFirmwareDistribution(null);
        }

        if (nextMe.authenticated && nextMe.kind === 'customer' && !useAdminApi) {
          const streamWindowToUse = active === 'stream-health' ? streamWindow : overviewWindow;
          const [nextFleetHealth, nextStreamStats] = await Promise.all([
            fetchJSON(`/api/fleet/health-summary?window=${overviewWindow}`)
              .catch((err) => {
                if (err.isAuthError) throw err;
                return sourceUnavailableFromError('telemetry', err);
              }),
            fetchJSON(`/api/fleet/stream-stats?window=${streamWindowToUse}`)
              .catch((err) => {
                if (err.isAuthError) throw err;
                return sourceUnavailableFromError('stream', err);
              }),
          ]);
          if (!alive) return;
          setFleetHealth(nextFleetHealth);
          setStreamStats(nextStreamStats);
          if (active === 'overview' && sourceAvailable(nextFleetHealth)) {
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
          if (!isLoginRoute) {
            window.location.replace(loginPathFor(protectedPathFromLocation(window.location)));
            return;
          }
          try {
            const freshMe = await fetch('/api/me').then((r) => r.json());
            if (alive) setMe(freshMe);
          } catch (_) {}
          setSummary(null);
          setCustomers([]);
          setDevices([]);
          setOperations([]);
          setHealth([]);
          setServiceLogs(null);
          setAudit([]);
          setBrandClouds([]);
          setBrandCloudSource({ status: 'idle', message: '' });
          setSelectedBrandCloudId('');
          setBrandCloudDrawerMode('');
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
  }, [active, brandCloudPagination.limit, brandCloudPagination.offset, brandCloudQuery, brandCloudStatus, brandCloudTierFilter, isLoginRoute, isPublicRoute, overviewWindow, refreshTick, streamWindow]);

  useEffect(() => {
    if (!isPublicRoute || isLoginRoute) return;
    setError('');
    setMe(null);
    setSummary(null);
    setCustomers([]);
    setDevices([]);
    setOperations([]);
    setHealth([]);
    setServiceLogs(null);
    setAudit([]);
    setBrandClouds([]);
    setBrandCloudPagination({ limit: 25, offset: 0, total: 0 });
    setBrandCloudSource({ status: 'idle', message: '' });
    setSelectedBrandCloudId('');
    setBrandCloudDrawerMode('');
    setSSOProviders([]);
    setFirmwareDistribution(null);
    setFleetHealth(null);
    setStreamStats(null);
    setRecentAlerts([]);
  }, [isLoginRoute, isPublicRoute]);

  useEffect(() => {
    if (isPublicRoute) return undefined;
    const timer = window.setInterval(() => {
      setRefreshTick((tick) => tick + 1);
    }, 20_000);
    return () => window.clearInterval(timer);
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

  async function refreshBrandClouds() {
    const result = await fetchJSON(brandCloudsURL({
      query: brandCloudQuery,
      status: brandCloudStatus,
      tier: brandCloudTierFilter,
      limit: brandCloudPagination.limit,
      offset: brandCloudPagination.offset,
    }));
    setBrandClouds(result.brand_clouds || []);
    setBrandCloudPagination(result.pagination || {
      limit: brandCloudPagination.limit,
      offset: brandCloudPagination.offset,
      total: result.brand_clouds?.length || 0,
    });
    setBrandCloudSource({ status: 'ready', message: '' });
    return result.brand_clouds || [];
  }

  function handleBrandCloudFilters(next) {
    if (Object.prototype.hasOwnProperty.call(next, 'query')) setBrandCloudQuery(next.query);
    if (Object.prototype.hasOwnProperty.call(next, 'status')) setBrandCloudStatus(next.status);
    if (Object.prototype.hasOwnProperty.call(next, 'tier')) setBrandCloudTierFilter(next.tier);
    setBrandCloudPagination((current) => ({ ...current, offset: 0 }));
  }

  function handleBrandCloudPage(nextOffset) {
    setBrandCloudPagination((current) => ({
      ...current,
      offset: Math.max(0, Math.min(nextOffset, Math.max(current.total - current.limit, 0))),
    }));
  }

  async function handleCreateBrandCloud(payload) {
    setError('');
    try {
      const result = await postJSON('/api/admin/brand-clouds', payload.brandCloud);
      let memberError = '';
      if (payload.initialMember?.brand_cloud_user_id) {
        try {
          await postJSON(`/api/admin/brand-clouds/${encodeURIComponent(result.brand_cloud.id)}/members`, payload.initialMember);
        } catch (err) {
          memberError = userFacingBrandCloudError(err);
        }
      }
      if (payload.initialUser?.email) {
        try {
          await postJSON(`/api/admin/brand-clouds/${encodeURIComponent(result.brand_cloud.id)}/users`, payload.initialUser);
        } catch (err) {
          memberError = userFacingBrandCloudError(err);
        }
      }
      await refreshBrandClouds();
      setSelectedBrandCloudId(result.brand_cloud.id);
      setBrandCloudDrawerMode('detail');
      return { brandCloud: result.brand_cloud, memberError };
    } catch (err) {
      const message = userFacingBrandCloudError(err);
      setError(message);
      throw new Error(message);
    }
  }

  async function handleUpdateBrandCloud(brandCloudID, patch) {
    setError('');
    try {
      const result = await sendJSONWithMethod('PATCH', `/api/admin/brand-clouds/${encodeURIComponent(brandCloudID)}`, patch);
      setBrandClouds((brands) => brands.map((brand) => brand.id === brandCloudID ? result.brand_cloud : brand));
      return result.brand_cloud;
    } catch (err) {
      const message = userFacingBrandCloudError(err);
      setError(message);
      throw new Error(message);
    }
  }

  async function handleAssignBrandCloudMember(brandCloudID, payload) {
    setError('');
    try {
      return await postJSON(`/api/admin/brand-clouds/${encodeURIComponent(brandCloudID)}/members`, payload);
    } catch (err) {
      const message = userFacingBrandCloudError(err);
      setError(message);
      throw new Error(message);
    }
  }

  async function handleCreateBrandCloudUser(brandCloudID, payload) {
    setError('');
    try {
      return await postJSON(`/api/admin/brand-clouds/${encodeURIComponent(brandCloudID)}/users`, payload);
    } catch (err) {
      const message = userFacingBrandCloudError(err);
      setError(message);
      throw new Error(message);
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

  async function handlePasswordLogin(credentials) {
    setError('');
    const nextPath = loginNextFromLocation(window.location);
    const order = passwordLoginOrderForNext(nextPath);
    const errors = {};
    for (const kind of order) {
      try {
        if (kind === 'platform') {
          await postJSON('/api/auth/platform/login', credentials);
          window.location.assign(destinationForSession({ authenticated: true, kind: 'platform_admin' }, nextPath));
          return;
        }
        await postJSON('/api/auth/customer/login', credentials);
        window.location.assign(destinationForSession({ authenticated: true, kind: 'customer' }, nextPath));
        return;
      } catch (err) {
        errors[kind] = err;
      }
    }

    const message = `${errors.customer?.message || ''}\n${errors.platform?.message || ''}`;
    if (order[0] === 'platform' && message.includes('platform password sign-in is disabled')) {
      const nextError = 'Platform password sign-in is not enabled for this environment.';
      setError(nextError);
      throw new Error(nextError);
    }
    if (order[0] === 'customer' && message.includes('customer password sign-in is disabled')) {
      const nextError = 'Password sign-in is not enabled for this environment.';
      setError(nextError);
      throw new Error(nextError);
    }
    if (((errors.customer?.status === 401 || errors.customer?.status === 403) &&
      (errors.platform?.status === 401 || errors.platform?.status === 403)) ||
      /invalid credentials/i.test(message)) {
      const nextError = 'Email or password is incorrect.';
      setError(nextError);
      throw new Error(nextError);
    }
    const nextError = 'Sign-in is temporarily unavailable. Please try again later.';
    setError(nextError);
    throw new Error(nextError);
  }

  async function handleEmailSignIn(email) {
    setError('');
    try {
      await postJSON('/api/auth/sign-in', { email });
      window.history.pushState({}, '', `/login/check-email?email=${encodeURIComponent(email)}`);
      setActive('login-check-email');
      return true;
    } catch (err) {
      const nextError = userFacingLoginActivationError(err);
      setError(nextError);
      throw new Error(nextError);
    }
  }

  async function handleLoginActivate(token) {
    setError('');
    try {
      const result = await postJSON('/api/auth/login/activate', { token });
      window.location.assign(destinationForSession({ authenticated: true, kind: result.kind || 'customer' }, loginNextFromLocation(window.location)));
      return result;
    } catch (err) {
      const nextError = userFacingLoginActivationError(err);
      setError(nextError);
      throw new Error(nextError);
    }
  }

  async function handleForgotPassword(email) {
    setError('');
    try {
      await postJSON('/api/auth/forgot-password', { email });
      return true;
    } catch (err) {
      const nextError = userFacingPasswordResetError(err);
      setError(nextError);
      throw new Error(nextError);
    }
  }

  async function handleResetPassword(payload) {
    setError('');
    try {
      await postJSON('/api/auth/reset-password', payload);
      return true;
    } catch (err) {
      const nextError = userFacingPasswordResetError(err);
      setError(nextError);
      throw new Error(nextError);
    }
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
      setError(userFacingSignupError(err));
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
      setError(userFacingVerificationError(err));
      throw err;
    }
  }

  async function handleResendVerification(email) {
    setError('');
    try {
      return await postJSON('/api/auth/customer/resend-verification', { email });
    } catch (err) {
      setError(userFacingVerificationError(err));
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
  const selectedBrandCloud = useMemo(() => {
    if (!selectedBrandCloudId) return null;
    return brandClouds.find((brand) => brand.id === selectedBrandCloudId) || null;
  }, [brandClouds, selectedBrandCloudId]);

  if (isPublicRoute) {
    if (isAuthEntryRoute) {
      return (
        <LoginPage
          active={active}
          error={error}
          loading={loading}
          onEmailSignIn={handleEmailSignIn}
          onLoginActivate={handleLoginActivate}
          onPasswordLogin={handlePasswordLogin}
          onForgotPassword={handleForgotPassword}
          onResetPassword={handleResetPassword}
        />
      );
    }
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
    <div className={`app-shell ${isPlatformView ? 'platform-shell' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">{isPlatformView ? <Icon name="cloud" /> : 'C+'}</span>
          <strong>{isPlatformView ? 'RTK cloud' : 'Connect+ Ops'}</strong>
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
              {item.icon ? <Icon name={item.icon} /> : null}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-platform-switch">
          <p className="sidebar-section-label">Platform View</p>
          <button type="button" onClick={() => switchView(isPlatformView ? 'customer' : 'platform')}>
            <Icon name={isPlatformView ? 'user' : 'shield-halved'} />
            {isPlatformView ? 'Switch to Customer View' : 'Switch to Platform View'}
            <Icon name="chevron-right" />
          </button>
        </div>
        <div className="sidebar-account">
          <span className="avatar">{me?.email ? initialsForEmail(me.email) : 'DM'}</span>
          <div>
            <strong>{sessionLabel(me)}</strong>
            <small>{me?.authenticated ? me.email : 'Sign in required'}</small>
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
            ) : null}
            {active === 'overview' ? <WindowToggle value={overviewWindow} onChange={setOverviewWindow} label="Fleet health window" disabled={!sourceAvailable(fleetHealth)} /> : null}
            {active === 'stream-health' ? <WindowToggle value={streamWindow} onChange={setStreamWindow} label="Stream health window" disabled={!sourceAvailable(streamStats)} /> : null}
            {active === 'firmware-ota' ? <StaticWindowToggle /> : null}
            {me?.authenticated ? <button type="button" className="ghost-button icon-text-button" onClick={handleLogout}><Icon name="right-from-bracket" />Logout</button> : null}
          </div>
        </header>

        {error ? <div className="error">{error}</div> : null}

        {needsPlatformAccess ? (
          <PlatformAccessGate
            active={active}
            me={me}
          />
        ) : null}
        {!needsPlatformAccess && customerViewPending ? <section className="panel split-panel"><div><h2>Loading session</h2><p>Checking customer access before loading dashboard data.</p></div></section> : null}
        {!needsPlatformAccess && !customerViewPending && customerViewBlocked ? <CustomerAccessGate me={me} /> : null}
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
        {!needsPlatformAccess && active === 'platform-dashboard' ? <PlatformDashboardLanding dashboard={platformDashboard} summary={summary} health={health} operations={operations} /> : null}
        {!needsPlatformAccess && active === 'platform-health' ? <PlatformHealth summary={summary} health={health} /> : null}
        {!needsPlatformAccess && active === 'platform-logs' ? <PlatformServiceLogs logs={serviceLogs} loading={loading} /> : null}
        {!needsPlatformAccess && brandCloudsBlocked ? (
          <section className="panel split-panel">
            <div>
              <h2>Brand Clouds requires Account Manager login</h2>
              <p>Use an Account Manager-backed Platform Admin session to manage brand-cloud organizations and users.</p>
            </div>
          </section>
        ) : null}
        {!needsPlatformAccess && !brandCloudsBlocked && active === 'platform-brand-clouds' ? (
          <PlatformBrandClouds
            brands={brandClouds}
            pagination={brandCloudPagination}
            query={brandCloudQuery}
            status={brandCloudStatus}
            tier={brandCloudTierFilter}
            source={brandCloudSource}
            loading={loading}
            selectedBrand={selectedBrandCloud}
            drawerMode={brandCloudDrawerMode}
            onFilterChange={handleBrandCloudFilters}
            onPageChange={handleBrandCloudPage}
            onOpenBrand={(brand) => {
              setSelectedBrandCloudId(brand.id);
              setBrandCloudDrawerMode('detail');
            }}
            onCreate={() => {
              setSelectedBrandCloudId('');
              setBrandCloudDrawerMode('create');
            }}
            onCloseDrawer={() => {
              setSelectedBrandCloudId('');
              setBrandCloudDrawerMode('');
            }}
            onCreateBrand={handleCreateBrandCloud}
            onUpdateBrand={handleUpdateBrandCloud}
            onAssignMember={handleAssignBrandCloudMember}
            onCreateUser={handleCreateBrandCloudUser}
          />
        ) : null}
        {!needsPlatformAccess && active === 'platform-sso' ? (
          <PlatformSSOProviders providers={ssoProviders} customers={customers} onSave={handleSSOProviderSave} />
        ) : null}
        {!needsPlatformAccess && active === 'platform-operations' ? <Operations operations={operations} /> : null}
        {!needsPlatformAccess && active === 'platform-audit' ? <AuditLog audit={audit} loading={loading} /> : null}
      </main>
    </div>
  );
}

function LoginPage({ active, error, loading, onEmailSignIn, onLoginActivate, onPasswordLogin, onForgotPassword, onResetPassword }) {
  const params = new URLSearchParams(window.location.search);
  const email = params.get('email') || '';
  const token = params.get('token') || '';
  const content = active === 'login-check-email' ? (
    <LoginCheckEmail email={email} />
  ) : active === 'login-activate' ? (
    <LoginActivateView token={token} onLoginActivate={onLoginActivate} />
  ) : active === 'forgot-password' ? (
    <ForgotPasswordView email={email} onForgotPassword={onForgotPassword} />
  ) : active === 'reset-password' ? (
    <ResetPasswordView token={token} onResetPassword={onResetPassword} />
  ) : (
    <LoginEntryForm onEmailSignIn={onEmailSignIn} onPasswordLogin={onPasswordLogin} disabled={loading} />
  );
  return (
    <div className="login-shell">
      <main className="login-layout">
        <section className="login-primary" aria-labelledby="login-title">
          <div className="login-brand">
            <img src="/assets/realtek-logo.png" alt="Realtek" />
            <strong>Connect+ Ops</strong>
          </div>
          <h1 id="login-title">Admin Console</h1>
          <p className="login-copy">Login with your password or sign in with an email activation link.</p>
          {content}
          {error ? <div className="error">{error}</div> : null}
        </section>
      </main>
    </div>
  );
}

function LoginEntryForm({ onEmailSignIn, onPasswordLogin, disabled }) {
  const [mode, setMode] = useState('login');
  return (
    <div className="auth-stack">
      <div className="auth-mode-tabs" role="tablist" aria-label="Auth mode">
        <button
          type="button"
          className={mode === 'login' ? 'active' : ''}
          role="tab"
          aria-selected={mode === 'login'}
          onClick={() => setMode('login')}
        >
          Login
        </button>
        <button
          type="button"
          className={mode === 'signin' ? 'active' : ''}
          role="tab"
          aria-selected={mode === 'signin'}
          onClick={() => setMode('signin')}
        >
          Sign-in
        </button>
      </div>
      {mode === 'signin' ? (
        <LoginEmailForm onEmailSignIn={onEmailSignIn} disabled={disabled} />
      ) : (
        <LoginPasswordForm onPasswordLogin={onPasswordLogin} disabled={disabled} />
      )}
    </div>
  );
}

function LoginEmailForm({ onEmailSignIn, disabled }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      await onEmailSignIn(email);
    } catch (err) {
      setLocalError(err?.message || 'Sign-in is temporarily unavailable. Please try again later.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="login-form" onSubmit={submit}>
      <p className="auth-status">Send an activation link to continue without a password.</p>
      <label>
        Email
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required />
      </label>
      <button type="submit" disabled={busy || disabled}>{busy ? 'Sending' : 'Continue'}</button>
      {localError ? <p className="error">{localError}</p> : null}
    </form>
  );
}

function LoginPasswordForm({ onPasswordLogin, disabled }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      await onPasswordLogin({ email, password });
    } catch (err) {
      setLocalError(err?.message || 'Sign-in is temporarily unavailable. Please try again later.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="login-form" onSubmit={submit}>
      <label>
        Email
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required />
      </label>
      <button type="submit" disabled={busy || disabled}>{busy ? 'Logging in' : 'Login'}</button>
      <a className="auth-link" href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`}>Forgot password?</a>
      {localError ? <p className="error">{localError}</p> : null}
    </form>
  );
}

function LoginCheckEmail({ email }) {
  return (
    <div className="auth-stack">
      <p>Check your email for a sign-in link.</p>
      <p className="auth-status">If an eligible account exists, the link will activate this browser session.</p>
      {email ? <p className="auth-meta">{email}</p> : null}
      <a className="auth-link" href="/login">Back to sign in</a>
    </div>
  );
}

function LoginActivateView({ token, onLoginActivate }) {
  const [value, setValue] = useState(token);
  const [status, setStatus] = useState(token ? 'Activating sign-in link.' : 'Paste the sign-in token from your email.');
  const [error, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!value || attempted) return;
    setAttempted(true);
    setBusy(true);
    setLocalError('');
    onLoginActivate(value)
      .then(() => setStatus('Sign-in completed. Redirecting.'))
      .catch((err) => setLocalError(userFacingLoginActivationError(err)))
      .finally(() => setBusy(false));
  }, [attempted, onLoginActivate, value]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      await onLoginActivate(value);
      setStatus('Sign-in completed. Redirecting.');
    } catch (err) {
      setLocalError(userFacingLoginActivationError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-stack">
      <form className="auth-inline" onSubmit={submit}>
        <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Sign-in token" required />
        <button type="submit" disabled={busy}>{busy ? 'Activating' : 'Activate'}</button>
      </form>
      <p className="auth-status">{status}</p>
      {error ? <p className="error">{error}</p> : null}
      <a className="auth-link" href="/login">Request a new sign-in link</a>
    </div>
  );
}

function ForgotPasswordView({ email, onForgotPassword }) {
  const [value, setValue] = useState(email);
  const [status, setStatus] = useState('');
  const [error, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      await onForgotPassword(value);
      setStatus('If an eligible account exists, a reset link has been sent.');
    } catch (err) {
      setLocalError(userFacingPasswordResetError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="login-form" onSubmit={submit}>
      <label>
        Email
        <input type="email" value={value} onChange={(event) => setValue(event.target.value)} placeholder="name@company.com" required />
      </label>
      <button type="submit" disabled={busy}>{busy ? 'Sending' : 'Send reset link'}</button>
      {status ? <p className="auth-status">{status}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <a className="auth-link" href="/login">Back to sign in</a>
    </form>
  );
}

function ResetPasswordView({ token, onResetPassword }) {
  const [tokenValue, setTokenValue] = useState(token);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [error, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      await onResetPassword({ token: tokenValue, new_password: password });
      setStatus('Password reset completed. You can sign in with the new password.');
    } catch (err) {
      setLocalError(userFacingPasswordResetError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="login-form" onSubmit={submit}>
      <label>
        Reset token
        <input value={tokenValue} onChange={(event) => setTokenValue(event.target.value)} placeholder="Reset token" required />
      </label>
      <label>
        New password
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} required />
      </label>
      <button type="submit" disabled={busy}>{busy ? 'Resetting' : 'Reset password'}</button>
      {status ? <p className="auth-status">{status}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <a className="auth-link" href="/login">Back to sign in</a>
    </form>
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
  const [error, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(password);

  async function submit(event) {
    event.preventDefault();
    if (!acceptTerms || honeypot) return;
    setBusy(true);
    setLocalError('');
    try {
      await onSignup({
        email,
        password,
        display_name: displayName,
        organization_name: organizationName,
        captcha_token: captchaToken,
      });
    } catch (err) {
      setLocalError(userFacingSignupError(err));
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
      {error ? <p className="error">{error}</p> : null}
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
    } catch (err) {
      setLocalError(userFacingVerificationError(err));
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
      .catch((err) => setLocalError(userFacingVerificationError(err)))
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
    } catch (err) {
      setLocalError(userFacingVerificationError(err));
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

function QuotaRaiseForm({ organizationId, organizationName, currentUsage, currentQuota, onSubmit }) {
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
    if (!Number.isFinite(Number(requestedQuota)) || Number(requestedQuota) <= Number(currentUsage || 0)) {
      setLocalError('Quota request needs a valid requested quota and use case.');
      setBusy(false);
      return;
    }
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
    } catch (err) {
      setLocalError(quotaRaiseErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="quota-form" onSubmit={submit}>
      <p className="auth-status">{quotaUsageLabel(currentUsage, currentQuota)}</p>
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
  const telemetryState = sourceStateForPanel({
    loading,
    source: fleetHealth,
    hasData: Boolean(fleetHealth?.current || fleetHealth?.trend?.length),
    category: 'telemetry',
    fallbackMessage: 'No telemetry source configured.',
  });
  const streamState = sourceStateForPanel({
    loading,
    source: streamStats,
    hasData: Boolean(streamStats?.trend?.length || streamStats?.active_sessions || streamStats?.worst_devices?.length),
    category: 'stream',
    fallbackMessage: 'No stream source configured.',
  });
  const onlineRate = telemetryAvailable ? fleetHealth?.online_rate_7d_pct : null;
  const needsAttention = telemetryAvailable && (current.warning !== undefined || current.critical !== undefined)
    ? (current.warning || 0) + (current.critical || 0)
    : 'Unavailable';
  const activeStreams = streamAvailable ? (streamStats?.active_sessions ?? 0) : 'Unavailable';
  const telemetryReason = telemetryState.message || sourceMessage(fleetHealth, 'No telemetry source configured.');
  const streamReason = streamState.message || sourceMessage(streamStats, 'No stream source configured.');
  const attentionDevices = buildAttentionQueue(devices, recentAlerts);

  return (
    <div className="overview-layout">
      <section className="metrics overview-metrics">
        <MetricCard icon="video" label="Online" value={summary ? `${onlineCount} / ${summary.total_devices ?? 0}` : onlineCount} hint="Devices online" tone="info" />
        <MetricCard icon="chart-line" label="Online Rate" value={telemetryAvailable ? formatPercent(onlineRate) : 'Unavailable'} hint={telemetryAvailable ? 'vs 7d trend' : telemetryReason} tone="info" />
        <MetricCard icon="triangle-exclamation" label="Needs Attention" value={needsAttention} hint={telemetryAvailable ? `${current.warning || 0} warning / ${current.critical || 0} critical` : telemetryReason} tone={needsAttention === 0 ? 'good' : 'warn'} />
        <MetricCard icon="tower-broadcast" label="Active Streams" value={activeStreams} hint={streamAvailable ? `of ${summary?.total_devices ?? 0} devices` : streamReason} tone="info" />
      </section>

      {!telemetryAvailable ? <SourceBlockedState title={telemetryState.title} message={telemetryReason} /> : null}

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
        <RecentAlertsPanel loading={loading} alerts={recentAlerts} source={fleetHealth} onOpenDevice={(deviceId) => updateDevicesLocation({ deviceId })} />
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
            currentUsage={activeDevices}
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
  const pageState = sourceStateForPanel({
    loading,
    source: distribution,
    hasData: Boolean(versions.length || campaigns.length),
    category: 'firmware',
    fallbackMessage: 'Firmware observation source is not configured.',
    emptyMessage: 'No firmware distribution data available.',
  });
  const unavailableText = pageState.message || sourceMessage(distribution, 'Firmware observation source is not configured.');
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
        <MetricCard icon="microchip" label="Latest Version" value={available ? latestVersion : 'Unavailable'} hint={available ? 'Current target release' : unavailableText} tone="info" />
        <MetricCard icon="circle-check" label="Devices Current" value={available ? currentDevices : 'Unavailable'} hint={available ? `${formatPercent(latestVersionRow?.pct || 0)} of fleet` : unavailableText} tone="good" />
        <MetricCard icon="cloud-arrow-up" label="Pending Update" value={available ? pendingUpdate : 'Unavailable'} hint={available ? (primaryCampaign ? `${formatPercent(primaryCampaign.total ? pendingUpdate / primaryCampaign.total * 100 : 0)} of rollout` : 'No active rollout') : unavailableText} tone="info" />
        <MetricCard icon="circle-exclamation" label="Failed Rollout" value={available ? failedRollout : 'Unavailable'} hint={available ? (primaryCampaign ? `${formatPercent(primaryCampaign.total ? failedRollout / primaryCampaign.total * 100 : 0)} of rollout` : 'No active rollout') : unavailableText} tone={failedRollout ? 'danger' : 'good'} />
      </section>

      {loading && !distribution ? <p className="empty-state">Loading firmware distribution.</p> : null}
      {distribution && !available ? <SourceBlockedState title={pageState.title} message={unavailableText} /> : null}

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
                      <span>{firmwarePolicyLabel(campaign.policy)}</span>
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
          <p>Target {campaign.target_version} / {firmwarePolicyLabel(campaign.policy)} / {campaign.started_at ? formatRelativeTime(campaign.started_at) : 'not started'}</p>
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
  const worstDevices = streamWorstDeviceRows(stats?.worst_devices || []);
  const byMode = stats?.by_mode || {};
  const modeRows = streamModeRows(byMode);
  const available = sourceAvailable(stats);
  const pageState = sourceStateForPanel({
    loading,
    source: stats,
    hasData: Boolean(trend.length || worstDevices.length || stats?.active_sessions),
    category: 'stream',
    fallbackMessage: 'WebRTC session event source is not configured.',
    emptyMessage: 'No stream requests in selected window.',
  });
  const unavailableText = pageState.message || sourceMessage(stats, 'WebRTC session event source is not configured.');
  const windowLabel = String(streamWindow || '7d').toUpperCase();
  const chart = useMemo(() => buildStreamHealthChart(trend, modeTrends), [trend, modeTrends]);
  const kpis = [
    {
      key: 'success-rate',
      icon: 'signal',
      label: `Stream Success Rate (${windowLabel})`,
      value: available ? formatPercent(stats?.success_rate_pct ?? 0) : 'Unavailable',
      hint: available ? 'Percent of stream requests that succeeded in the selected window' : unavailableText,
    },
    {
      key: 'avg-duration',
      icon: 'clock',
      label: 'Avg Stream Duration',
      value: available ? formatDurationMinutes(stats.avg_duration_seconds) : 'Unavailable',
      hint: available ? 'Average session length across observed requests' : unavailableText,
    },
    {
      key: 'active-sessions',
      icon: 'tower-broadcast',
      label: 'Active Sessions Now',
      value: available ? (stats?.active_sessions ?? 0) : 'Unavailable',
      hint: available ? 'Count of currently open stream sessions' : unavailableText,
    },
    {
      key: 'never-streamed',
      icon: 'circle-question',
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
        {kpis.map(({ key, icon, label, value, hint }) => (
          <MetricCard
            key={key}
            icon={icon}
            label={label}
            value={value}
            hint={hint}
            tone="info"
          />
        ))}
      </section>

      {!available && stats ? <SourceBlockedState title={pageState.title} message={unavailableText} /> : null}

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
              {modeRows.length ? modeRows.map((statsForMode) => {
                const mode = statsForMode.mode;
                return (
                  <div key={mode} className="stream-mode-summary__item">
                    <span>{streamModeLabel(mode)}</span>
                    <strong>{formatPercent(statsForMode.success_rate_pct ?? 0)}</strong>
                    <small>{statsForMode.requests ?? 0} requests</small>
                  </div>
                );
              }) : (
                <p className="empty-state">No source-backed stream mode data in selected window.</p>
              )}
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
                  <button key={device.device_id} type="button" className="stream-device-table__row" onClick={() => onOpenDevice(device.device_id)}>
                    <strong>{device.device_name || device.device_id}</strong>
                    <span>{streamModeLabel(device.mode_used)}</span>
                    <span>{formatPercent(device.success_rate_pct ?? 0)}</span>
                    <span>{device.requests ?? 0}</span>
                    <time title={device.last_stream_at || ''}>{device.last_stream_at ? formatRelativeTime(device.last_stream_at) : '—'}</time>
                    <StatusBadge value={normalizeStatusKey(device.readiness)} label={formatReadinessLabel(device.readiness)} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-state">No stream requests in selected window.</p>
            )}
          </section>
          <StreamAttentionPanel stats={stats} onOpenDevice={onOpenDevice} />
        </div>
      ) : (
        <p className="empty-state">{unavailableText}</p>
      )}
    </section>
  );
}

function CustomerAccessGate({ me }) {
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
    <section className="panel split-panel">
      <div>
        <h2>Customer access required</h2>
        <p>Sign in with a customer account to open the operations console.</p>
        <a className="inline-action" href={loginPathFor(protectedPathFromLocation(window.location))}>Go to sign in</a>
      </div>
    </section>
  );
}

function PlatformAccessGate({ active, me }) {
  const signedInCustomer = me?.authenticated && me.kind === 'customer';
  return (
    <section className="panel split-panel">
      <div>
        <h2>{signedInCustomer ? 'Platform access denied' : 'Platform access required'}</h2>
        <p>{signedInCustomer ? 'Your current customer session cannot open Platform View.' : `Sign in with a platform admin session to open ${titleFor(active)}.`}</p>
        {!signedInCustomer ? <a className="inline-action" href={loginPathFor(protectedPathFromLocation(window.location))}>Go to sign in</a> : null}
      </div>
    </section>
  );
}

function PlatformDashboardLanding({ dashboard, summary, health, operations }) {
  const source = dashboard?.sources?.prometheus || null;
  const serviceGroups = dashboard?.service_scrape_health || [];
  const serviceExporters = dashboard?.service_exporters || [];
  const serviceMetrics = dashboard?.service_metrics || [];
  const workloadHealth = dashboard?.workload_health || [];
  const clusterNodes = dashboard?.cluster_nodes || [];
  const serverResources = dashboard?.server_resources || [];
  const risk = dashboard?.operation_risk || {
    open_operations: summary?.open_operations ?? 0,
    failed_operations: operations.filter((operation) => operation.state === 'failed').length,
    dead_lettered_operations: operations.filter((operation) => operation.state === 'dead_lettered').length,
    source_status: 'configured',
  };
  const footprintRows = [
    ['Tenants', dashboard?.summary?.customers ?? summary?.customers ?? 0],
    ['Total devices', dashboard?.summary?.total_devices ?? summary?.total_devices ?? 0],
    ['Activated', dashboard?.summary?.activated_devices ?? summary?.activated_devices ?? 0],
    ['Pending', dashboard?.summary?.pending_devices ?? summary?.pending_devices ?? 0],
    ['Failed', dashboard?.summary?.failed_devices ?? summary?.failed_devices ?? 0],
  ];
  const openOps = operations.filter((operation) => operation.state !== 'succeeded').slice(0, 5);
  const queries = dashboardQueriesByID(dashboard);
  const crossServiceRows = [
    metricPanelRow('Consumer backlog', queries.crossservice_consumer_backlog),
    metricPanelRow('Dead letters', queries.crossservice_dead_letters),
    metricPanelRow('Publish errors', queries.crossservice_publish_errors),
    metricPanelRow('Consume errors', queries.crossservice_consume_errors),
  ];
  const businessRows = [
    metricPanelRow('Video devices online', queries.business_video_devices_online),
    metricPanelRow('Blob utilization', queries.business_blob_utilization_percent, { suffix: '%' }),
    metricPanelRow('Exporter success', queries.business_exporter_success),
    metricPanelRow('Quota requests', queries.business_quota_requests),
    metricPanelRow('Eval signups 24h', queries.business_eval_signups_24h),
  ];
  const infrastructureRows = [
    metricPanelRow('CPU utilization', queries.infra_cpu_utilization_percent, { suffix: '%' }),
    metricPanelRow('Memory utilization', queries.infra_memory_utilization_percent, { suffix: '%' }),
    metricPanelRow('Disk utilization', queries.infra_disk_utilization_percent, { suffix: '%' }),
    metricPanelRow('Gateway targets', dashboardGroup(serviceGroups, 'gateway')),
    metricPanelRow('Broker targets', dashboardGroup(serviceGroups, 'broker')),
  ];
  const servicesUp = serviceMetrics.filter((metric) => ['ok', 'warning'].includes(normalizeStatusKey(metric.status))).length;
  const targetsDown = serviceMetrics.reduce((total, metric) => total + (metric.targets_down || 0), 0);
  const targetsTotal = serviceMetrics.reduce((total, metric) => total + (metric.targets_total || 0), 0);
  const workloadsDegraded = workloadHealth.filter((workload) => !['ok', 'unmonitored', 'unconfigured'].includes(normalizeStatusKey(workload.status))).length;
  const nodesReady = clusterNodes.filter((node) => node.ready).length;
  const dashboardKpis = [
    { id: 'services-up', label: 'Services Up', value: servicesUp || serviceMetrics.length, detail: serviceMetrics.length ? `/ ${serviceMetrics.length}` : '', icon: 'circle-check', tone: 'good' },
    { id: 'targets-down', label: 'Targets Down', value: targetsDown, detail: targetsTotal ? `/ ${targetsTotal}` : '', icon: 'circle-minus', tone: targetsDown ? 'danger' : 'good' },
    { id: 'workloads-degraded', label: 'Workloads Degraded', value: workloadsDegraded, detail: workloadHealth.length ? `/ ${workloadHealth.length}` : '', icon: 'triangle-exclamation', tone: workloadsDegraded ? 'warn' : 'good' },
    { id: 'nodes-ready', label: 'Nodes Ready', value: nodesReady, detail: clusterNodes.length ? `/ ${clusterNodes.length}` : '', icon: 'circle', tone: nodesReady === clusterNodes.length ? 'good' : 'warn' },
    { id: 'failed-ops', label: 'Failed Ops', value: risk.failed_operations || 0, detail: 'Open', icon: 'circle-minus', tone: risk.failed_operations ? 'danger' : 'good' },
  ];
  return (
    <section className="platform-dashboard">
      <div className="platform-dashboard-head">
        <div className="platform-context-controls" aria-label="Platform dashboard context">
          <span>Environment <strong>Production</strong></span>
          <span>Cluster <strong>rtk-prod-eu1</strong></span>
          <span className="platform-health-chip"><StatusDot value={targetsDown || workloadsDegraded ? 'warning' : 'ok'} />{targetsDown || workloadsDegraded ? 'Attention' : 'Healthy'}</span>
        </div>
        <span className="platform-updated"><Icon name="rotate" /> Last updated: now</span>
      </div>

      <section className="platform-kpi-strip">
        {dashboardKpis.map((kpi) => (
          <article className={`platform-kpi platform-kpi-${kpi.tone}`} key={kpi.id}>
            <div className="platform-kpi-label">
              <Icon name={kpi.icon} />
              <span>{kpi.label}</span>
            </div>
            <strong>{formatCompactNumber(kpi.value)} <small>{kpi.detail}</small></strong>
          </article>
        ))}
      </section>

      <section className="platform-primary-grid">
        <ServiceMetricsTable metrics={serviceMetrics} source={dashboard?.panel_sources?.service_metrics || source} />
        <WorkloadHealthTable workloads={workloadHealth} source={dashboard?.panel_sources?.workload_health || source} />
      </section>

      <section className="platform-secondary-grid">
        <ClusterNodeSummary nodes={clusterNodes} source={dashboard?.panel_sources?.cluster_nodes || source} />
        <OperationRiskPanel risk={risk} operations={openOps} />
      </section>

      <section className="platform-dashboard-grid platform-support-grid">
        <ServiceExporterStatus exporters={serviceExporters} source={dashboard?.panel_sources?.service_exporters || source} />
        <ScrapeHealthPanel groups={serviceGroups} />
        <FootprintPanel rows={footprintRows} />
        <PlatformActivityPanel health={health} />
        <PlatformMetricPanel title="Cross-Service Risk" rows={crossServiceRows} />
        <PlatformMetricPanel title="Business Signals" rows={businessRows} secondary />
        <PlatformMetricPanel title="Infrastructure Health" rows={infrastructureRows} />
        {serverResources.length ? <ServerResourceStatus resources={serverResources} source={dashboard?.panel_sources?.server_resources || source} legacy /> : null}
      </section>
    </section>
  );
}

function ScrapeHealthPanel({ groups }) {
  return (
    <article className="panel platform-dashboard-panel platform-compact-panel">
      <div className="panel-head">
        <div>
          <h2>Scrape Health</h2>
          <p>Grouped Prometheus target status.</p>
        </div>
      </div>
      <div className="scrape-group-list">
        {groups.map((group) => (
          <div className="scrape-group-row" key={group.id}>
            <div>
              <strong>{group.name}</strong>
              <small>{group.targets_up} up / {group.targets_down} down</small>
            </div>
            <CompactStatus value={group.status} label={toTitleCase(group.status)} />
          </div>
        ))}
        {!groups.length ? <p className="empty-state">No scrape group data available.</p> : null}
      </div>
    </article>
  );
}

function FootprintPanel({ rows }) {
  return (
    <article className="panel platform-dashboard-panel platform-compact-panel">
      <div className="panel-head">
        <div>
          <h2>Tenant & Device Footprint</h2>
          <p>Admin read-model totals.</p>
        </div>
      </div>
      <div className="footprint-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function OperationRiskPanel({ risk, operations }) {
  return (
    <article className="panel platform-dashboard-panel operation-risk-panel">
      <div className="panel-head">
        <div>
          <h2>Operation Risk</h2>
          <p>{risk.failed_operations || risk.dead_lettered_operations ? 'Failures need operator attention.' : 'No failed lifecycle work currently reported.'}</p>
        </div>
        <div className="operation-risk-legend" aria-label="Operation risk legend">
          <span><StatusDot value="open" />Open</span>
          <span><StatusDot value="warning" />Failed</span>
          <span><StatusDot value="dead_lettered" />Dead-letter</span>
        </div>
      </div>
      <div className="risk-strip" aria-label="Operation risk counts">
        <div className="risk-metric">
          <span>Open</span>
          <strong>{risk.open_operations}</strong>
        </div>
        <div className={`risk-metric ${risk.failed_operations ? 'risk-hot' : ''}`}>
          <span>Failed</span>
          <strong>{risk.failed_operations}</strong>
        </div>
        <div className={`risk-metric ${risk.dead_lettered_operations ? 'risk-hot' : ''}`}>
          <span>Dead letters</span>
          <strong>{risk.dead_lettered_operations}</strong>
        </div>
      </div>
      <OperationList operations={operations} detailed />
    </article>
  );
}

function PlatformActivityPanel({ health }) {
  return (
    <article className="panel platform-dashboard-panel platform-activity-panel platform-compact-panel">
      <div className="panel-head">
        <div>
          <h2>Platform Activity</h2>
          <p>{health.filter((item) => item.status === 'ok').length} of {health.length} services healthy.</p>
        </div>
      </div>
      <ServiceHealth health={health} compact />
    </article>
  );
}

function ServiceMetricsTable({ metrics, source }) {
  return (
    <article className="panel platform-dashboard-panel server-resource-panel">
      <div className="panel-head">
        <div>
          <h2>Service Health</h2>
          <p>Current k8s service target health and basic runtime metrics. Long-term trends live in Grafana.</p>
        </div>
      </div>
      <div className="server-resource-table-wrap">
        <table className="server-resource-table service-metrics-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Namespace</th>
              <th>Targets</th>
              <th>Req/s</th>
              <th>5xx/s</th>
              <th>Avg latency</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => (
              <tr key={metric.id}>
                <td><strong>{metric.service || metric.id}</strong></td>
                <td>{metric.namespace || '-'}</td>
                <td>{metric.source_status === 'configured' || metric.source_status === 'stale' || metric.targets_total ? `${metric.targets_up} up / ${metric.targets_down} down` : 'Unavailable'}</td>
                <td>{formatCompactNumber(metric.request_rate ?? 0)}</td>
                <td>{formatCompactNumber(metric.error_rate_5xx ?? 0)}</td>
                <td>{metric.avg_latency_seconds === undefined || metric.avg_latency_seconds === null ? 'Unavailable' : `${formatCompactNumber(metric.avg_latency_seconds)}s`}</td>
                <td><CompactStatus value={resourceStatusTone(metric.status)} label={resourceStatusLabel(metric.status)} /></td>
              </tr>
            ))}
            {!metrics.length ? (
              <tr>
                <td colSpan="7" className="empty-state">{source?.source_message || 'No k8s service metrics available.'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function WorkloadHealthTable({ workloads, source }) {
  return (
    <article className="panel platform-dashboard-panel server-resource-panel">
      <div className="panel-head">
        <div>
          <h2>K8s Workloads</h2>
          <p>Deployment replica, pod readiness, restart, and crashloop status.</p>
        </div>
      </div>
      <div className="server-resource-table-wrap">
        <table className="server-resource-table workload-health-table">
          <thead>
            <tr>
              <th>Workload</th>
              <th>Namespace</th>
              <th>Kind</th>
              <th>Replicas</th>
              <th>Ready pods</th>
              <th>Restarts</th>
              <th>Crashloop</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {workloads.map((workload) => (
              <tr key={workload.id}>
                <td><strong>{workload.name || workload.id}</strong></td>
                <td>{workload.namespace || '-'}</td>
                <td>{workload.kind || '-'}</td>
                <td>{workload.available_replicas ?? 0} / {workload.desired_replicas ?? 0}</td>
                <td>{workload.ready_pods ?? 0}</td>
                <td>{workload.restart_count ?? 0}</td>
                <td>{workload.crashloop_pods ?? 0}</td>
                <td><CompactStatus value={workloadStatusTone(workload.status)} label={workloadStatusLabel(workload.status)} /></td>
              </tr>
            ))}
            {!workloads.length ? (
              <tr>
                <td colSpan="8" className="empty-state">{source?.source_message || 'No k8s workload health data available.'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function ClusterNodeSummary({ nodes, source }) {
  return (
    <article className="panel platform-dashboard-panel server-resource-panel">
      <div className="panel-head">
        <div>
          <h2>Cluster Nodes</h2>
          <p>Current k8s node readiness and resource snapshot.</p>
        </div>
      </div>
      <div className="server-resource-table-wrap">
        <table className="server-resource-table cluster-node-table">
          <thead>
            <tr>
              <th>Node</th>
              <th>Ready</th>
              <th>CPU</th>
              <th>Memory</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.id}>
                <td><strong>{node.name || node.id}</strong></td>
                <td>{node.ready ? 'Ready' : 'Not ready'}</td>
                <td>{formatResourcePercent(node.cpu_percent)}</td>
                <td>{formatResourcePercent(node.memory_percent)}</td>
                <td><CompactStatus value={resourceStatusTone(node.status)} label={resourceStatusLabel(node.status)} /></td>
              </tr>
            ))}
            {!nodes.length ? (
              <tr>
                <td colSpan="5" className="empty-state">{source?.source_message || 'No k8s node metrics available.'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function ServiceExporterStatus({ exporters, source }) {
  return (
    <article className="panel platform-dashboard-panel server-resource-panel">
      <div className="panel-head">
        <div>
          <h2>Service Exporter Status</h2>
          <p>Application and service-owned exporters published into the admin Prometheus boundary.</p>
        </div>
      </div>
      <div className="server-resource-table-wrap">
        <table className="server-resource-table service-exporter-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Exporter role</th>
              <th>Targets</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {exporters.map((exporter) => (
              <tr key={exporter.id}>
                <td><strong>{exporter.label || exporter.id}</strong></td>
                <td>{exporter.role || '-'}</td>
                <td>{exporter.source_status === 'configured' || exporter.source_status === 'stale' || exporter.targets_total ? `${exporter.targets_up} up / ${exporter.targets_down} down` : 'Unavailable'}</td>
                <td><CompactStatus value={resourceStatusTone(exporter.status)} label={resourceStatusLabel(exporter.status)} /></td>
              </tr>
            ))}
            {!exporters.length ? (
              <tr>
                <td colSpan="4" className="empty-state">No service exporter data available.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function ServerResourceStatus({ resources, source, legacy = false }) {
  return (
    <article className="panel platform-dashboard-panel server-resource-panel">
      <div className="panel-head">
        <div>
          <h2>{legacy ? 'Legacy Server Resource Status' : 'Server Resource Status'}</h2>
          <p>{legacy ? 'Transition-only VM/server fallback while k8s metrics become the primary dashboard source.' : 'Per-server CPU, memory, root disk, and network throughput from the admin Prometheus boundary.'}</p>
        </div>
      </div>
      <div className="server-resource-table-wrap">
        <table className="server-resource-table">
          <thead>
            <tr>
              <th>Server</th>
              <th>Role / Service</th>
              <th>CPU</th>
              <th>Memory</th>
              <th>Disk</th>
              <th>Network</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((resource) => (
              <tr key={resource.id}>
                <td><strong>{resource.label || resource.id}</strong></td>
                <td>{resource.role || '-'}</td>
                <td>{formatResourcePercent(resource.cpu_percent)}</td>
                <td>{formatResourcePercent(resource.memory_percent)}</td>
                <td>{formatResourcePercent(resource.disk_percent)}</td>
                <td>
                  <span className="network-throughput-cell">
                    <span>In {formatThroughputBPS(resource.network_in_bps)}</span>
                    <span>Out {formatThroughputBPS(resource.network_out_bps)}</span>
                  </span>
                </td>
                <td><StatusBadge value={resourceStatusTone(resource.status)} label={resourceStatusLabel(resource.status)} /></td>
              </tr>
            ))}
            {!resources.length ? (
              <tr>
                <td colSpan="7" className="empty-state">No server resource data available.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function PlatformMetricPanel({ title, rows, secondary = false }) {
  return (
    <article className={`panel platform-dashboard-panel ${secondary ? 'platform-dashboard-panel-secondary' : ''}`}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="metric-row-list">
        {rows.map((row) => (
          <div className="metric-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function dashboardQueriesByID(dashboard) {
  const byID = {};
  for (const query of dashboard?.prometheus?.queries || []) {
    byID[query.id] = query;
  }
  return byID;
}

function metricPanelRow(label, item, { suffix = '' } = {}) {
  if (!item) return { label, value: 'Empty', status: 'empty' };
  if (item.source_status && item.source_status !== 'configured' && item.source_status !== 'stale') {
    return { label, value: toTitleCase(item.source_status), status: item.source_status };
  }
  if (item.targets_total !== undefined) {
    return { label, value: `${item.targets_up} up / ${item.targets_down} down`, status: item.source_status || 'configured' };
  }
  const total = (item.series || []).reduce((sum, series) => sum + Number(series.value || 0), 0);
  if (!item.series?.length) return { label, value: toTitleCase(item.source_status || 'empty'), status: item.source_status || 'empty' };
  return { label, value: `${formatCompactNumber(total)}${suffix}`, status: item.source_status || 'configured' };
}

function dashboardGroup(groups, id) {
  return groups.find((group) => group.id === id) || null;
}

function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 1000) return number.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(number) >= 10) return number.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
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

function PlatformServiceLogs({ logs, loading }) {
  const events = logs?.events || [];
  const status = logs?.status || (loading ? 'loading' : 'unavailable');
  return (
    <section className="panel platform-dashboard-panel">
      <div className="panel-head">
        <div>
          <h2>Cloud Service Logs</h2>
          <p>Centralized application logs from Account Manager, Video Cloud, Cloud Admin, and staging hosts.</p>
        </div>
        <span className={`status-pill ${status === 'ok' ? 'ok' : 'warn'}`}>{status}</span>
      </div>
      <div className="filter-row">
        {['service', 'host', 'unit', 'level', 'trace_id', 'request_id', 'operation_id', 'device_id', 'org_id', 'user_id'].map((field) => (
          <label key={field}>
            <span>{field}</span>
            <input readOnly value="" placeholder={field} />
          </label>
        ))}
      </div>
      {logs?.message ? <p className="source-note">{logs.message}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Time</th><th>Service</th><th>Level</th><th>Host</th><th>Message</th><th>Trace</th><th>Request</th></tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.event_id || `${event.ts}-${event.msg}`}>
                <td>{event.ts || '-'}</td>
                <td>{event.service || '-'}</td>
                <td>{event.level || '-'}</td>
                <td>{event.host || '-'}</td>
                <td>{event.msg || '-'}</td>
                <td>{event.trace_id || '-'}</td>
                <td>{event.request_id || '-'}</td>
              </tr>
            ))}
            {!events.length ? <tr><td colSpan="7">{loading ? 'Loading service logs' : 'No service log events found'}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PlatformBrandClouds({
  brands,
  pagination,
  query,
  status,
  tier,
  source,
  loading,
  selectedBrand,
  drawerMode,
  onFilterChange,
  onPageChange,
  onOpenBrand,
  onCreate,
  onCloseDrawer,
  onCreateBrand,
  onUpdateBrand,
  onAssignMember,
  onCreateUser,
}) {
  const kpis = brandCloudKPIs(brands);
  const tierOptions = useMemo(() => Array.from(new Set(['Evaluation', 'Commercial', ...brands.map((brand) => brandCloudTier(brand)).filter(Boolean)])).sort(), [brands]);
  const unavailable = source?.status === 'unavailable';
  const page = pagination || { limit: 25, offset: 0, total: brands.length };
  const pageStart = page.total ? page.offset + 1 : 0;
  const pageEnd = Math.min(page.offset + brands.length, page.total);
  const canPrevious = page.offset > 0;
  const canNext = page.offset + page.limit < page.total;

  return (
    <section className="platform-brand-clouds">
      <div className="brand-cloud-kpis">
        <MetricCard icon="cloud" label="Total Brand Clouds" value={kpis.total} hint="Account Manager records" tone="info" />
        <MetricCard icon="circle-check" label="Active" value={kpis.active} hint="Ready tenant organizations" tone="good" />
        <MetricCard icon="screwdriver-wrench" label="Setup Required" value={kpis.setupRequired} hint="Owner, SSO, or quota pending" tone={kpis.setupRequired ? 'warn' : 'good'} />
        <MetricCard icon="ban" label="Disabled" value={kpis.disabled} hint="Tenant access blocked" tone={kpis.disabled ? 'warn' : 'neutral'} />
      </div>

      <section className="panel platform-dashboard-panel brand-cloud-list-panel">
        <div className="panel-head">
          <div>
            <h2>Brand Clouds</h2>
            <p>Licensed brand operators backed by Account Manager.</p>
          </div>
          <button type="button" className="primary-button" onClick={onCreate}>Create Brand Cloud</button>
        </div>
        <div className="table-toolbar">
          <input className="input" value={query} onChange={(event) => onFilterChange({ query: event.target.value })} placeholder="Search brand, org id, owner" aria-label="Search Brand Clouds" />
          <select className="input" value={status} onChange={(event) => onFilterChange({ status: event.target.value })} aria-label="Filter Brand Clouds status">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="setup_required">Setup Required</option>
            <option value="disabled">Disabled</option>
            <option value="error">Error</option>
          </select>
          <select className="input" value={tier} onChange={(event) => onFilterChange({ tier: event.target.value })} aria-label="Filter Brand Clouds tier">
            <option value="all">All tiers</option>
            {tierOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        {unavailable ? <div className="error">Brand Clouds unavailable: {source.message}</div> : null}
        {!unavailable && loading ? <p className="empty-state">Loading Brand Clouds...</p> : null}
        {!unavailable && !loading && !brands.length ? <p className="empty-state">No Brand Clouds have been created.</p> : null}
        {!unavailable && !loading && brands.length ? (
          <div className="table-wrap">
            <table className="brand-cloud-table">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Status</th>
                  <th>Tier</th>
                  <th>Owner/Admin</th>
                  <th>Region</th>
                  <th>Devices</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((brand) => (
                  <tr key={brand.id}>
                    <td className="brand-cloud-primary">
                      <strong>{brand.name || brand.metadata?.brandname || brand.id}</strong>
                      <small className="brand-cloud-id">{brand.id}</small>
                    </td>
                    <td><StatusBadge value={brandCloudStatusKey(brand)} label={brandCloudStatusLabel(brand)} /></td>
                    <td>{brandCloudTier(brand)}</td>
                    <td>{brandCloudOwner(brand) || 'Unassigned'}</td>
                    <td>{brandCloudRegion(brand)}</td>
                    <td>{brandCloudQuotaLabel(brand)}</td>
                    <td><button type="button" className="inline-action compact-action" onClick={() => onOpenBrand(brand)}><i className="fa-solid fa-eye" aria-hidden="true" /> View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pagination-bar" aria-label="Brand Clouds pagination">
              <span>{pageStart}-{pageEnd} of {page.total}</span>
              <div className="pagination-controls">
                <button type="button" onClick={() => onPageChange(page.offset - page.limit)} disabled={!canPrevious}>
                  <i className="fa-solid fa-chevron-left" aria-hidden="true" /> Previous
                </button>
                <button type="button" onClick={() => onPageChange(page.offset + page.limit)} disabled={!canNext}>
                  Next <i className="fa-solid fa-chevron-right" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {drawerMode === 'create' ? (
        <BrandCloudCreateDrawer onClose={onCloseDrawer} onCreateBrand={onCreateBrand} />
      ) : null}
      {drawerMode === 'detail' && selectedBrand ? (
        <BrandCloudDetailDrawer
          brand={selectedBrand}
          onClose={onCloseDrawer}
          onUpdateBrand={onUpdateBrand}
          onAssignMember={onAssignMember}
          onCreateUser={onCreateUser}
        />
      ) : null}
    </section>
  );
}

function BrandCloudCreateDrawer({ onClose, onCreateBrand }) {
  const [form, setForm] = useState({
    name: '',
    region: '',
    tier: 'Evaluation',
    initialMode: 'none',
    userId: '',
    email: '',
    password: '',
    displayName: '',
    role: 'owner',
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    if (!form.name.trim()) {
      setMessage('Brand display name is required.');
      return;
    }
    if (form.initialMode === 'existing' && !form.userId.trim()) {
      setMessage('Existing Brand User id is required.');
      return;
    }
    if (form.initialMode === 'create' && (!form.email.trim() || !form.password.trim())) {
      setMessage('Initial admin email and password are required.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        brandCloud: {
          name: form.name.trim(),
          metadata: {
            region: form.region.trim() || undefined,
            tier: form.tier,
          },
        },
        initialMember: form.initialMode === 'existing' ? { brand_cloud_user_id: form.userId.trim(), role: form.role } : null,
        initialUser: form.initialMode === 'create' ? {
          email: form.email.trim(),
          password: form.password,
          display_name: form.displayName.trim() || undefined,
          role: form.role,
          rotate_password: true,
        } : null,
      };
      const result = await onCreateBrand(payload);
      setMessage(result.memberError ? `Brand Cloud created. ${result.memberError}` : 'Brand Cloud created.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="drawer-panel brand-cloud-drawer" role="dialog" aria-modal="true" aria-label="Create Brand Cloud" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <h2>Create Brand Cloud</h2>
            <p>Creates an Account Manager `organization_kind=brand_cloud` record.</p>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close Brand Cloud drawer">x</button>
        </div>
        <form className="drawer-form" onSubmit={submit}>
          <label>Brand display name<input className="input" value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
          <div className="form-grid">
            <label>Region<input className="input" value={form.region} onChange={(event) => update('region', event.target.value)} placeholder="Optional" /></label>
            <label>Tier<select className="input" value={form.tier} onChange={(event) => update('tier', event.target.value)}><option>Evaluation</option><option>Commercial</option></select></label>
          </div>
          <label>Initial admin mode<select className="input" value={form.initialMode} onChange={(event) => update('initialMode', event.target.value)}>
            <option value="none">Assign later</option>
            <option value="existing">Assign existing Brand User id</option>
            <option value="create">Create or reactivate brand user</option>
          </select></label>
          {form.initialMode === 'existing' ? <label>Brand User id<input className="input" value={form.userId} onChange={(event) => update('userId', event.target.value)} /></label> : null}
          {form.initialMode === 'create' ? (
            <>
              <label>Email<input className="input" type="email" value={form.email} onChange={(event) => update('email', event.target.value)} /></label>
              <label>Temporary password<input className="input" type="password" value={form.password} onChange={(event) => update('password', event.target.value)} /></label>
              <label>Display name<input className="input" value={form.displayName} onChange={(event) => update('displayName', event.target.value)} /></label>
            </>
          ) : null}
          {form.initialMode !== 'none' ? <label>Role<select className="input" value={form.role} onChange={(event) => update('role', event.target.value)}><option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option></select></label> : null}
          {message ? <p className="form-message">{message}</p> : null}
          <div className="drawer-actions">
            <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={submitting}>{submitting ? 'Creating...' : 'Create Brand Cloud'}</button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function BrandCloudDetailDrawer({ brand, onClose, onUpdateBrand, onAssignMember, onCreateUser }) {
  const [member, setMember] = useState({ brand_cloud_user_id: '', role: 'owner' });
  const [user, setUser] = useState({ email: '', password: '', display_name: '', role: 'admin' });
  const [users, setUsers] = useState([]);
  const [userFilter, setUserFilter] = useState('all');
  const [usersSource, setUsersSource] = useState({ status: 'loading', message: '' });
  const [message, setMessage] = useState('');
  const disabled = brandCloudStatusKey(brand) === 'disabled';
  const owner = brandCloudOwner(brand);
  const pendingUsers = users.filter((row) => brandCloudUserStatus(row).key === 'pending_verification').length;
  const disabledUsers = users.filter((row) => brandCloudUserStatus(row).key === 'disabled').length;
  const activeUsers = users.filter((row) => brandCloudUserStatus(row).key === 'active').length;

  async function loadUsers(nextFilter = userFilter) {
    setUsersSource({ status: 'loading', message: '' });
    try {
      const params = new URLSearchParams();
      if (nextFilter !== 'all') params.set('status', nextFilter);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const result = await fetchJSON(`/api/admin/brand-clouds/${encodeURIComponent(brand.id)}/users${suffix}`);
      setUsers(result.brand_cloud_users || []);
      setUsersSource({ status: 'ready', message: '' });
    } catch (err) {
      setUsers([]);
      setUsersSource({ status: 'unavailable', message: userFacingBrandCloudError(err) });
    }
  }

  useEffect(() => {
    loadUsers('all');
  }, [brand.id]);

  async function changeUserFilter(nextFilter) {
    setUserFilter(nextFilter);
    await loadUsers(nextFilter);
  }

  async function updateStatus(nextStatus) {
    setMessage('');
    try {
      await onUpdateBrand(brand.id, { name: brand.name, status: nextStatus });
      setMessage(nextStatus === 'disabled' ? 'Brand Cloud disabled.' : 'Brand Cloud enabled.');
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function submitMember(event) {
    event.preventDefault();
    setMessage('');
    if (!member.brand_cloud_user_id.trim()) {
      setMessage('Brand User id is required.');
      return;
    }
    try {
      await onAssignMember(brand.id, { brand_cloud_user_id: member.brand_cloud_user_id.trim(), role: member.role });
      setMessage('Member assigned.');
      setMember({ brand_cloud_user_id: '', role: 'owner' });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function submitUser(event) {
    event.preventDefault();
    setMessage('');
    if (!user.email.trim() || !user.password.trim()) {
      setMessage('Email and password are required.');
      return;
    }
    try {
      const result = await onCreateUser(brand.id, {
        email: user.email.trim(),
        password: user.password,
        display_name: user.display_name.trim() || undefined,
        role: user.role,
        rotate_password: true,
      });
      setMessage(result.action === 'created' ? 'Brand user created and assigned.' : 'Brand user reactivated or assigned.');
      setUser({ email: '', password: '', display_name: '', role: 'admin' });
      await loadUsers(userFilter);
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function updateBrandUser(row, action) {
    setMessage('');
    try {
      if (action === 'delete' && !window.confirm(`Remove Brand Cloud access for ${row.email}?`)) return;
      const path = `/api/admin/brand-clouds/${encodeURIComponent(brand.id)}/users/${encodeURIComponent(row.id)}`;
      if (action === 'delete') {
        await sendJSONWithMethod('DELETE', path);
        setMessage('Brand user removed.');
      } else {
        await sendJSONWithMethod('POST', `${path}/${action}`, {});
        if (action === 'approve') {
          setMessage('Brand user approved.');
        } else {
          setMessage(action === 'disable' ? 'Brand user disabled.' : 'Brand user enabled.');
        }
      }
      await loadUsers(userFilter);
    } catch (err) {
      setMessage(userFacingBrandCloudError(err));
    }
  }

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="drawer-panel brand-cloud-drawer" role="dialog" aria-modal="true" aria-label="Brand Cloud detail" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <h2>{brand.name || brand.id}</h2>
            <p>{brand.id} / {brand.organization_kind || 'brand_cloud'}</p>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close Brand Cloud drawer">x</button>
        </div>
        <section className={`brand-cloud-detail-hero brand-cloud-detail-${brandCloudStatusKey(brand)}`}>
          <div className="brand-cloud-status-block">
            <StatusBadge value={brandCloudStatusKey(brand)} label={brandCloudStatusLabel(brand)} />
            <strong>{brand.name || brand.metadata?.brandname || brand.id}</strong>
            <small>{brand.id}</small>
          </div>
          <div className="brand-cloud-fact-grid">
            <div><Icon name="location-dot" /><span>Region</span><strong>{brandCloudRegion(brand)}</strong></div>
            <div><Icon name="layer-group" /><span>Tier</span><strong>{brandCloudTier(brand)}</strong></div>
            <div><Icon name="user-shield" /><span>Owner/Admin</span><strong>{owner || 'Unassigned'}</strong></div>
            <div><Icon name="video" /><span>Devices</span><strong>{brandCloudQuotaLabel(brand)}</strong></div>
          </div>
        </section>
        <section className="setup-list brand-cloud-setup-list" aria-label="Brand Cloud setup state">
          <span className="ok"><Icon name="circle-check" />Created</span>
          <span className={owner ? 'ok' : 'warn'}><Icon name={owner ? 'user-check' : 'user-clock'} />{owner ? 'Owner assigned' : 'Owner pending'}</span>
          <span className="neutral"><Icon name="key" />SSO unavailable</span>
          <span className="neutral"><Icon name="database" />{brand.updated_at ? `Updated ${formatRelativeTime(brand.updated_at)}` : 'No update time'}</span>
        </section>
        <section className="drawer-summary brand-cloud-summary">
          <article>
            <Icon name="users" />
            <strong>{users.length}</strong>
            <span>Total users</span>
          </article>
          <article>
            <Icon name="circle-check" />
            <strong>{activeUsers}</strong>
            <span>Active</span>
          </article>
          <article className={pendingUsers ? 'attention' : ''}>
            <Icon name="envelope-circle-check" />
            <strong>{pendingUsers}</strong>
            <span>Pending activation</span>
          </article>
          <article className={disabledUsers ? 'attention' : ''}>
            <Icon name="ban" />
            <strong>{disabledUsers}</strong>
            <span>Disabled</span>
          </article>
        </section>
        <div className="drawer-actions">
          <button type="button" className="ghost-button" onClick={() => updateStatus(disabled ? 'active' : 'disabled')}>
            <Icon name={disabled ? 'rotate-right' : 'ban'} />{disabled ? 'Re-enable Brand Cloud' : 'Disable Brand Cloud'}
          </button>
          <a className="inline-action action-link" href={`/admin/sso?org=${encodeURIComponent(brand.id)}`}>
            <Icon name="key" />Open SSO Providers
          </a>
        </div>
        <section className="brand-cloud-users">
          <div className="panel-head compact-head">
            <div>
              <h3>Brand Users</h3>
              <p>Review activation state and manage brand-scoped access.</p>
            </div>
            <select className="input small-input" value={userFilter} onChange={(event) => changeUserFilter(event.target.value)} aria-label="Filter Brand Cloud users">
              <option value="all">All users</option>
              <option value="active">Active</option>
              <option value="pending_verification">Pending activation</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
          {usersSource.status === 'loading' ? <p className="empty-state">Loading Brand Cloud users...</p> : null}
          {usersSource.status === 'unavailable' ? <p className="form-message">{usersSource.message}</p> : null}
          {usersSource.status === 'ready' && !users.length ? <p className="empty-state">No Brand Cloud users match this view.</p> : null}
          {usersSource.status === 'ready' && users.length ? (
            <div className="table-wrap mini-table">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((row) => {
                    const status = brandCloudUserStatus(row);
                    return (
                      <tr key={row.id}>
                        <td><strong>{row.email}</strong><small>{row.display_name || row.id}</small></td>
                        <td><StatusBadge value={status.key === 'pending_verification' ? 'setup_required' : status.key} label={status.label} /></td>
                        <td>{row.updated_at ? formatRelativeTime(row.updated_at) : '-'}</td>
                        <td>
                          <div className="row-actions">
                            {status.key === 'disabled' ? (
                              <button type="button" className="inline-action" onClick={() => updateBrandUser(row, 'enable')}><Icon name="rotate-right" />Enable</button>
                            ) : status.key === 'pending_verification' ? (
                              <>
                                <button type="button" className="inline-action" onClick={() => updateBrandUser(row, 'approve')}><Icon name="circle-check" />Approve</button>
                                <button type="button" className="inline-action" onClick={() => updateBrandUser(row, 'disable')}><Icon name="ban" />Disable</button>
                              </>
                            ) : (
                              <button type="button" className="inline-action" onClick={() => updateBrandUser(row, 'disable')}><Icon name="ban" />Disable</button>
                            )}
                            <button type="button" className="inline-action danger-link" onClick={() => updateBrandUser(row, 'delete')}><Icon name="trash" />Delete</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
        <section className="brand-cloud-form-grid">
          <form className="drawer-form compact" onSubmit={submitMember}>
            <h3><Icon name="user-plus" />Assign Existing Brand User</h3>
            <label>Brand User id<input className="input" value={member.brand_cloud_user_id} onChange={(event) => setMember((current) => ({ ...current, brand_cloud_user_id: event.target.value }))} /></label>
            <label>Role<select className="input" value={member.role} onChange={(event) => setMember((current) => ({ ...current, role: event.target.value }))}><option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option></select></label>
            <button type="submit" className="primary-button"><Icon name="user-check" />Assign Existing Brand User</button>
          </form>
          <form className="drawer-form compact" onSubmit={submitUser}>
            <h3><Icon name="envelope-circle-check" />Create Or Reactivate Brand User</h3>
            <label>Email<input className="input" type="email" value={user.email} onChange={(event) => setUser((current) => ({ ...current, email: event.target.value }))} /></label>
            <label>Temporary password<input className="input" type="password" value={user.password} onChange={(event) => setUser((current) => ({ ...current, password: event.target.value }))} /></label>
            <label>Display name<input className="input" value={user.display_name} onChange={(event) => setUser((current) => ({ ...current, display_name: event.target.value }))} /></label>
            <label>Role<select className="input" value={user.role} onChange={(event) => setUser((current) => ({ ...current, role: event.target.value }))}><option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option></select></label>
            <button type="submit" className="primary-button"><Icon name="plus" />Create Or Reactivate User</button>
          </form>
        </section>
        {message ? <p className="form-message">{message}</p> : null}
      </aside>
    </div>
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
          <span>Client secrets are sent only to Account Manager and are never returned by this console. OIDC is the first supported protocol; SAML is not implemented.</span>
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
        protocol: 'oidc',
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
          <small>{ssoProtocolLabel(provider.protocol)}</small>
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
      {icon ? <span className="metric-icon" aria-hidden="true"><Icon name={icon} /></span> : null}
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </div>
  );
}

function WindowToggle({ value, onChange, label, disabled = false, options = ['7d', '30d'] }) {
  return (
    <div className="window-toggle" role="tablist" aria-label={label}>
      {options.map((option) => (
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

function RecentAlertsPanel({ loading, alerts, source, onOpenDevice }) {
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
            <button type="button" className="alerts-table-row" key={alert.id} onClick={() => onOpenDevice(alert.device_id)}>
              <time title={alert.occurred_at}>{formatRelativeTime(alert.occurred_at)}</time>
              <strong>{alert.device_name}</strong>
              <span>{alert.signal}</span>
              <StatusBadge value={normalizeStatusKey(alert.health)} label={toTitleCase(alert.health)} />
            </button>
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

function StreamAttentionPanel({ stats, onOpenDevice }) {
  const items = streamAttentionRows(stats);
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
    {
      key: 'actions',
      label: 'Actions',
      sortable: false,
      value: () => '',
      render: (device) => (
        <button
          type="button"
          className="table-action-button"
          onClick={(event) => {
            event.stopPropagation();
            setSelectedDeviceId(device.id);
          }}
        >
          Inspect
        </button>
      ),
    },
  ], [setSelectedDeviceId]);

  const selectedTelemetry = selectedDevice ? telemetryById[selectedDevice.id] || null : null;
  const telemetryBusy = deviceDrawerOpen && selectedDevice?.id && telemetryLoadingId === selectedDevice.id && !selectedTelemetry;
  const activeMembership = getActiveMembership(me);
  const capabilitySubject = { capabilities: me?.capabilities || activeMembership?.capabilities || [] };
  const readOnly = !canUseCapability(capabilitySubject, 'customer.devices.provision') && !canUseCapability(capabilitySubject, 'customer.devices.deactivate') && isReadOnlyRole(activeMembership?.role);

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
              <span className="mobile-row-action">Inspect</span>
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
          capabilities={capabilitySubject.capabilities}
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

function DeviceDrawer({ device, telemetry, loading, error, readOnly, capabilities, onClose, onAction }) {
  const drawerName = telemetry?.device_name || device?.name || 'Device selected';
  const drawerOrganization = telemetry?.organization || device?.organization || '—';
  const drawerModel = telemetry?.model || device?.model || '—';
  const drawerSerial = telemetry?.serial_number || device?.serial_number || '—';
  const drawerLastSeen = telemetry?.last_seen_at || device?.last_seen_at || '';
  const drawerFirmware = telemetry?.firmware_version || device?.firmware_version || '—';
  const telemetryAvailable = telemetry?.telemetry_status === 'available';
  const telemetryState = telemetrySourceState({ telemetry, loading, error });
  const telemetryUnavailableText = telemetryState.message || 'Telemetry source is unavailable for this device.';
  const streamStatus = deriveStreamStatus(telemetry);
  const actionContext = { readOnly, capabilities, telemetryStatus: telemetry?.telemetry_status };
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
                <strong>{telemetryState.title}</strong>
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
  if (!operations.length) return <p className="empty-state compact-empty">No operations need attention.</p>;
  return (
    <div className={`operation-list ${detailed ? 'operation-list-detailed' : ''}`}>
      {operations.map((operation) => {
        const state = normalizeStatusKey(operation.state);
        return (
          <article key={operation.id} className={`operation operation-${state}`}>
            <div className="operation-row-icon"><Icon name={operationIconName(state)} /></div>
            <div className="operation-main">
              <strong>{operationSummary(operation)}</strong>
              <span>{operation.organization || 'Unknown tenant'} / {operation.device_name || operation.device_id || 'Unknown device'}</span>
              {detailed ? <p>{operation.message}</p> : null}
            </div>
            <StatusBadge value={operation.state} />
          </article>
        );
      })}
    </div>
  );
}

function AuditLog({ audit, compact = false, loading = false }) {
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
          <p>{auditCoverageCopy()}</p>
        </div>
      </div>
      {loading && !audit.length ? (
        <p className="empty-state">Loading audit events.</p>
      ) : compact && audit.length ? (
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
      ) : !audit.length ? (
        <p className="empty-state">No audit events recorded.</p>
      ) : compact ? (
        <p className="empty-state">No audit events recorded.</p>
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
  if (compact) {
    if (!health.length) return <p className="empty-state compact-empty">No service checks reported.</p>;
    return (
      <section className="health compact">
        {health.map((item) => (
          <div className={`health-row health-row-${normalizeStatusKey(item.status)}`} key={item.name}>
            <div className="health-row-icon"><Icon name={serviceHealthIconName(item.name, item.status)} /></div>
            <div className="health-service">
              <strong>{item.name}</strong>
              <span>{item.detail}</span>
            </div>
            <div className="health-meta">
              {item.latency_ms ? <small>{item.latency_ms} ms</small> : null}
              <StatusBadge value={item.status} />
            </div>
          </div>
        ))}
      </section>
    );
  }
  return (
    <section className="panel health">
      <h2>Service health</h2>
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

function serviceHealthIconName(name, status) {
  const normalized = normalizeStatusKey(status);
  if (normalized !== 'ok') return 'triangle-exclamation';
  const service = String(name || '').toLowerCase();
  if (service.includes('account')) return 'users-gear';
  if (service.includes('video')) return 'video';
  if (service.includes('sqlite')) return 'database';
  return 'server';
}

function StatusBadge({ value, label }) {
  const text = label ?? statusDisplayText(value);
  const icon = statusIconName(value);
  return (
    <span className={`status status-${String(value).replaceAll('_', '-')}`}>
      {icon ? <Icon name={icon} /> : null}
      {text}
    </span>
  );
}

function CompactStatus({ value, label }) {
  return (
    <span className="compact-status">
      <StatusDot value={value} />
      {label ?? statusDisplayText(value)}
    </span>
  );
}

function StatusDot({ value }) {
  return <span className={`status-dot status-dot-${normalizeStatusKey(value).replaceAll('_', '-')}`} aria-hidden="true" />;
}

function statusDisplayText(value) {
  const normalized = normalizeStatusKey(value);
  if (normalized === 'ok') return 'OK';
  return toTitleCase(String(value || 'unknown').replaceAll('_', ' '));
}

function Icon({ name }) {
  return <i className={`fa-solid fa-${name}`} aria-hidden="true" />;
}

function statusIconName(value) {
  const normalized = normalizeStatusKey(value);
  if (['ok', 'online', 'healthy', 'succeeded', 'present', 'configured', 'active'].includes(normalized)) return 'circle-check';
  if (['activated', 'published', 'demo'].includes(normalized)) return 'circle-dot';
  if (['warning', 'cloud-activation-pending', 'pending', 'retrying', 'stale', 'missing', 'degraded'].includes(normalized)) return 'triangle-exclamation';
  if (['critical', 'failed', 'dead-lettered', 'down'].includes(normalized)) return 'circle-exclamation';
  if (['unavailable', 'unmonitored', 'unconfigured', 'unknown', 'inactive'].includes(normalized)) return 'circle-minus';
  return 'circle-info';
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

function sessionLabel(me) {
  if (!me?.authenticated) return 'Not signed in';
  if (me.kind === 'platform_admin') return 'Platform Admin · All tenants';
  const membership = getActiveMembership(me);
  return roleLabel(membership?.role);
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

function operationIconName(state) {
  if (['failed', 'dead-lettered', 'critical'].includes(state)) return 'triangle-exclamation';
  if (['published', 'pending', 'retrying', 'open'].includes(state)) return 'clock-rotate-left';
  if (['succeeded', 'ok', 'active'].includes(state)) return 'circle-check';
  return 'circle-info';
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

async function sendJSONWithMethod(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 401) throw new AuthError(401, 'Session expired; please sign in again.');
  if (response.status === 403) throw new AuthError(403, 'Access denied.');
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    const error = new Error(details || `${url} failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
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
        device_id: device.id,
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

function formatTrendAxisLabel(date, range) {
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) return { primary: date, secondary: '' };
  const value = new Date(parsed);
  const normalizedRange = String(range || '24h').toLowerCase();
  if (normalizedRange === '24h') {
    return {
      primary: new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false }).format(value),
      secondary: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(value),
    };
  }
  if (normalizedRange === '7d') {
    return {
      primary: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(value),
      secondary: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(value),
    };
  }
  return {
    primary: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(value),
    secondary: new Intl.DateTimeFormat('en', { year: 'numeric' }).format(value),
  };
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
