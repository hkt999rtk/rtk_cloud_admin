import { DeveloperDocs } from './DeveloperDocs.jsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MyCloudsApp } from './MyClouds.jsx';
import { CloudConsoleShell } from './CloudConsoleShell.jsx';
import { CustomerAudit } from './ConsoleUI.jsx';
import { productInvitationDestination } from './cloud-products.mjs';
import { OwnerHandoffPage } from './OwnerHandoff.jsx';
import { handoffRoute } from './owner-handoff.mjs';
import { cloudBillingRoute, billingAPI, billingScopeError, fetchCloudBillingData } from './cloud-billing.mjs';
import './cloud-billing.css';
import { cloudAPI, cloudURL, managedCloudRoute, managedCloudRequest, cloudWriteIntent } from './managed-clouds.mjs';
import { scopedCustomerAPI } from './cloud-scope.mjs';
import { ProvisioningPage } from './ProvisioningPage.jsx';
import { Pro2FirmwareBurner, PRO2_FIRMWARE_BURNER_PATH } from './Pro2FirmwareBurner.jsx';
import { BrandCloudCreateDrawer } from './BrandCloudCreateDrawer.jsx';
import { I18nextProvider } from 'react-i18next';
import { feature } from 'topojson-client';
import worldAtlas from 'world-atlas/countries-110m.json';
import { createP256CSR, downloadExportableBundle } from './certificateBundle.mjs';
import { firmwareArtifactMetadata, formatFirmwareSize } from './firmwareArtifact.mjs';
import {
  billingSubpaths,
  canAccessCustomerRoute,
  canonicalCustomerPath,
  cloudContextId,
  cloudRouteForSwitch,
  cloudConsolePath,
  cloudIdFromPath,
  defaultBrandCloudRoute,
  isCustomerNavItemActive,
  navGroupsForCapabilities,
  devicesPathWithFilters,
  isPlatformRouteId,
  isPublicRouteId,
  routeFromLocation,
  titleFor,
} from './routes.mjs';
import {
  isExpiredVerificationError,
  postJSON,
  putJSON,
  startSocialLogin,
  startSSOLogin,
  socialLoginCallbackError,
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
  isPlatformLoginNext,
  loginNextFromLocation,
  loginPathFor,
  protectedPathFromLocation,
  removeQueryParameterFromAddress,
} from './auth-routing.mjs';
import {
  forgetCloudPreference,
  preferredCloudID,
  readCloudPreference,
  rememberCloudPreference,
} from './cloud-preference.mjs';
import { quotaRaiseErrorMessage, quotaUsageLabel } from './auth-state.mjs';
import { canUseCapability, deviceActionState, isReadOnlyRole } from './device-actions.mjs';
import {
  firmwareCampaignActions,
  firmwareCampaignDetailRows,
  firmwareCampaignNeedsPolling,
  firmwareCampaignProgress,
  firmwareCampaignWaitingProgress,
  firmwareCampaignStatusLabel,
  firmwareDashboardAction,
  firmwarePolicyLabel,
  firmwareRiskRows,
  firmwareRolloutStatusLabel,
  firmwareVersionFilterValue,
  sortFirmwareCampaignsByStartTime,
} from './firmware.mjs';
import {
  auditCoverageCopy,
  formatResourcePercent,
  formatThroughputBPS,
  grafanaEmbedState,
  platformDashboardHealth,
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
import {
  AUTO_TOPUP_CONSENT,
  AUTO_TOPUP_CONSENT_TEXT,
  PAYMENT_METHOD_CONSENT,
  PAYMENT_METHOD_CONSENT_TEXT,
  autoTopUpAssessment,
  billingErrorMessage,
  formatMinorAmount,
  paymentIntentState,
  paymentMethodLabel,
} from './billing.mjs';
import {
  chipsetVendors,
  compactHash,
  filterChipsets,
  filterProviders,
  formatProviderTimestamp,
  providerEndpointCount,
  providerKPIs,
  providerSyncHealth,
  providerValidationErrorMessage,
  vendorInitials,
} from './chipset-sdk.mjs';
import { formatSDKBytes, sdkArtifactFormat, sdkArtifacts, sdkDocumentationURL } from './sdk-catalog.mjs';
import '@fortawesome/fontawesome-free/css/all.min.css';
import '@fontsource-variable/noto-sans-tc';
import './styles.css';
import './console-ui.css';
import './service-login.css';
import './developer-tools-ui.css';
import i18n, { FORMAT_LOCALE, formatDateTime, formatNumber, translate } from './i18n/index.mjs';

const DEFAULT_PAGE_SIZE = 8;

const PRODUCT_SERVICE_CAPABILITIES = Object.freeze([
  { code: 'video_streaming', label: 'Live View' },
  { code: 'video_storage', label: 'Recording and Storage' },
  { code: 'mqtt', label: 'Device Telemetry' },
]);

function normalizeProductServiceCapability(value) {
  const aliases = {
    '即時觀看': 'video_streaming',
    '影像服務': 'video_streaming',
    '錄影與保存': 'video_storage',
    '設備回報': 'mqtt',
    '韌體更新': 'ota',
  };
  return aliases[value] || value;
}

function productServiceCapabilityLabel(value) {
  const code = normalizeProductServiceCapability(value);
  return PRODUCT_SERVICE_CAPABILITIES.find((item) => item.code === code)?.label
    || (code === 'ota' ? 'Firmware OTA' : code);
}

function brandCloudsURL({ query, status, tier, limit, offset }) {
  const params = new URLSearchParams();
  params.set('limit', String(limit || 25));
  params.set('offset', String(offset || 0));
  if (String(query || '').trim()) params.set('q', String(query).trim());
  if (status && status !== 'all') params.set('status', status);
  if (tier && tier !== 'all') params.set('tier', tier);
  return `/api/admin/brand-clouds?${params.toString()}`;
}

function fleetDevicesURL(search = '') {
  const source = new URLSearchParams(search);
  const params = new URLSearchParams();
  for (const key of ['q', 'product_id', 'category', 'model', 'status', 'readiness', 'firmware', 'sort', 'direction', 'limit', 'offset']) {
    const value = source.get(key);
    if (value) params.set(key, value);
  }
  const status = source.get('status');
  const firmware = source.get('firmware');
  if (status && !params.has('readiness')) {
    params.set('readiness', status);
    params.delete('status');
  }
  if (firmware) params.set('firmware', firmware);
  if (!params.has('limit')) params.set('limit', '100');
  return `/api/fleet/devices?${params.toString()}`;
}


async function fetchBrandCloudAccessData(cloudId, { includeAssignments = false } = {}) {
  const unavailable = (message) => ({ source_status: 'unavailable', source_message: message });
  const read = async (path, fallback) => fetchJSON(path).catch((err) => {
    if (err.isAuthError) throw err;
    return unavailable(fallback);
  });
  const membersRequest = cloudId
    ? read(`/api/developer/brand-clouds/${encodeURIComponent(cloudId)}/members`, translate('Member data is temporarily unavailable.'))
    : Promise.resolve(unavailable(translate('No Brand Cloud is selected.')));
  const invitationsRequest = cloudId
    ? read(`/api/developer/brand-clouds/${encodeURIComponent(cloudId)}/members/invitations`, translate('Invitation data is temporarily unavailable.'))
    : Promise.resolve(unavailable(translate('No Brand Cloud is selected.')));
  const assignmentsRequest = includeAssignments
    ? read('/api/role-assignments', translate('Roles and management scopes are temporarily unavailable.'))
    : Promise.resolve({ source_status: 'not_loaded' });
  const [membersResult, invitationsResult, assignmentsResult] = await Promise.all([
    membersRequest,
    invitationsRequest,
    assignmentsRequest,
  ]);
  const requiredSources = includeAssignments
    ? [membersResult, invitationsResult, assignmentsResult]
    : [membersResult, invitationsResult];
  const availableCount = requiredSources.filter((source) => source.source_status !== 'unavailable').length;
  return {
    members: membersResult.members || [],
    invitations: invitationsResult.invitations || [],
    role_assignments: assignmentsResult.role_assignments || [],
    roles: assignmentsResult.roles || [],
    members_source_status: membersResult.source_status || 'available',
    invitations_source_status: invitationsResult.source_status || 'available',
    assignments_source_status: assignmentsResult.source_status || 'available',
    source_status: availableCount === requiredSources.length ? 'available' : availableCount ? 'partial' : 'unavailable',
    source_message: requiredSources
      .filter((source) => source.source_status === 'unavailable')
      .map((source) => source.source_message)
      .filter(Boolean)
      .join(' '),
  };
}

function App() {
  const urlCloudId = cloudIdFromPath(window.location.pathname);
  const isPro2FirmwareBurner = window.location.pathname === PRO2_FIRMWARE_BURNER_PATH;
  const apiPath = useCallback((path) => scopedCustomerAPI(path, urlCloudId), [urlCloudId]);
  const [active, setActive] = useState(routeFromLocation());
  const [me, setMe] = useState(null);
  const [summary, setSummary] = useState(null);
  const [fleetSummary, setFleetSummary] = useState(null);
  const [fleetHealth, setFleetHealth] = useState(null);
  const [streamStats, setStreamStats] = useState(null);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [fleetDevices, setFleetDevices] = useState(null);
  const [operations, setOperations] = useState([]);
  const [health, setHealth] = useState([]);
  const [serviceLogs, setServiceLogs] = useState(null);
  const [audit, setAudit] = useState([]);
  const [platformDashboard, setPlatformDashboard] = useState(null);
  const [platformGrafanaStatus, setPlatformGrafanaStatus] = useState(null);
  const [brandClouds, setBrandClouds] = useState([]);
  const [developerBrandClouds, setDeveloperBrandClouds] = useState([]);
  const [brandCloudPagination, setBrandCloudPagination] = useState({ limit: 25, offset: 0, total: 0 });
  const [brandCloudQuery, setBrandCloudQuery] = useState('');
  const [brandCloudStatus, setBrandCloudStatus] = useState('all');
  const [brandCloudTierFilter, setBrandCloudTierFilter] = useState('all');
  const [brandCloudSource, setBrandCloudSource] = useState({ status: 'idle', message: '' });
  const [selectedBrandCloudId, setSelectedBrandCloudId] = useState('');
  const [brandCloudDrawerMode, setBrandCloudDrawerMode] = useState('');
  const [ssoProviders, setSSOProviders] = useState([]);
  const [chipsets, setChipsets] = useState(null);
  const [sdkCatalog, setSDKCatalog] = useState(null);
  const [chipsetProviders, setChipsetProviders] = useState(null);
  const [firmwareDistribution, setFirmwareDistribution] = useState(null);
  const [firmwareProductId, setFirmwareProductId] = useState(() => new URLSearchParams(window.location.search).get('product_id') || '');
  const [products, setProducts] = useState(null);
  const [releases, setReleases] = useState([]);
  const [reports, setReports] = useState(null);
  const [groups, setGroups] = useState(null);
  const [access, setAccess] = useState(null);
  const [billing, setBilling] = useState(null);
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
  const isGlobalDeveloperRoute = active === 'chipset-sdk' || active === 'developer-docs';
  const isMemberInvitationAccept = active === 'brand-cloud-member-invitation-accept' || active === 'product-collaborator-invitation-accept';
  const navigationRoute = me?.kind === 'platform_admin'
    ? 'platform-dashboard'
    : me?.kind === 'customer' ? 'overview' : active;
  const visibleNavGroups = navGroupsForCapabilities(navigationRoute, me?.capabilities);
  const needsPlatformAccess = isPlatformView && me?.kind !== 'platform_admin';
  const brandCloudsBlocked = active === 'platform-brand-clouds' && me?.kind === 'platform_admin' && !me?.upstream_account_manager;
  const customerViewPending = !isPlatformView && !isPublicRoute && me === null;
  const customerCapabilityBlocked = !isMemberInvitationAccept && !isPlatformView && !isPublicRoute && me?.authenticated && me.kind === 'customer' && !canAccessCustomerRoute(active, me.capabilities);
  const customerViewBlocked = !isPlatformView && !isPublicRoute && me !== null && (me.authenticated === false || me.kind === 'platform_admin' || customerCapabilityBlocked);

  useEffect(() => {
    if (active === 'login') return;
    document.title = `${titleFor(active)} · RTK Cloud`;
  }, [active]);

  useEffect(() => {
    const canonicalPath = canonicalCustomerPath(window.location.pathname);
    if (canonicalPath !== window.location.pathname) {
      window.history.replaceState({}, '', `${canonicalPath}${window.location.search}${window.location.hash}`);
    }
  }, []);

  function clearDashboardState() {
    setSummary(null);
    setFleetSummary(null);
    setFleetHealth(null);
    setStreamStats(null);
    setRecentAlerts([]);
    setCustomers([]);
    setDevices([]);
    setFleetDevices(null);
    setOperations([]);
    setHealth([]);
    setServiceLogs(null);
    setAudit([]);
    setPlatformDashboard(null);
    setPlatformGrafanaStatus(null);
    setBrandClouds([]);
    setDeveloperBrandClouds([]);
    setBrandCloudPagination({ limit: 25, offset: 0, total: 0 });
    setBrandCloudSource({ status: 'idle', message: '' });
    setSelectedBrandCloudId('');
    setBrandCloudDrawerMode('');
    setSSOProviders([]);
    setChipsets(null);
    setSDKCatalog(null);
    setChipsetProviders(null);
    setFirmwareDistribution(null);
    setFirmwareProductId('');
    setProducts(null);
    setReports(null);
    setGroups(null);
    setBilling(null);
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
        let nextMe = await fetchJSON('/api/me');
        if (!alive) return;
        setMe(nextMe);

        if (isLoginRoute) {
          if (nextMe.authenticated) {
            window.location.replace(browserSessionDestination(nextMe, loginNextFromLocation(window.location)));
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

        const requestedCloudId = isGlobalDeveloperRoute ? cloudContextId(window.location.pathname, window.location.search) : cloudIdFromPath(window.location.pathname);
        if (nextMe.kind === 'customer' && requestedCloudId && (isGlobalDeveloperRoute || window.location.pathname.startsWith('/console/clouds/'))) {
          const scopedCloud = await fetchJSON(cloudAPI(requestedCloudId));
          if (scopedCloud.brand_cloud?.id === requestedCloudId) rememberCloudPreference(requestedCloudId);
          nextMe = {
            ...nextMe,
            active_org_id: requestedCloudId,
            active_organization: scopedCloud.brand_cloud,
            capabilities: scopedCloud.brand_cloud?.capabilities || [],
          };
          if (!alive) return;
          setMe(nextMe);
        } else if (nextMe.kind === 'customer' && requestedCloudId && requestedCloudId !== nextMe.active_org_id) {
          const switchResponse = await fetch('/api/me/active-org', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organization_id: requestedCloudId }) });
          if (!switchResponse.ok) {
            setError('Access forbidden: This Brand Cloud is not available to the signed-in developer.');
            setLoading(false);
            return;
          }
          window.location.reload();
          return;
        }

        if (!isMemberInvitationAccept && !isPlatformView && nextMe.kind === 'customer' && !canAccessCustomerRoute(active, nextMe.capabilities)) {
          setBilling(null);
          setLoading(false);
          return;
        }

        if (nextMe.kind === 'customer') {
          const developerCloudResult = await fetchJSON('/api/developer/brand-clouds').catch((err) => {
            if (err.isAuthError) throw err;
            return { brand_clouds: [] };
          });
          if (!alive) return;
          setDeveloperBrandClouds(developerCloudResult.brand_clouds || []);
        } else {
          setDeveloperBrandClouds([]);
        }

        if (!useAdminApi && ['developer-docs', 'audit'].includes(active) && nextMe.kind === 'customer') {
          setSummary(null);
          setDevices([]);
          setLoading(false);
          return;
        }

        // ChipSet & SDK is a global developer resource. Do not make retired,
        // cloud-owned fleet requests just to render this page.
        if (!useAdminApi && active === 'chipset-sdk' && nextMe.kind === 'customer' && isPro2FirmwareBurner) {
          setChipsets(null);
          setSDKCatalog(null);
          setSummary(null);
          setDevices([]);
          setLoading(false);
          return;
        }

        if (!useAdminApi && active === 'chipset-sdk' && nextMe.kind === 'customer') {
          const [result, releaseResult] = await Promise.all([
            fetchJSON('/api/developer/chipsets').catch((err) => {
              if (err.isAuthError) throw err;
              return { chipsets: [], source_status: 'unavailable', source_message: 'ChipSet resources are unavailable.' };
            }),
            fetchJSON('/api/developer/sdk-releases/latest').catch((err) => {
              if (err.isAuthError) throw err;
              return { catalog: null, source_status: err.status === 503 ? 'unpublished' : 'unavailable', source_message: err.status === 503 ? 'No Cloud Client SDK release has been published yet.' : 'Cloud Client SDKs are temporarily unavailable.' };
            }),
          ]);
          if (!alive) return;
          setChipsets(result);
          setSDKCatalog(releaseResult);
          setSummary(null);
          setDevices([]);
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
              fetchJSON(apiPath('/api/fleet/summary')),
              Promise.resolve([]),
              fetchJSON(apiPath('/api/fleet/devices?limit=100')).then((page) => page.devices || []),
              Promise.resolve([]),
              Promise.resolve([]),
              Promise.resolve([]),
              Promise.resolve(null),
            ];
        const [nextSummary, nextCustomers, nextDevices, nextOperations, nextHealth, nextAudit, nextPlatformDashboard] = await Promise.all(baseRequests);
        if (!alive) return;
        setSummary(nextSummary);
        if (active === 'overview' && nextMe.kind !== 'platform_admin') {
          const nextFleetSummary = await fetchJSON(apiPath('/api/fleet/summary')).catch((err) => {
            if (err.isAuthError) throw err;
            return { source_status: 'unavailable', source_message: translate('Fleet statistics are temporarily unavailable.') };
          });
          if (!alive) return;
          setFleetSummary(nextFleetSummary);
        } else {
          setFleetSummary(null);
        }
        setCustomers(nextCustomers);
        setDevices(nextDevices);
        if (active === 'devices' && nextMe.kind !== 'platform_admin') {
          const nextFleetDevices = await fetchJSON(apiPath(fleetDevicesURL(window.location.search))).catch((err) => {
            if (err.isAuthError) throw err;
            return { devices: [], pagination: { limit: 100, offset: 0, total: 0 }, source_status: 'unavailable', source_message: translate('The device query service is temporarily unavailable.') };
          });
          if (!alive) return;
          setFleetDevices(nextFleetDevices);
        } else {
          setFleetDevices(null);
        }
        setOperations(nextOperations);
        setHealth(nextHealth);
        if (useAdminApi && ['platform-dashboard', 'platform-logs'].includes(active)) {
          const logs = await fetchJSON('/api/admin/service-logs?service=workspace-readiness').catch((err) => ({
            status: 'degraded',
            message: 'Central service logging is unavailable.',
            events: [],
          }));
          if (!alive) return;
          setServiceLogs(logs);
        } else {
          setServiceLogs(null);
        }
        setAudit(nextAudit);
        setPlatformDashboard(nextPlatformDashboard);
        if (useAdminApi && active === 'platform-grafana') {
          const nextGrafanaStatus = await fetchJSON('/api/admin/grafana/status').catch((err) => {
            if (err.isAuthError) throw err;
            return {
              enabled: false,
              source_status: 'unavailable',
              source_message: 'Grafana status is unavailable.',
            };
          });
          if (!alive) return;
          setPlatformGrafanaStatus(nextGrafanaStatus);
        } else {
          setPlatformGrafanaStatus(null);
        }
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
        if (useAdminApi && active === 'platform-chipset-providers') {
          const result = await fetchJSON('/api/admin/chipset-providers').catch((err) => {
            if (err.isAuthError) throw err;
            return { providers: [], source_status: 'unavailable', source_message: 'Provider catalog is unavailable.' };
          });
          if (!alive) return;
          setChipsetProviders(result);
        } else {
          setChipsetProviders(null);
        }
        setChipsets(null);
        setSDKCatalog(null);
        if (active === 'firmware-ota' && nextMe.kind !== 'platform_admin' && firmwareProductId) {
          const nextFirmwareDistribution = await fetchJSON(apiPath(`/api/fleet/firmware-distribution?product_id=${encodeURIComponent(firmwareProductId)}`))
            .catch((err) => {
              if (err.isAuthError) throw err;
              return sourceUnavailableFromError('firmware', err);
            });
          if (!alive) return;
          setFirmwareDistribution(nextFirmwareDistribution);
        } else {
          setFirmwareDistribution(null);
        }

        if (['product-services', 'firmware-ota', 'reports', 'provisioning', 'settings'].includes(active) && nextMe.kind !== 'platform_admin') {
          const nextProducts = await fetchJSON(apiPath('/api/products')).catch((err) => {
            if (err.isAuthError) throw err;
            return { products: [], source_status: 'unavailable', source_message: translate('Product data is temporarily unavailable.') };
          });
          if (!alive) return;
          setProducts(nextProducts);
          if (active === 'firmware-ota' && firmwareProductId && nextProducts?.products?.some((product) => product.id === firmwareProductId)) {
            const selectedProduct = nextProducts.products.find((product) => product.id === firmwareProductId);
            const releaseResult = await fetchJSON(apiPath(`/api/products/${encodeURIComponent(firmwareProductId)}/releases`)).catch((err) => {
              if (err.isAuthError) throw err;
              return { items: [], releases: [] };
            });
            if (!alive) return;
            setReleases((releaseResult?.items || releaseResult?.releases || []).map((release) => ({ ...release, product_id: selectedProduct.id, product_name: selectedProduct.name })));
          } else {
            setReleases([]);
          }
        } else {
          setProducts(null);
          setReleases([]);
        }
        if (['reports', 'groups'].includes(active) && nextMe.kind !== 'platform_admin') {
          const endpoint = apiPath(active === 'reports' ? '/api/reports' : '/api/groups');
          const result = await fetchJSON(endpoint).catch((err) => {
            if (err.isAuthError) throw err;
            return { [active]: [], source_status: 'unavailable', source_message: translate('Data is temporarily unavailable.') };
          });
          if (!alive) return;
          if (active === 'reports') setReports(result);
          else setGroups(result);
        } else {
          setReports(null);
          setGroups(null);
        }

        const canReadTeam = ['team.read', 'role_assignment.read'].some((capability) => (nextMe.capabilities || []).includes(capability));
        if (nextMe.kind === 'customer' && ['overview', 'access'].includes(active) && canReadTeam) {
          const nextAccess = await fetchBrandCloudAccessData(nextMe.active_org_id, { includeAssignments: active === 'access' });
          if (!alive) return;
          setAccess(nextAccess);
        } else {
          setAccess(null);
        }

        // Legacy Billing URLs cannot infer a target from shared active-org state.
        setBilling(null);

        if (nextMe.authenticated && nextMe.kind === 'customer' && !useAdminApi) {
          const streamWindowToUse = active === 'stream-health' ? streamWindow : overviewWindow;
          const [nextFleetHealth, nextStreamStats] = await Promise.all([
            fetchJSON(apiPath(`/api/fleet/health-summary?window=${overviewWindow}`))
              .catch((err) => {
                if (err.isAuthError) throw err;
                return sourceUnavailableFromError('telemetry', err);
              }),
            fetchJSON(apiPath(`/api/fleet/stream-stats?window=${streamWindowToUse}`))
              .catch((err) => {
                if (err.isAuthError) throw err;
                return sourceUnavailableFromError('stream', err);
              }),
          ]);
          if (!alive) return;
          setFleetHealth(nextFleetHealth);
          setStreamStats(nextStreamStats);
          if (active === 'overview' && sourceAvailable(nextFleetHealth)) {
            const nextAlerts = await fetchRecentAlerts(nextDevices, requestedCloudId);
            if (!alive) return;
            setRecentAlerts(nextAlerts);
          } else {
            setRecentAlerts([]);
          }
        } else {
          setFleetHealth(null);
          setStreamStats(null);
          setRecentAlerts([]);
          setBilling(null);
        }
      } catch (err) {
        if (!alive) return;
        if (err.isAuthError && err.status === 401) {
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
          setPlatformGrafanaStatus(null);
          setBrandClouds([]);
          setBrandCloudSource({ status: 'idle', message: '' });
          setSelectedBrandCloudId('');
          setBrandCloudDrawerMode('');
          setSSOProviders([]);
          setFirmwareDistribution(null);
          setProducts(null);
          setFleetHealth(null);
          setStreamStats(null);
          setRecentAlerts([]);
        }
        if (alive) {
          if (!isPlatformView && [403, 404].includes(err.status) && cloudIdFromPath(window.location.pathname)) {
            setError('Access forbidden: This Brand Cloud is not available to the signed-in developer.');
          } else {
            setError(active === 'platform-brand-clouds' ? userFacingBrandCloudError(err) : 'The requested data could not be loaded. Please try again.');
          }
        }
      } finally {
        if (alive) setLoading(false);
      }
    }
    loadData();
    return () => {
      alive = false;
    };
  }, [active, apiPath, brandCloudPagination.limit, brandCloudPagination.offset, brandCloudQuery, brandCloudStatus, brandCloudTierFilter, firmwareProductId, isLoginRoute, isPublicRoute, overviewWindow, refreshTick, streamWindow]);

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
    setFirmwareProductId('');
    setProducts(null);
    setFleetHealth(null);
    setStreamStats(null);
    setRecentAlerts([]);
    setBilling(null);
  }, [isLoginRoute, isPublicRoute]);

  useEffect(() => {
    const onPopState = () => {
      const nextRoute = routeFromLocation();
      setActive(nextRoute);
      setFirmwareProductId(nextRoute === 'firmware-ota' ? new URLSearchParams(window.location.search).get('product_id') || '' : '');
      const deviceId = deviceIdFromLocation();
      setSelectedDeviceId(deviceId);
      setDeviceDrawerOpen(Boolean(deviceId));
      if (nextRoute === 'devices') setRefreshTick((tick) => tick + 1);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const deviceId = deviceIdFromLocation();
    setSelectedDeviceId(deviceId);
    setDeviceDrawerOpen(Boolean(deviceId));
  }, [active]);

  function pathForNavigationItem(item) {
    const navigationCloudId = isGlobalDeveloperRoute
      ? cloudContextId(window.location.pathname, window.location.search) || me?.active_org_id || ''
      : urlCloudId;
    if (item.id === 'my-clouds' || item.global) return cloudConsolePath(navigationCloudId, item.id);
    if (me?.kind === 'platform_admin') return item.path;
    const targetRoute = item.id === 'overview' && me?.kind === 'customer' ? defaultBrandCloudRoute(me.capabilities) : item.id;
    return cloudConsolePath(navigationCloudId, targetRoute);
  }

  function navigate(item) {
    const path = pathForNavigationItem(item);
    if (item.global || me?.kind === 'platform_admin') {
      window.location.assign(path);
      return;
    }
    const targetRoute = item.id === 'overview' && me?.kind === 'customer' ? defaultBrandCloudRoute(me.capabilities) : item.id;
    if (['product-services', 'access', 'settings', 'billing', 'test-lab'].includes(targetRoute)) {
      window.location.assign(path);
      return;
    }
    window.history.pushState({}, '', path);
    if (targetRoute === 'firmware-ota') {
      setFirmwareDistribution(null);
      setFirmwareProductId('');
    }
    setActive(targetRoute);
  }

  function selectFirmwareProduct(productID) {
    const cloudId = me?.kind === 'customer' ? me.active_org_id : '';
    const path = cloudId ? cloudConsolePath(cloudId, 'firmware-ota') : '/console/firmware-ota';
    const params = new URLSearchParams();
    if (productID) params.set('product_id', productID);
    window.history.pushState({}, '', `${path}${params.size ? `?${params.toString()}` : ''}`);
    setFirmwareDistribution(null);
    setFirmwareProductId(productID);
  }

  function navigateBrandCloudTab(targetRoute) {
    const cloudId = me?.kind === 'customer' ? me.active_org_id : '';
    const path = cloudId ? cloudConsolePath(cloudId, targetRoute) : `/console/${targetRoute}`;
    window.history.pushState({}, '', path);
    setActive(targetRoute);
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

  function openDevicesForFirmware(version, productID) {
    setSelectedDeviceId('');
    setDeviceDrawerOpen(false);
    updateDevicesLocation({ deviceId: '', health: '', firmware: firmwareVersionFilterValue(version), productID });
    setActive('devices');
  }

  const refreshFirmwareStatus = useCallback(async () => {
    const next = await fetchJSON(apiPath('/api/fleet/firmware-distribution')).catch((err) => sourceUnavailableFromError('firmware', err));
    setFirmwareDistribution(next);
    return next;
  }, [apiPath]);

  async function runDeviceAction(deviceId, action) {
    setError('');
    const response = await fetch(apiPath(`/api/devices/${deviceId}/${action}`), { method: 'POST', headers: { 'Idempotency-Key': `device-${action}-${deviceId}-${Date.now()}` } });
    if (!response.ok) {
      setError(`${action} failed with ${response.status}`);
      return;
    }
    setRefreshTick((tick) => tick + 1);
    updateDevicesLocation({ deviceId });
    setActive('devices');
  }

  async function runUpdatePlanAction(campaignId, action, payload = {}) {
    setError('');
    const response = await fetch(apiPath(`/api/update-plans/${encodeURIComponent(campaignId)}/${action}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `ui-${campaignId}-${action}-${Date.now()}` },
      body: JSON.stringify({ reason: 'Executed by an operator in Fleet Management', ...payload }),
    });
    if (!response.ok) {
      setError(`${action} failed with ${response.status}`);
      return false;
    }
    setRefreshTick((tick) => tick + 1);
    return true;
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
      if (payload.initialUser?.email) {
        try {
          await postJSON(`/api/admin/brand-clouds/${encodeURIComponent(result.brand_cloud.id)}/users`, payload.initialUser);
        } catch (err) {
          memberError = userFacingBrandCloudError(err);
        }
      }
      await refreshBrandClouds();
      if (memberError) setError(`Brand Cloud created, but initial admin setup needs attention: ${memberError}`);
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

  async function handleSocialLogin(providerID) {
    const result = await startSocialLogin(providerID, loginNextFromLocation(window.location));
    if (!result?.redirect_url) {
      throw new Error('Social sign-in could not be started. Please try again.');
    }
    window.location.assign(result.redirect_url);
  }

  async function handlePasswordLogin(credentials) {
    setError('');
    const nextPath = loginNextFromLocation(window.location);
    try {
      await postJSON('/api/auth/login', { ...credentials, next: nextPath });
      const session = await fetchJSON('/api/me');
      window.location.assign(browserSessionDestination(session, nextPath));
    } catch (err) {
      if (err?.status === 401 || /invalid credentials/i.test(err?.message || '')) throw new Error('Email or password is incorrect.');
      if (err?.status === 403) throw new Error('This account does not have access to an available view.');
      throw new Error('Sign-in is temporarily unavailable. Please try again later.');
    }
  }

  async function handleLoginActivate(token) {
    setError('');
    try {
      const result = await postJSON('/api/auth/login/activate', { token });
      const session = await fetchJSON('/api/me');
      window.location.assign(browserSessionDestination(session, loginNextFromLocation(window.location)));
      return result;
    } catch (err) {
      const nextError = userFacingLoginActivationError(err);
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
      throw new Error(nextError);
    }
  }

  async function handleResetPassword(payload) {
    setError('');
    try {
      return await postJSON('/api/auth/reset-password', payload);
    } catch (err) {
      const nextError = userFacingPasswordResetError(err);
      throw new Error(nextError);
    }
  }

  async function handleSignup(payload) {
    setError('');
    const result = await postJSON('/api/auth/customer/signup', payload);
    window.history.pushState({}, '', `/signup/check-email?email=${encodeURIComponent(payload.email)}`);
    setActive('signup-check-email');
    setRefreshTick((tick) => tick + 1);
    return result;
  }

  async function handleVerify(payload) {
    setError('');
    try {
      const result = await postJSON('/api/auth/customer/verify-email', payload);
      if (result.tokens?.access_token) {
        const session = await fetchJSON('/api/me');
        window.location.assign(browserSessionDestination(session, loginNextFromLocation(window.location)));
      }
      return result;
    } catch (err) {
      if (isExpiredVerificationError(err)) {
        window.history.replaceState({}, '', '/signup/verification-expired');
        setActive('signup-verification-expired');
        return null;
      }
      setError(userFacingVerificationError(err));
      throw err;
    }
  }

  async function handleVerificationStatus(token) {
    setError('');
    try {
      const result = await postJSON('/api/auth/customer/verification-status', { token });
      if (result?.status === 'expired') {
        window.history.replaceState({}, '', '/signup/verification-expired');
        setActive('signup-verification-expired');
      }
      return result;
    } catch (err) {
      if (isExpiredVerificationError(err)) {
        window.history.replaceState({}, '', '/signup/verification-expired');
        setActive('signup-verification-expired');
        return { status: 'expired' };
      }
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
      setError(quotaRaiseErrorMessage(err));
      throw err;
    }
  }

  async function handleSwitchOrg(orgId) {
    setError('');
    if (window.location.pathname.startsWith('/console/')) {
      const cloud = developerBrandClouds.find(item => item.id === orgId) || { id: orgId };
      // Navigation can update the URL before React commits the matching state.
      // Preserve the route that is actually visible when the cloud is switched.
      window.location.assign(cloudRouteForSwitch(cloud, routeFromLocation(), me?.user_id));
      return;
    }
    const response = await fetch('/api/me/active-org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id: orgId }),
    });
    if (!response.ok) {
      setError(`Brand Cloud switch failed with ${response.status}; current Cloud is unchanged.`);
      return;
    }
    if (isGlobalDeveloperRoute) {
      const params = new URLSearchParams(window.location.search);
      params.set('cloudId', orgId);
      window.location.assign(`${window.location.pathname}?${params.toString()}${window.location.hash}`);
      return;
    }
    clearDashboardState();
    setSelectedDeviceId('');
    setDeviceDrawerOpen(false);
    const suffix = window.location.pathname.match(/^\/console\/(?:[^/]+\/)?(.+)$/)?.[1] || 'overview';
    window.history.replaceState({}, '', `/console/${encodeURIComponent(orgId)}/${suffix}`);
    setRefreshTick((tick) => tick + 1);
  }

  async function handleSwitchView(view) {
	setError('');
	try {
	  const result = await postJSON('/api/me/view', { view });
      window.location.assign(result.kind === 'platform_admin' ? '/admin' : '/console/clouds');
	} catch (err) {
	  setError(err?.message || 'View switch failed.');
	}
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
  const activeBrandCloud = useMemo(() => {
    const cloudId = me?.active_org_id;
    const cloud = developerBrandClouds.find((candidate) => (candidate.id || candidate.organization_id) === cloudId);
    const membership = (me?.memberships || []).find((candidate) => candidate.organization_id === cloudId || candidate.id === cloudId);
    return {
      id: cloudId || cloud?.id || membership?.organization_id || '',
      ...me?.active_organization,
      name: me?.active_organization?.name || cloud?.name || cloud?.organization || membership?.organization || membership?.name || 'Brand Cloud',
    };
  }, [developerBrandClouds, me]);

  if (isPublicRoute) {
    if (isAuthEntryRoute) {
      return (
        <LoginPage
          active={active}
          error={error}
          loading={loading}
          onSignup={handleSignup}
          onLoginActivate={handleLoginActivate}
          onPasswordLogin={handlePasswordLogin}
          onSocialLogin={handleSocialLogin}
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
        onCheckVerification={handleVerificationStatus}
        onVerify={handleVerify}
        onResendVerification={handleResendVerification}
      />
    );
  }

  if (isMemberInvitationAccept && me?.authenticated) {
    return <BrandCloudMemberInvitationAcceptPage />;
  }

  return (
    <CloudConsoleShell me={me} cloud={activeBrandCloud.id ? { ...activeBrandCloud, capabilities: me?.capabilities || [], my_role: activeBrandCloud.my_role || getActiveMembership(me)?.role } : null} clouds={developerBrandClouds} active={active} title={active === 'overview' ? 'Overview' : titleFor(active)} navGroups={visibleNavGroups} onNavigate={navigate} navigationPath={pathForNavigationItem} onSwitchCloud={handleSwitchOrg} onLogout={handleLogout} onSwitchView={handleSwitchView} onError={setError}>
        {error ? <div className="error">{error}</div> : null}

        {needsPlatformAccess ? (
          <PlatformAccessGate
            active={active}
            me={me}
          />
        ) : null}
        {!needsPlatformAccess && customerViewPending ? <section className="panel split-panel"><div><h2>Loading session</h2><p>Checking customer access before loading dashboard data.</p></div></section> : null}
        {!needsPlatformAccess && !customerViewPending && customerViewBlocked ? <CustomerAccessGate me={me} active={active} /> : null}
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && ['overview', 'access', 'settings'].includes(active) ? (
          <BrandCloudPage
            active={active}
            cloud={activeBrandCloud}
            me={me}
            access={access}
            summary={summary}
            fleetSummary={fleetSummary}
            fleetHealth={fleetHealth}
            streamStats={streamStats}
            recentAlerts={recentAlerts}
            overviewWindow={overviewWindow}
            setOverviewWindow={setOverviewWindow}
            loading={loading}
            devices={devices}
            onHealthFilter={filterDevicesByHealth}
            onRequestQuotaRaise={handleQuotaRaiseRequest}
            onNavigate={navigateBrandCloudTab}
            onRefresh={() => setRefreshTick((tick) => tick + 1)}
            products={products?.products || []}
            productsUnavailable={products?.source_status === 'unavailable'}
          />
        ) : null}
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && active === 'devices' ? (
          <Devices
            active={active}
            devices={fleetDevices?.devices || devices}
            serverPage={fleetDevices?.pagination}
            serverSource={fleetDevices}
            selectedDevice={selectedDevice}
            deviceDrawerOpen={deviceDrawerOpen}
            me={me}
            setSelectedDeviceId={selectDevice}
            closeDeviceDrawer={closeDeviceDrawer}
            onAction={runDeviceAction}
          />
        ) : null}
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && active === 'provisioning' ? <ProvisioningPage products={products?.products || []} canCreate={canUseCapability(me, 'provisioning.create')} /> : null}
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && active === 'product-services' ? (
          <ProductsPage loading={loading} data={products} onRefresh={() => setRefreshTick((tick) => tick + 1)} />
        ) : null}
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && active === 'chipset-sdk' ? isPro2FirmwareBurner ? <Pro2FirmwareBurner /> : <DeveloperChipsetResources data={chipsets} sdkRelease={sdkCatalog} loading={loading} /> : null}
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && active === 'developer-docs' ? <DeveloperDocs /> : null}
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && active === 'firmware-ota' ? (
          <FirmwareOTAPage
            loading={loading}
            distribution={firmwareDistribution}
            selectedProductId={firmwareProductId}
            products={products?.products || []}
            releases={releases}
            onViewDevices={openDevicesForFirmware}
            onCampaignAction={runUpdatePlanAction}
            onStatusRefresh={refreshFirmwareStatus}
            canRelease={canUseCapability({ capabilities: me?.capabilities || [] }, 'firmware.release.manage')}
            canManageOTA={canUseCapability({ capabilities: me?.capabilities || [] }, 'ota.plan.manage')}
            onSelectProduct={selectFirmwareProduct}
            onRefresh={() => setRefreshTick((tick) => tick + 1)}
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
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && active === 'analytics' ? <>
          <StreamHealthPage
            devices={devices}
            loading={loading}
            stats={streamStats}
            streamWindow={streamWindow}
            setWindow={setStreamWindow}
            onOpenDevice={selectDevice}
          />
          <ReportsPage data={reports} products={products?.products || []} loading={loading} canCreate={canUseCapability({ capabilities: me?.capabilities || [] }, 'reports.create')} onRefresh={() => setRefreshTick((tick) => tick + 1)} />
        </> : null}
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && active === 'reports' ? <ReportsPage data={reports} products={products?.products || []} loading={loading} canCreate={canUseCapability({ capabilities: me?.capabilities || [] }, 'reports.create')} onRefresh={() => setRefreshTick((tick) => tick + 1)} /> : null}
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && active === 'groups' ? <GroupsPage data={groups} loading={loading} onRefresh={() => setRefreshTick((tick) => tick + 1)} /> : null}
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && active === 'billing' ? <section className="panel"><h2>Select a cloud for Billing</h2><p>Billing is scoped to the cloud URL, not the shared active-cloud session.</p><a href="/console/clouds">Open My Clouds</a></section> : null}
        {!needsPlatformAccess && active === 'platform-dashboard' ? <PlatformDashboardLanding dashboard={platformDashboard} summary={summary} health={health} operations={operations} logs={serviceLogs} /> : null}
        {!needsPlatformAccess && active === 'platform-grafana' ? <PlatformGrafanaView status={platformGrafanaStatus} /> : null}
        {!needsPlatformAccess && active === 'platform-health' ? <PlatformHealth summary={summary} health={health} /> : null}
        {!needsPlatformAccess && active === 'platform-chipset-providers' ? <PlatformChipsetProviders data={chipsetProviders} loading={loading} capabilities={me?.capabilities || []} onRefresh={() => setRefreshTick((tick) => tick + 1)} /> : null}
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
            onCreateUser={handleCreateBrandCloudUser}
          />
        ) : null}
        {!needsPlatformAccess && active === 'platform-sso' ? (
          <PlatformSSOProviders providers={ssoProviders} customers={customers} onSave={handleSSOProviderSave} />
        ) : null}
        {!needsPlatformAccess && active === 'platform-operations' ? <Operations operations={operations} /> : null}
        {!needsPlatformAccess && active === 'platform-audit' ? <AuditLog audit={audit} loading={loading} /> : null}
        {!needsPlatformAccess && !customerViewPending && !customerViewBlocked && active === 'audit' ? <CustomerAudit cloudId={urlCloudId} /> : null}
    </CloudConsoleShell>
  );
}

function LoginPage({ active, error, loading, onSignup, onLoginActivate, onPasswordLogin, onSocialLogin, onForgotPassword, onResetPassword }) {
  const params = new URLSearchParams(window.location.search);
  const email = params.get('email') || '';
  const token = params.get('token') || '';
  const [authMode, setAuthMode] = useState('login');
  const [socialProviders, setSocialProviders] = useState([]);
  const platformLogin = active === 'login' && isPlatformLoginNext(params.get('next') || '');
  const loginHeading = platformLogin ? 'Platform Admin sign in' : authMode === 'signup' ? 'Create your Connect+ account' : 'Sign in to Connect+';
  const loginCopy = platformLogin
    ? 'Sign in with your platform administrator account.'
    : authMode === 'signup'
      ? 'Create an account to get started with Connect+.'
      : 'Use your Connect+ account to continue.';
  const pageHeading = active === 'login' ? loginHeading : active === 'reset-password' ? 'Reset your password' : active === 'forgot-password' ? 'Recover your account' : active === 'login-check-email' ? 'Check your email' : 'Complete your sign in';
  const pageCopy = active === 'login'
    ? loginCopy
    : active === 'reset-password'
      ? 'Choose a new password for your Connect+ account.'
      : active === 'forgot-password' ? 'We’ll help you regain access to your Connect+ account.' : 'Continue to your Realtek cloud workspace.';

  useEffect(() => {
    if (active !== 'login') return;
    document.title = platformLogin
      ? 'Platform Admin sign in Connect+'
      : authMode === 'signup'
        ? 'Create account Connect+'
        : 'Sign in Connect+';
  }, [active, authMode, platformLogin]);

  useEffect(() => {
    if (active !== 'login') return undefined;
    let alive = true;
    fetchJSON('/api/auth/social/providers')
      .then((result) => { if (alive) setSocialProviders(result?.providers || []); })
      .catch(() => { if (alive) setSocialProviders([]); });
    return () => { alive = false; };
  }, [active]);

  const content = active === 'login-check-email' ? (
    <LoginCheckEmail email={email} />
  ) : active === 'login-activate' ? (
    <LoginActivateView token={token} onLoginActivate={onLoginActivate} />
  ) : active === 'forgot-password' ? (
    <ForgotPasswordView email={email} onForgotPassword={onForgotPassword} />
  ) : active === 'reset-password' ? (
    <ResetPasswordView token={token} email={email} onResetPassword={onResetPassword} />
  ) : (
    <LoginEntryForm
      initialEmail={email}
      mode={authMode}
      onModeChange={setAuthMode}
      platformLogin={platformLogin}
      onSignup={onSignup}
      onPasswordLogin={onPasswordLogin}
      onSocialLogin={onSocialLogin}
      socialProviders={socialProviders}
      disabled={loading}
    />
  );
  return (
    <div className="login-shell service-login-shell">
      <header className="service-login-header">
        <a className="login-brand" href="/login" aria-label="Realtek Connect+ sign in">
          <img src="/assets/realtek-logo.png" alt="Realtek" />
          <span className="service-brand-divider" aria-hidden="true" />
          <strong>Connect+</strong>
        </a>
        <span className="service-console-label">{platformLogin ? 'Platform administration' : 'Developer console'}</span>
      </header>
      <main className="login-layout">
        <aside className="service-login-story" aria-label="About Connect+">
          <div className="service-story-content">
            <p className="service-story-eyebrow">REALTEK CLOUD SERVICES</p>
            <h2>Your products. <br />Your cloud. <br /><span>Connected.</span></h2>
            <p className="service-story-copy">A dedicated workspace for the people building and operating connected products.</p>
            <ul className="service-story-features">
              <li><i className="fa-solid fa-cubes" aria-hidden="true" /><div><strong>Build your product ecosystem</strong><span>Organize products and connect your devices.</span></div></li>
              <li><i className="fa-solid fa-sliders" aria-hidden="true" /><div><strong>Bring operations together</strong><span>Manage your fleet, firmware and cloud services.</span></div></li>
              <li><i className="fa-solid fa-code" aria-hidden="true" /><div><strong>Keep development moving</strong><span>Find SDKs, integration guides and technical resources.</span></div></li>
            </ul>
          </div>
          <div className="service-story-footer"><span className="service-story-rule" aria-hidden="true" />From device to cloud.</div>
        </aside>
        <section className="login-primary" aria-labelledby="login-title">
          <p className="service-form-eyebrow">{platformLogin ? 'PLATFORM ACCESS' : 'WELCOME TO CONNECT+'}</p>
          <h1 id="login-title">{pageHeading}</h1>
          <p className="login-copy">{pageCopy}</p>
          {content}
          {error || socialLoginCallbackError(params.get('social_error')) ? <div className="error" role="alert">{error || socialLoginCallbackError(params.get('social_error'))}</div> : null}
        </section>
      </main>
      <footer className="service-login-footer"><span>Realtek Connect+ · Cloud services</span><a href="https://www.realtek.com" target="_blank" rel="noreferrer noopener">Realtek corporate website <span aria-hidden="true">↗</span></a></footer>
    </div>
  );
}

function LoginEntryForm({ initialEmail, mode, onModeChange, platformLogin, onSignup, onPasswordLogin, onSocialLogin, socialProviders, disabled }) {
  return (
    <div className="auth-stack">
      {!platformLogin ? <div className="auth-mode-tabs" role="tablist" aria-label="Auth mode">
        <button
          type="button"
          className={mode === 'login' ? 'active' : ''}
          role="tab"
          aria-selected={mode === 'login'}
          onClick={() => onModeChange('login')}
        >
          Sign in
        </button>
        <button
          type="button"
          className={mode === 'signup' ? 'active' : ''}
          role="tab"
          aria-selected={mode === 'signup'}
          onClick={() => onModeChange('signup')}
        >
          Create account
        </button>
      </div> : null}
      {!platformLogin && mode === 'signup' ? (
        <SignupForm onSignup={onSignup} disabled={disabled} />
      ) : (
        <>
          <SocialLoginButtons providers={socialProviders} onSocialLogin={onSocialLogin} disabled={disabled} />
          {socialProviders.length ? <div className="social-login-divider"><span>or continue with email</span></div> : null}
          <LoginPasswordForm initialEmail={initialEmail} onPasswordLogin={onPasswordLogin} disabled={disabled} />
        </>
      )}
    </div>
  );
}

function SocialLoginButtons({ providers = [], onSocialLogin, disabled }) {
  const [busyProvider, setBusyProvider] = useState('');
  const [localError, setLocalError] = useState('');
  if (!providers.length) return null;
  async function begin(provider) {
    setBusyProvider(provider.id);
    setLocalError('');
    try {
      await onSocialLogin(provider.id);
    } catch (_) {
      setLocalError(`${provider.name} sign-in is temporarily unavailable. Please try again.`);
      setBusyProvider('');
    }
  }
  return (
    <div className="social-login-stack" aria-label="Social sign-in options">
      {providers.map((provider) => <button
        key={provider.id}
        type="button"
        className={`social-login-button social-login-${provider.id}`}
        disabled={disabled || Boolean(busyProvider)}
        onClick={() => begin(provider)}
      >
        <i className={`fa-brands fa-${provider.id}`} aria-hidden="true" />
        <span>{busyProvider === provider.id ? `Connecting to ${provider.name}` : `Continue with ${provider.name}`}</span>
      </button>)}
      {localError ? <p className="error" role="alert">{localError}</p> : null}
    </div>
  );
}

function LoginPasswordForm({ initialEmail = '', onPasswordLogin, disabled }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      await onPasswordLogin({ email, password });
    } catch (err) {
      setLocalError(err?.message || 'Sign-in could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="login-form" onSubmit={submit} aria-busy={busy}>
      <label>
        Email
        <input type="email" name="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required />
      </label>
      <div className="service-password-field">
        <label htmlFor="service-login-password">Password</label>
        <div className="service-password-control">
          <input id="service-login-password" name="password" autoComplete="current-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required />
          <button type="button" className="service-password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-controls="service-login-password" onClick={() => setShowPassword(value => !value)}><i className={`fa-regular ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true" /></button>
        </div>
      </div>
      <button type="submit" disabled={busy || disabled}>{busy ? 'Signing in' : 'Sign in'}</button>
      <a className="auth-link" href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`}>Forgot password?</a>
      {localError ? <p className="error" role="alert">{localError}</p> : null}
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

function ResetPasswordView({ token, email, onResetPassword }) {
  const [tokenValue, setTokenValue] = useState(() => token);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [completed, setCompleted] = useState(false);
  const [completedEmail, setCompletedEmail] = useState(email);
  const [error, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    removeQueryParameterFromAddress(window.location, window.history, 'token');
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (Array.from(password).length < 8) {
      setLocalError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setLocalError('');
    try {
      const result = await onResetPassword({ token: tokenValue, new_password: password });
      setCompletedEmail(result?.email || email);
      setTokenValue('');
      setPassword('');
      setConfirmPassword('');
      setCompleted(true);
    } catch (err) {
      setLocalError(userFacingPasswordResetError(err));
    } finally {
      setBusy(false);
    }
  }

  if (completed) {
    return (
      <div className="auth-stack" role="status">
        <div className="reset-link-status success">
          <span className="reset-link-status-icon" aria-hidden="true">✓</span>
          <div>
            <strong>Password updated</strong>
            <p>Your new password is ready. You can now sign in to your account.</p>
          </div>
        </div>
        <a className="auth-primary-action" href={`/login${completedEmail ? `?email=${encodeURIComponent(completedEmail)}` : ''}`}>Continue to sign in</a>
      </div>
    );
  }

  if (!tokenValue) {
    return (
      <div className="auth-stack">
        <div className="reset-link-status invalid" role="alert">
          <span className="reset-link-status-icon" aria-hidden="true">!</span>
          <div>
            <strong>This reset link is not valid</strong>
            <p>Request a new email to continue. Reset links can expire or be used only once.</p>
          </div>
        </div>
        <a className="auth-primary-action" href="/forgot-password">Request a new reset link</a>
        <a className="auth-link" href="/login">Back to sign in</a>
      </div>
    );
  }

  const passwordsDoNotMatch = Boolean(confirmPassword) && password !== confirmPassword;
  return (
    <form className="login-form" onSubmit={submit}>
      <div className="reset-link-status">
        <span className="reset-link-status-icon" aria-hidden="true">✓</span>
        <div>
          <strong>Secure reset link recognized</strong>
          <p>Your reset code is hidden and will be submitted securely.</p>
        </div>
      </div>
      <label>
        New password
        <input type="password" autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setLocalError(''); }} placeholder="At least 8 characters" minLength={8} required />
      </label>
      <label>
        Confirm new password
        <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setLocalError(''); }} placeholder="Enter the new password again" minLength={8} aria-invalid={passwordsDoNotMatch} required />
      </label>
      <p className="password-requirement">Use at least 8 characters.</p>
      {passwordsDoNotMatch ? <p className="field-error" role="alert">Passwords do not match.</p> : null}
      <button type="submit" disabled={busy || passwordsDoNotMatch}>{busy ? 'Updating password' : 'Update password'}</button>
      {error && !passwordsDoNotMatch ? <p className="error">{error}</p> : null}
      <a className="auth-link" href="/login">Back to sign in</a>
    </form>
  );
}

function PublicAuthPage({ active, error, onSignup, onCheckVerification, onVerify, onResendVerification }) {
  const params = new URLSearchParams(window.location.search);
  const email = params.get('email') || '';
  const token = params.get('token') || '';

  return (
    <div className="public-auth-shell">
      <section className="auth-hero"><a href="/login" aria-label="Realtek Connect+ sign in"><img src="/assets/realtek-logo.png" alt="Realtek" /></a>
        <p className="eyebrow">Evaluation tier access</p>
        <h1>{titleFor(active)}</h1>
        <p>Self-service signup and verification for the public evaluation tier.</p>
      </section>
      <section className="panel auth-panel">
        {active === 'signup' ? (
          <SignupForm onSignup={onSignup} />
        ) : active === 'signup-check-email' ? (
          <CheckEmailInterstitial email={email} onResendVerification={onResendVerification} />
        ) : active === 'signup-verification-expired' ? (
          <ExpiredVerificationPage />
        ) : (
          <VerifyForm token={token} onCheckVerification={onCheckVerification} onVerify={onVerify} />
        )}
        {error ? <div className="error">{error}</div> : null}
      </section>
    </div>
  );
}

function SignupForm({ onSignup, disabled = false }) {
  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [error, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (honeypot) return;
    setBusy(true);
    setLocalError('');
    try {
      await onSignup({
        email,
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
      <label className="auth-honeypot">
        Leave this field empty
        <input value={honeypot} onChange={(event) => setHoneypot(event.target.value)} tabIndex={-1} autoComplete="off" />
      </label>
      <button type="submit" disabled={busy || disabled || !!honeypot}>Create account</button>
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

function ExpiredVerificationPage() {
  return (
    <div className="auth-stack expired-verification-page">
      <h2>Verification link expired</h2>
      <p>Your account was not verified. Start Sign Up again to receive a new verification email.</p>
      <a className="primary-button auth-primary-link" href="/signup">Sign up again</a>
      <a className="auth-link" href="/login">Back to Login</a>
    </div>
  );
}

function VerifyForm({ token, onCheckVerification, onVerify }) {
  const [tokenValue] = useState(() => token);
  const [password, setPassword] = useState('');
  const [linkStatus, setLinkStatus] = useState(tokenValue ? 'checking' : 'invalid');
  const [status, setStatus] = useState(tokenValue ? 'Checking verification link…' : 'This verification link is invalid.');
  const [error, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    removeQueryParameterFromAddress(window.location, window.history, 'token');
  }, []);

  useEffect(() => {
    if (!tokenValue) return undefined;
    let active = true;
    onCheckVerification(tokenValue)
      .then((result) => {
        if (!active || result?.status === 'expired') return;
        const nextStatus = result?.status === 'valid' ? 'valid' : 'invalid';
        setLinkStatus(nextStatus);
        setStatus(nextStatus === 'valid' ? 'Create your password to finish verification.' : 'This verification link is invalid.');
      })
      .catch((err) => {
        if (!active) return;
        setLinkStatus('error');
        setLocalError(userFacingVerificationError(err));
      });
    return () => { active = false; };
  }, [onCheckVerification, tokenValue]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setLocalError('');
    try {
      const result = await onVerify({ token: tokenValue, new_password: password });
      if (!result) {
        setLocalError('Verification failed. Check the token and try again.');
      } else if (result.tokens?.access_token) {
        setStatus('Verification completed. Redirecting to the dashboard.');
      } else {
        setStatus('Email verified. You can now sign in.');
      }
    } catch (err) {
      setLocalError(userFacingVerificationError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-stack">
      <p>Verify your email and create the password you will use to log in.</p>
      {linkStatus === 'valid' ? <form className="auth-form" onSubmit={submit}>
        <label>
          New password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} required />
        </label>
        <button type="submit" disabled={busy || !tokenValue}>{busy ? 'Verifying' : 'Verify and continue'}</button>
      </form> : null}
      <p className="auth-status">{status}</p>
      {error ? <p className="error">{error}</p> : null}
      {linkStatus === 'invalid' ? <a className="auth-link" href="/signup">Sign up again</a> : null}
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

function BrandCloudPage({
  active,
  cloud,
  me,
  access,
  summary,
  fleetSummary,
  fleetHealth,
  streamStats,
  recentAlerts,
  overviewWindow,
  setOverviewWindow,
  loading,
  devices,
  onHealthFilter,
  onRequestQuotaRaise,
  onNavigate,
  onRefresh,
  products,
  productsUnavailable,
}) {
  const capabilities = me?.capabilities || [];
  const tabs = [
    { id: 'overview', label: translate('Overview') },
    { id: 'access', label: translate('Members and Access') },
    { id: 'settings', label: translate('Settings') },
  ].filter((tab) => canAccessCustomerRoute(tab.id, capabilities));
  const canManageTeam = canUseCapability({ capabilities }, 'team.manage');
  const canIssuePKITest = canUseCapability({ capabilities }, 'pki.test.issue');

  return <section className="brand-cloud-page">
    <header className="brand-cloud-header">
      <div>
        <p className="eyebrow">Brand Cloud</p>
        <h2>{cloud.name}</h2>
        <p>{cloud.id || translate('No Brand Cloud selected')}</p>
      </div>
    </header>
    <nav className="brand-cloud-tabs" aria-label="Brand Cloud sections">
      {tabs.map((tab) => <button
        type="button"
        key={tab.id}
        className={active === tab.id ? 'active' : ''}
        aria-current={active === tab.id ? 'page' : undefined}
        onClick={() => onNavigate(tab.id)}
      >{tab.label}</button>)}
    </nav>
    {active === 'overview' ? <Overview
      summary={summary}
      fleetSummary={fleetSummary}
      fleetHealth={fleetHealth}
      streamStats={streamStats}
      recentAlerts={recentAlerts}
      overviewWindow={overviewWindow}
      setOverviewWindow={setOverviewWindow}
      me={me}
      access={access}
      canReadTeam={canAccessCustomerRoute('access', capabilities)}
      loading={loading}
      devices={devices}
      onHealthFilter={onHealthFilter}
      onRequestQuotaRaise={onRequestQuotaRaise}
      onOpenAccess={() => onNavigate('access')}
    /> : null}
    {active === 'access' ? <TeamAccessPage
      data={access}
      me={me}
      cloudName={cloud.name}
      loading={loading}
      activeCloudId={cloud.id}
      canManage={canManageTeam}
      onRefresh={onRefresh}
    /> : null}
    {active === 'settings' ? <BrandCloudSettingsPage
      activeCloudId={cloud.id}
      canManage={canManageTeam}
      canIssuePKITest={canIssuePKITest}
      products={products}
      productsLoading={loading}
      productsUnavailable={productsUnavailable}
      onRefresh={onRefresh}
    /> : null}
  </section>;
}

function TeamSummaryCard({ data, loading, me, onOpen }) {
  const members = data?.members || [];
  const pendingInvitations = (data?.invitations || []).filter((invitation) => invitation.status === 'pending');
  const owner = members.find((member) => member.role === 'owner');
  const membership = getActiveMembership(me);
  const currentMember = members.find((member) => member.email && member.email === me?.email);
  const role = currentMember?.role || membership?.role || translate('Not specified');
  const unavailable = data && data.source_status === 'unavailable';

  return <section className="panel team-summary-card">
    <div className="panel-head">
      <div><h2>{translate('Team Summary')}</h2><p>{translate('Review members, invitations, and your current role.')}</p></div>
      <button type="button" className="ghost-button" onClick={onOpen}>{translate('Manage Members and Access')}</button>
    </div>
    {loading && !data ? <p className="empty-state">{translate('Loading team data.')}</p> : null}
    {unavailable ? <p className="empty-state">{sourceMessage(data, translate('Team data is temporarily unavailable.'))}</p> : null}
    {!loading && !unavailable ? <div className="team-summary-grid">
      <div><small>{translate('Members')}</small><strong>{members.length}</strong></div>
      <div><small>Owner</small><strong>{owner?.display_name || owner?.email || '—'}</strong></div>
      <div><small>{translate('Pending Invitations')}</small><strong>{pendingInvitations.length}</strong></div>
      <div><small>{translate('My Role')}</small><strong>{role}</strong></div>
    </div> : null}
  </section>;
}

function Overview({
  summary,
  fleetSummary,
  fleetHealth,
  streamStats,
  recentAlerts,
  overviewWindow,
  setOverviewWindow,
  me,
  access,
  canReadTeam,
  loading,
  devices,
  onHealthFilter,
  onRequestQuotaRaise,
  onOpenAccess,
}) {
  const activeMembership = getActiveMembership(me);
  const tierLabel = formatTierLabel(activeMembership?.tier);
  const quotaLimit = activeMembership?.evaluation_device_quota ?? 5;
  const activeDevices = summary?.total_devices ?? 0;
  const quotaRatio = `${activeDevices} / ${quotaLimit} devices`;
  const isEvaluation = (activeMembership?.tier || '').toLowerCase() === 'evaluation';
  const nearQuota = isEvaluation && activeDevices >= Math.max(quotaLimit - 1, 1);
  const current = fleetHealth?.current || {};
  const onlineCount = summary?.online_devices;
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
    : 'N/A';
  const activeStreams = streamAvailable ? (streamStats?.active_sessions ?? 0) : 'N/A';
  const telemetryReason = telemetryState.message || sourceMessage(fleetHealth, 'No telemetry source configured.');
  const streamReason = streamState.message || sourceMessage(streamStats, 'No stream source configured.');
  const attentionDevices = buildAttentionQueue(devices, recentAlerts);

  return (
    <div className="overview-layout">
      <div className="page-intro"><div><p className="eyebrow">Fleet Operations</p><h2>{translate('Device Overview')}</h2><p>{translate('Review device health and work that needs attention.')}</p></div></div>
      <section className="metrics overview-metrics">
        <MetricCard icon="video" label="Online" value={Number.isFinite(onlineCount) ? `${onlineCount} / ${summary.total_devices ?? onlineCount}` : 'Unknown'} hint="Devices online" tone="info" />
        <MetricCard icon="chart-line" label="Online Rate" value={telemetryAvailable ? formatPercent(onlineRate) : 'N/A'} hint={telemetryAvailable ? '7-day trend' : 'Telemetry unavailable'} tone="info" />
        <MetricCard icon="triangle-exclamation" label="Needs Attention" value={needsAttention} hint={telemetryAvailable ? `${current.warning || 0} warning / ${current.critical || 0} critical` : 'Telemetry unavailable'} tone={needsAttention === 0 ? 'good' : 'warn'} />
        <MetricCard icon="tower-broadcast" label="Active Streams" value={activeStreams} hint={streamAvailable ? 'Current streaming sessions' : 'Stream data unavailable'} tone="info" />
      </section>


      {!telemetryAvailable ? <SourceBlockedState title={telemetryState.title} message={telemetryReason} /> : null}

      {telemetryAvailable && <section className="overview-grid">
        <HealthDistributionPanel
          loading={loading}
          current={fleetHealth?.current}
          onFilter={onHealthFilter}
          source={fleetHealth}
        />
        <FleetHealthTrendPanel
          loading={loading}
          trend={fleetHealth?.trend || []}
          window={overviewWindow}
          onWindowChange={setOverviewWindow}
          source={fleetHealth}
        />
      </section>}
      {!streamAvailable && <SourceBlockedState title={streamState.title} message={streamReason} />}

      <section className="overview-attention">
        <AttentionQueuePanel loading={loading} items={attentionDevices} onOpenDevice={(deviceId) => updateDevicesLocation({ deviceId })} />
      </section>

      <RegionFleetPanel summary={fleetSummary} loading={loading} />

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

function RegionFleetPanel({ summary, loading }) {
  const regions = Object.entries(summary?.by_region || {})
    .map(([region, count]) => [region, Number(count)])
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((left, right) => right[1] - left[1]);
  const max = Math.max(...regions.map(([, count]) => count), 1);
  const unavailable = !summary || summary.source_status !== 'available';
  return (
    <section className="panel region-fleet-panel">
      <div className="panel-head">
        <div>
          <h2>{translate('Device Status by Region')}</h2>
          <p>{translate('Use the map to locate regions and compare fleet size by device count.')}</p>
        </div>
      </div>
      {loading ? <p className="empty-state">{translate('Loading regional data.')}</p> : null}
      {!loading && unavailable ? <p className="empty-state">{translate('Regional data is temporarily unavailable.')}</p> : null}
      {!loading && !unavailable && !regions.length ? <p className="empty-state">{translate('No device locations have been reported yet.')}</p> : null}
      {!loading && !unavailable && regions.length ? (
        <div className="region-fleet-grid">
          <div className="region-bars">
            {regions.slice(0, 8).map(([region, count]) => <div className="region-bar-row" key={region}>
              <div><strong>{region}</strong><span>{translate('{{count}} devices', { count: formatNumber(count) })}</span></div>
              <div className="region-bar-track"><span style={{ width: `${Math.max(4, count / max * 100)}%` }} /></div>
            </div>)}
          </div>
          <div className="region-map-desktop"><RegionMap regions={regions} max={max} /></div>
          <details className="region-map-mobile">
            <summary>View map</summary>
            <RegionMap regions={regions} max={max} />
          </details>
        </div>
      ) : null}
    </section>
  );
}

function RegionMap({ regions, max }) {
  const [viewport, setViewport] = useState(WORLD_VIEWPORT);
  const [hoveredRegion, setHoveredRegion] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);
  const zoom = 1000 / viewport.width;
  const regionPoints = regions.slice(0, 8).map(([region, count]) => ({ region, count, point: regionMapPoint(region) })).filter(({ point }) => point);

  function zoomBy(factor, anchorX = .5, anchorY = .5) {
    setViewport((current) => {
      const nextZoom = Math.max(1, Math.min(8, 1000 / current.width * factor));
      const width = 1000 / nextZoom;
      const height = 500 / nextZoom;
      return clampWorldViewport({
        x: current.x + (current.width - width) * anchorX,
        y: current.y + (current.height - height) * anchorY,
        width,
        height,
      });
    });
  }

  function handleWheel(event) {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    zoomBy(event.deltaY < 0 ? 1.25 : .8, (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { clientX: event.clientX, clientY: event.clientY, viewport };
    setDragging(true);
  }

  function handlePointerMove(event) {
    if (!dragRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const start = dragRef.current;
    setViewport(clampWorldViewport({
      ...start.viewport,
      x: start.viewport.x - (event.clientX - start.clientX) / bounds.width * start.viewport.width,
      y: start.viewport.y - (event.clientY - start.clientY) / bounds.height * start.viewport.height,
    }));
  }

  function handlePointerUp(event) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDragging(false);
  }

  function showCountry(event, country) {
    if (dragRef.current) return;
    const bounds = event.currentTarget.ownerSVGElement.getBoundingClientRect();
    setHoveredRegion({ name: country.properties.name, x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  }

  return <div className="region-map-vector" aria-label={translate('Regional device distribution map')}>
    <div className="region-map-toolbar" aria-label={translate('Map controls')}>
      <button type="button" onClick={() => zoomBy(1.4)} aria-label={translate('Zoom in')}>＋</button>
      <button type="button" onClick={() => zoomBy(1 / 1.4)} aria-label={translate('Zoom out')} disabled={zoom <= 1}>−</button>
      <button type="button" onClick={() => setViewport(WORLD_VIEWPORT)} disabled={zoom <= 1}>{translate('Reset')}</button>
      <span>{Math.round(zoom * 100)}%</span>
    </div>
    <div className="region-map-stage">
      <svg
        className={dragging ? 'is-dragging' : ''}
        viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
        role="img"
        aria-label={translate('Zoomable and draggable world device distribution map')}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => setHoveredRegion(null)}
      >
        <g className="world-countries">
          {WORLD_COUNTRIES.map((country, index) => <path
            key={country.id || country.properties.name || index}
            d={worldGeometryPath(country.geometry)}
            onPointerEnter={(event) => showCountry(event, country)}
            onPointerMove={(event) => showCountry(event, country)}
            onPointerLeave={() => setHoveredRegion(null)}
          ><title>{country.properties.name}</title></path>)}
        </g>
        <g className="region-map-markers">
          {regionPoints.map(({ region, count, point: [x, y] }) => <g key={region}>
            <circle cx={x} cy={y} r={Math.max(9, Math.min(22, 9 + count / max * 13)) / zoom} />
            <text x={x + 18 / zoom} y={y + 5 / zoom} style={{ fontSize: `${12 / zoom}px` }}>{region}</text>
          </g>)}
        </g>
      </svg>
      {hoveredRegion ? <div className="region-map-tooltip" style={{ left: hoveredRegion.x, top: hoveredRegion.y }}>{hoveredRegion.name}</div> : null}
    </div>
    <small>{regions.length ? translate('Drag to pan and scroll to zoom. Marker size represents device count.') : translate('Drag to pan and scroll to zoom. Hover over a country or region to view its name.')}</small>
  </div>;
}

const WORLD_VIEWPORT = Object.freeze({ x: 0, y: 0, width: 1000, height: 500 });
const WORLD_COUNTRIES = feature(worldAtlas, worldAtlas.objects.countries).features;
const REGION_MAP_COORDINATES = {
  na: [-105, 43], 'north america': [-105, 43], '北美': [-105, 43],
  sa: [-60, -17], 'south america': [-60, -17], '南美': [-60, -17],
  eu: [15, 51], europe: [15, 51], '歐洲': [15, 51],
  africa: [20, 3], af: [20, 3], '非洲': [20, 3],
  asia: [100, 36], apac: [112, 8], '亞洲': [100, 36], '亞太': [112, 8],
  oceania: [135, -25], anz: [135, -25], '大洋洲': [135, -25], '澳紐': [135, -25],
  taiwan: [121, 23.7], tw: [121, 23.7], twn: [121, 23.7], '台灣': [121, 23.7], '臺灣': [121, 23.7],
};

function projectWorldPoint([longitude, latitude]) {
  return [(longitude + 180) / 360 * 1000, (90 - latitude) / 180 * 500];
}

function worldGeometryPath(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.map((polygon) => polygon.map((ring) => ring.map((coordinate, index) => {
    const [x, y] = projectWorldPoint(coordinate);
    return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ') + 'Z').join(' ')).join(' ');
}

function clampWorldViewport(viewport) {
  return {
    ...viewport,
    x: Math.max(0, Math.min(1000 - viewport.width, viewport.x)),
    y: Math.max(0, Math.min(500 - viewport.height, viewport.y)),
  };
}

function regionMapPoint(region) {
  const normalized = String(region).trim().toLowerCase();
  const knownCoordinates = REGION_MAP_COORDINATES[normalized];
  if (knownCoordinates) return projectWorldPoint(knownCoordinates);
  const country = WORLD_COUNTRIES.find((candidate) => candidate.properties.name.toLowerCase() === normalized);
  if (!country) return null;
  const coordinates = country.geometry.type === 'Polygon' ? country.geometry.coordinates.flat(1) : country.geometry.coordinates.flat(2);
  return projectWorldPoint([
    (Math.min(...coordinates.map(([longitude]) => longitude)) + Math.max(...coordinates.map(([longitude]) => longitude))) / 2,
    (Math.min(...coordinates.map(([, latitude]) => latitude)) + Math.max(...coordinates.map(([, latitude]) => latitude))) / 2,
  ]);
}

function PlatformChipsetProviders({ data, loading, capabilities, onRefresh }) {
  const providers = data?.providers || [];
  const effectiveCapabilities = data?.capabilities || capabilities;
  const canEdit = effectiveCapabilities.includes('platform.chipset_sdk.edit');
  const canPublish = effectiveCapabilities.includes('platform.chipset_sdk.publish');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [drawer, setDrawer] = useState(null);
  const [message, setMessage] = useState('');
  const kpis = useMemo(() => providerKPIs(providers), [providers]);
  const visibleProviders = useMemo(() => filterProviders(providers, query, filter), [providers, query, filter]);
  const staleProviders = providers.filter((provider) => provider.status === 'published' && provider.stale);
  async function act(provider, action) {
    setMessage('');
    const response = await fetch(`/api/admin/chipset-providers/${encodeURIComponent(provider.id)}/${action}`, {
      method: 'POST', headers: { 'Idempotency-Key': `chipset-provider-${provider.id}-${action}-${Date.now()}` },
    });
    const body = response.ok ? await response.json().catch(() => null) : null;
    setMessage(response.ok ? (body?.audit_result === 'accepted' ? translate('Provider {{action}} completed.', { action }) : translate('Provider {{action}} completed, but the audit record could not be written.', { action })) : translate('The provider action could not be completed.'));
    if (response.ok) onRefresh();
  }
  return <section className="page-content chipset-provider-page" data-testid="chipset-provider-page">
    <div className="page-intro"><div><p className="eyebrow">Platform Catalog Management</p><h2 className="heading-with-icon"><Icon name="database" />ChipSet &amp; SDK Providers</h2><p>{translate('Manage Information Provider sources, publication state, and synchronization health for the platform catalog.')}</p></div><div className="page-intro-actions"><button type="button" className="ghost-button icon-text" onClick={onRefresh}><Icon name="rotate" />{translate('Refresh Status')}</button>{canEdit ? <button type="button" className="primary-button icon-text" onClick={() => setDrawer({ mode: 'create', provider: null })}><Icon name="plus" />{translate('Add Provider')}</button> : null}</div></div>
    <section className="metrics chipset-provider-kpis" aria-label="ChipSet provider summary">
      <MetricCard icon="database" label="Providers" value={kpis.total} hint={`${kpis.published} published · ${kpis.total - kpis.published} not published`} tone="info" />
      <MetricCard icon="microchip" label="Published ChipSets" value={kpis.publishedChipsets} hint={`${kpis.publishedSDKs} SDK releases`} tone="info" />
      <MetricCard icon="clock-rotate-left" label="Last successful sync" value={kpis.lastSuccess ? formatRelativeTime(kpis.lastSuccess) : '—'} hint={kpis.lastSuccess ? 'background refresh healthy' : 'No successful sync'} tone="good" />
      <MetricCard icon="triangle-exclamation" label="Needs attention" value={kpis.needsAttention} hint="last-known-good remains available" tone={kpis.needsAttention ? 'warn' : 'good'} />
    </section>
    {staleProviders.length ? <div className="chipset-warning-banner" role="status"><Icon name="triangle-exclamation" /><div><strong>{translate('{{name}} manifest is delayed', { name: staleProviders[0].name })}</strong><span>{translate('The last valid data remains available to downstream consumers. Check the provider endpoint.')}</span></div><button type="button" className="link-button icon-text" onClick={() => setDrawer({ mode: 'preview', provider: staleProviders[0] })}><Icon name="magnifying-glass" />{translate('View Error')}</button></div> : null}
    {message ? <div className="notice">{message}</div> : null}
    {loading && !data ? <section className="panel chipset-loading-state"><p>{translate('Loading providers…')}</p></section> : null}
    {data?.source_status === 'unavailable' ? <section className="panel split-panel"><div><h3>Provider catalog unavailable</h3><p>{data.source_message}</p></div></section> : null}
    {data?.source_status !== 'unavailable' ? <section className="panel chipset-provider-list-panel"><div className="chipset-toolbar"><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={translate('Search providers, ChipSets, or manifest versions')} aria-label={translate('Search ChipSet providers')} /><div className="chipset-filter-tabs" role="group" aria-label="Provider status filter">{[['all', translate('All')], ['published', 'Published'], ['draft', 'Draft'], ['stale', 'Stale']].map(([value, label]) => <button type="button" className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div></div><div className="table-wrap"><table className="data-table chipset-provider-table"><thead><tr><th>Provider</th><th>Status</th><th>Manifest</th><th>Resources</th><th>Last success</th><th>Sync health</th><th>Actions</th></tr></thead><tbody>{visibleProviders.map((provider) => {
      const health = providerSyncHealth(provider);
      return <tr key={provider.id}><td><strong>{provider.name}</strong><small>{provider.id} · HTTPS allowlisted</small></td><td><span className={`status-badge ${provider.status === 'published' ? 'good' : 'neutral'}`}>{provider.status}</span></td><td><strong>v{provider.manifest_version || '—'} · {compactHash(provider.manifest_sha256)}</strong><small>{provider.etag ? `ETag ${provider.etag}` : provider.last_modified ? `Last-Modified ${provider.last_modified}` : 'No cache validator'}</small></td><td>{provider.chipset_count || 0} ChipSets · {provider.sdk_release_count || 0} SDKs</td><td>{formatProviderTimestamp(provider.last_successful_refresh_at)}</td><td><span className={`status-badge ${health.key === 'healthy' ? 'good' : health.key === 'stale' ? 'warning' : health.key === 'unavailable' ? 'danger' : 'neutral'}`}>{health.label}</span>{health.detail ? <small className={health.key === 'healthy' ? '' : 'provider-error'}>{health.detail}</small> : null}</td><td><div className="chipset-row-actions"><button className="link-button" type="button" onClick={() => setDrawer({ mode: 'preview', provider })}>{translate('Preview')}</button>{canEdit && provider.status !== 'published' ? <button className="link-button" type="button" onClick={() => setDrawer({ mode: 'edit', provider })}>{translate('Edit')}</button> : null}{canPublish ? <>{provider.status === 'published' ? <button className="link-button" type="button" onClick={() => act(provider, 'unpublish')}>{translate('Unpublish')}</button> : <button className="link-button" type="button" onClick={() => act(provider, 'publish')}>{translate('Publish')}</button>}<button className="link-button" type="button" onClick={() => act(provider, 'refresh')}>{translate('Refresh')}</button></> : null}</div></td></tr>;
    })}</tbody></table>{!providers.length ? <p className="empty-state">{translate('No Information Providers are available. Add a provider and complete validation preview before publishing.')}</p> : null}{providers.length && !visibleProviders.length ? <p className="empty-state">{translate('No providers match the current search or filters.')}</p> : null}</div></section> : null}
    {drawer ? <ChipsetProviderDrawer mode={drawer.mode} initialProvider={drawer.provider} canEdit={canEdit} canPublish={canPublish} onClose={() => setDrawer(null)} onRefresh={onRefresh} onMessage={setMessage} /> : null}
  </section>;
}

function DeveloperChipsetResources({ data, sdkRelease, loading }) {
  const chipsets = data?.chipsets || [];
  const artifacts = sdkArtifacts(sdkRelease?.catalog);
  const [query, setQuery] = useState('');
  const [vendor, setVendor] = useState('all');
  const [recommendedOnly, setRecommendedOnly] = useState(false);
  const vendors = useMemo(() => chipsetVendors(chipsets), [chipsets]);
  const visibleChipsets = useMemo(() => filterChipsets(chipsets, query, vendor, recommendedOnly), [chipsets, query, vendor, recommendedOnly]);
  return <section className="page-content chipset-resource-page" data-testid="chipset-resource-page">
    <div className="page-intro"><div><p className="eyebrow">Developer Resources</p><p>Choose a Cloud Client SDK for your mobile, web, native, or device application. Hardware-specific SDKs and board resources remain available separately below.</p></div></div>
    <section className="sdk-catalog-section pro2-tool-section" aria-labelledby="device-tools-heading">
      <div className="sdk-section-heading"><div><h2 id="device-tools-heading">Device Tools</h2><p>Browser-based tools for bringing up and diagnosing hardware locally, before or alongside cloud provisioning.</p></div></div>
      <article className="panel pro2-tool-card">
        <span className="pro2-tool-icon" aria-hidden="true"><Icon name="microchip" /></span>
        <div className="pro2-tool-copy"><div><p className="sdk-format">AMEBA PRO2 · WEB SERIAL</p><h3>Ameba PRO2 Firmware Burner</h3></div><p>Connect a board over USB UART, burn and verify a local firmware image, then continue in the live serial console. Firmware and UART data stay in your browser.</p><div className="pro2-tool-meta"><span><Icon name="laptop" />Desktop Chrome or Edge</span><span><Icon name="shield-halved" />No firmware upload</span><span><Icon name="bolt" />NOR / UART flow</span></div></div>
        <a className="primary-button icon-text pro2-tool-action" href={PRO2_FIRMWARE_BURNER_PATH}><Icon name="arrow-right" />Open firmware burner</a>
      </article>
    </section>
    <section className="sdk-catalog-section" aria-labelledby="cloud-client-sdks-heading">
      <div className="sdk-section-heading"><div><h2 id="cloud-client-sdks-heading">Cloud Client SDKs</h2><p>Use these packages to connect an app or a PRO2 device to Realtek Connect+. WebRTC support covers signaling or the device answerer integration boundary; your application still supplies the peer connection, media engine, tracks, and renderer.</p></div>{sdkRelease?.catalog ? <div className="sdk-release-summary"><strong>Release {sdkRelease.catalog.version}</strong><span>Terms {sdkRelease.catalog.terms_version}</span></div> : null}</div>
      {loading && !sdkRelease ? <CloudSDKCardSkeletons /> : null}
      {!loading && sdkRelease?.source_status === 'unpublished' ? <section className="panel split-panel"><div><h3>No Cloud Client SDK release yet</h3><p>{sdkRelease.source_message}</p></div></section> : null}
      {!loading && sdkRelease?.source_status === 'unavailable' ? <section className="panel split-panel"><div><h3>Cloud Client SDKs are temporarily unavailable</h3><p>{sdkRelease.source_message}</p></div></section> : null}
      {artifacts.length ? <div className="cloud-sdk-grid">{artifacts.map((artifact) => <CloudSDKCard artifact={artifact} release={sdkRelease} key={artifact.slug} />)}</div> : null}
    </section>
    <section className="sdk-catalog-section device-sdk-section" aria-labelledby="device-chipset-sdks-heading">
      <div className="sdk-section-heading"><div><h2 id="device-chipset-sdks-heading">Device &amp; ChipSet SDKs</h2><p>Find the official board SDKs, datasheets, examples, and support resources for the chipset used by your product.</p></div></div>
      {loading && !data ? <ChipsetCardSkeletons /> : null}
      {data?.source_status === 'unavailable' ? <section className="panel split-panel"><div><h3>{translate('Resources are temporarily unavailable')}</h3><p>{data.source_message}</p></div></section> : null}
      {!loading && data?.source_status !== 'unavailable' && !chipsets.length ? <section className="panel split-panel"><div><h3>{translate('No published resources')}</h3><p>{translate('ChipSets and SDKs appear here after the platform publishes an Information Provider.')}</p></div></section> : null}
      {!loading && data?.source_status !== 'unavailable' && chipsets.length ? <><div className="chipset-toolbar"><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={translate('Search ChipSets, vendors, SDKs, or supported models')} aria-label={translate('Search ChipSets and SDKs')} /><div className="chipset-filter-tabs" role="group" aria-label="ChipSet filters"><button type="button" className={vendor === 'all' && !recommendedOnly ? 'active' : ''} onClick={() => { setVendor('all'); setRecommendedOnly(false); }}>{translate('All')}</button>{vendors.map((option) => <button type="button" className={vendor === option && !recommendedOnly ? 'active' : ''} onClick={() => { setVendor(option); setRecommendedOnly(false); }} key={option}>{option}</button>)}<button type="button" className={recommendedOnly ? 'active' : ''} onClick={() => { setVendor('all'); setRecommendedOnly(true); }}>Recommended SDK</button></div></div><ChipsetCards chipsets={visibleChipsets} showFreshness />{!visibleChipsets.length ? <section className="panel split-panel"><div><h3>{translate('No matching resources')}</h3><p>{translate('Adjust the search text or filters.')}</p></div></section> : null}</> : null}
    </section>
  </section>;
}

function CloudSDKCard({ artifact, release }) {
  const docsURL = sdkDocumentationURL(release?.portal_url, artifact.slug);
  const isPreview = Boolean(release?.local_preview);
  return <article className={`panel cloud-sdk-card${artifact.slug === 'all' ? ' complete-bundle' : ''}`}>
    <div className="cloud-sdk-card-heading"><div><p className="sdk-format">{sdkArtifactFormat(artifact.slug)}</p><h3>{artifact.title}</h3></div><span className="status-badge good">{artifact.validation_status}</span></div>
    <p>{artifact.description}</p>
    <dl className="cloud-sdk-metadata"><div><dt>Version</dt><dd>{release.catalog.version}</dd></div><div><dt>Size</dt><dd>{formatSDKBytes(artifact.size_bytes)}</dd></div><div className="checksum-row"><dt>SHA-256</dt><dd><code>{artifact.sha256}</code></dd></div></dl>
    <div className="sdk-capability-list" aria-label={`${artifact.title} capabilities`}>{artifact.capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div>
    <ul className="sdk-limitations">{artifact.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
    <div className="cloud-sdk-actions">{isPreview ? <button type="button" className="ghost-button" disabled title="Documentation links are enabled with a published Portal release">Documentation preview</button> : docsURL ? <a className="ghost-button" href={docsURL} target="_blank" rel="noreferrer noopener">Documentation <Icon name="arrow-up-right-from-square" /></a> : null}{isPreview ? <button type="button" className="primary-button" disabled title="Local preview does not create downloadable artifacts">Local preview</button> : <a className="primary-button" href={`${release.portal_url}#downloads`} target="_blank" rel="noreferrer noopener">Review terms &amp; download <Icon name="arrow-up-right-from-square" /></a>}</div>
  </article>;
}

function CloudSDKCardSkeletons() {
  return <div className="cloud-sdk-grid" aria-label="Loading Cloud Client SDKs">{[0, 1, 2].map((index) => <article className="panel cloud-sdk-card chipset-card-skeleton" key={index}><span /><span /><span /><span /></article>)}</div>;
}

function ChipsetCards({ chipsets, showFreshness }) {
	return <div className="chipset-resource-grid">{chipsets.map((chipset) => <article className="panel chipset-card" key={chipset.id || chipset.chipset_key}><div className="chipset-card-heading"><div className="chipset-vendor-mark" aria-hidden="true">{vendorInitials(chipset)}</div><div><h3>{chipset.name}</h3><p className="chipset-vendor-line">{chipset.vendor}{chipset.family ? ` · ${chipset.family} family` : ''}</p></div><span className={`status-badge ${chipset.stale ? 'warning' : 'good'}`}>{chipset.stale ? 'Stale' : 'Current'}</span></div><p>{chipset.description || 'ChipSet developer information'}</p><div className="chipset-card-meta"><span>{chipset.resources?.length || 0} product resources</span><span>{chipset.sdk_releases?.length || 0} SDK releases</span>{showFreshness ? <span>{translate('Last synchronized: {{time}}', { time: chipset.last_successful_refresh_at ? formatRelativeTime(chipset.last_successful_refresh_at) : 'unknown' })}</span> : null}</div>{chipset.resources?.length ? <section className="chipset-product-resources"><h4>{translate('Products and Support')}</h4><ResourceLinks resources={chipset.resources} /></section> : null}{chipset.sdk_releases?.length ? <h4 className="chipset-sdk-heading">SDK</h4> : null}{chipset.sdk_releases?.map((release) => <section className="sdk-release" key={`${release.name}:${release.version}`}><div className="sdk-release-title"><div><strong>{release.name} · {release.version}</strong>{release.summary ? <small>{release.summary}</small> : null}</div>{release.recommended ? <span className="status-badge good">Recommended</span> : null}</div>{release.supported_models?.length ? <div className="chip-list">{release.supported_models.map((model) => <span className="chipset-model-chip" key={model}>{model}</span>)}</div> : null}<ResourceLinks resources={release.endpoints} compact /></section>)}{showFreshness ? <small className="chipset-provider-attribution">Information provided by {chipset.provider_name}</small> : null}</article>)}</div>;
}

function ResourceLinks({ resources = [], compact = false }) {
	const icons = { product: 'microchip', getting_started: 'rocket', documentation: 'book', datasheet: 'file-lines', github: 'code-branch', sdk: 'download', download: 'download', example: 'flask', tool: 'screwdriver-wrench', forum: 'comments', faq: 'circle-question', video: 'circle-play', support: 'headset', community: 'people-group' };
	return <div className={`chipset-resource-links${compact ? ' compact' : ''}`}>{resources.map((resource) => <a key={`${resource.type}:${resource.url}`} href={resource.url} target="_blank" rel="noreferrer noopener" className="chipset-resource-link" title={resource.verified_at ? `Verified ${resource.verified_at}` : undefined}><span className="chipset-resource-link-title"><Icon name={icons[resource.type] || 'arrow-up-right-from-square'} /><strong>{resource.title}</strong></span>{resource.summary && !compact ? <small>{resource.summary}</small> : null}<span className="chipset-resource-link-meta">{resource.source ? <span className={`resource-source ${resource.source}`}>{resource.source === 'official' ? 'Official' : 'Community'}</span> : null}{resource.languages?.length ? <span>{resource.languages.join(' · ')}</span> : null}<Icon name="arrow-up-right-from-square" /></span></a>)}</div>;
}

function ChipsetCardSkeletons() {
  return <div className="chipset-resource-grid" aria-label={translate('Loading developer resources')}>{[0, 1].map((index) => <article className="panel chipset-card chipset-card-skeleton" key={index}><span /><span /><span /><span /></article>)}</div>;
}

function ChipsetProviderDrawer({ mode, initialProvider, canEdit, canPublish, onClose, onRefresh, onMessage }) {
  const [provider, setProvider] = useState(initialProvider);
  const [form, setForm] = useState({ name: initialProvider?.name || '', manifest_url: initialProvider?.manifest_url || '' });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const readOnly = mode === 'preview' || !canEdit;

  async function loadPreview(target = provider) {
    if (!target?.id) return null;
    const response = await fetch(`/api/admin/chipset-providers/${encodeURIComponent(target.id)}`);
    const text = await response.text();
    if (!response.ok) throw new Error(text || translate('Preview is unavailable.'));
    const body = text ? JSON.parse(text) : null;
    setProvider(body?.provider || target);
    setPreview(body);
    return body;
  }

  useEffect(() => {
    if (initialProvider?.id) loadPreview(initialProvider).catch(() => setError('The provider preview is temporarily unavailable.'));
  }, [initialProvider?.id]);

  async function saveDraft() {
    if (!canEdit) return provider;
    const editing = Boolean(provider?.id);
    const response = await fetch(editing ? `/api/admin/chipset-providers/${encodeURIComponent(provider.id)}` : '/api/admin/chipset-providers', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `chipset-provider-${provider?.id || form.manifest_url}-${Date.now()}` },
      body: JSON.stringify(form),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || translate('The provider draft could not be saved.'));
    const body = text ? JSON.parse(text) : null;
    const saved = body?.provider;
    setProvider(saved);
    onMessage(body?.audit_result === 'accepted' ? translate('Provider draft saved.') : translate('Provider saved, but the audit record could not be written.'));
    onRefresh();
    return saved;
  }

  async function runAction(action, target) {
    const response = await fetch(`/api/admin/chipset-providers/${encodeURIComponent(target.id)}/${action}`, { method: 'POST', headers: { 'Idempotency-Key': `chipset-provider-${target.id}-${action}-${Date.now()}` } });
    const text = await response.text();
    if (!response.ok) throw new Error(text || `Provider ${action} failed.`);
    const body = text ? JSON.parse(text) : null;
    setProvider(body?.provider || target);
    onRefresh();
    return body?.provider || target;
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try { await saveDraft(); onClose(); } catch (_) { setError('The provider draft could not be saved. Please try again.'); } finally { setBusy(false); }
  }

  async function validatePreview() {
    setBusy(true); setError('');
    try {
      const saved = mode === 'create' || mode === 'edit' ? await saveDraft() : provider;
      const refreshed = await runAction('refresh', saved);
      await loadPreview(refreshed);
      onMessage(translate('Provider validation preview updated.'));
    } catch (_) { setError('The provider validation preview could not be updated. Please try again.'); } finally { setBusy(false); }
  }

  async function publish() {
    setBusy(true); setError('');
    try {
      const saved = mode === 'create' || mode === 'edit' ? await saveDraft() : provider;
      await runAction('publish', saved);
      onMessage(translate('Provider publishing completed.')); onClose();
    } catch (_) { setError('The provider could not be published. Please try again.'); } finally { setBusy(false); }
  }

  const detailProvider = preview?.provider || provider;
  const endpointCount = providerEndpointCount(preview?.chipsets || []);
  const validationError = providerValidationErrorMessage(detailProvider);
  return <div className="drawer-backdrop" role="presentation" onClick={onClose}><aside className="drawer-panel chipset-provider-drawer" role="dialog" aria-modal="true" aria-label="ChipSet provider drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><h2>{mode === 'create' ? translate('Add Information Provider') : mode === 'edit' ? translate('Edit Information Provider') : translate('Manifest Parsing Preview')}</h2><p>{translate('Create a draft, then synchronize and validate the manifest before publishing.')}</p></div><button type="button" className="drawer-close" onClick={onClose} aria-label={translate('Close provider drawer')}>×</button></div><form className="drawer-form" onSubmit={submit}><label>Provider display name<input className="input" required disabled={readOnly} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Manifest URL<input className="input" required disabled={readOnly} type="url" pattern="https://.*" value={form.manifest_url} onChange={(event) => setForm({ ...form, manifest_url: event.target.value })} /></label>{detailProvider ? <section className="chipset-validation-preview"><div className="panel-head"><div><h3>Validation preview</h3><p>{validationError || translate('Review the manifest schema and normalized resources.')}</p></div></div><div className="chipset-validation-grid"><div><span>Manifest</span><strong className={detailProvider.manifest_version ? 'good' : ''}>Version {detailProvider.manifest_version || '—'}</strong></div><div><span>ChipSets</span><strong>{detailProvider.chipset_count || 0}</strong></div><div><span>SDK releases</span><strong>{detailProvider.sdk_release_count || 0}</strong></div><div><span>Endpoints</span><strong>{endpointCount}</strong></div></div>{validationError ? <p className="drawer-error">{validationError}</p> : null}{preview?.chipsets?.length ? <ChipsetCards chipsets={preview.chipsets} showFreshness={false} /> : <p className="empty-state">{translate('No normalized preview is available. Run Validate Preview.')}</p>}</section> : null}{error ? <p className="drawer-error">{error}</p> : null}<div className="drawer-actions"><button type="button" className="ghost-button" onClick={onClose}>{translate('Cancel')}</button>{!readOnly ? <button type="submit" className="ghost-button" disabled={busy}>{translate('Save Draft')}</button> : null}{canPublish ? <button type="button" className="ghost-button" disabled={busy || (!provider?.id && readOnly)} onClick={validatePreview}>Validate Preview</button> : null}{canPublish && detailProvider?.status !== 'published' ? <button type="button" className="primary-button" disabled={busy || (!provider?.id && readOnly)} onClick={publish}>Publish</button> : null}</div></form></aside></div>;
}

function ProductsPage({ loading, data, onRefresh }) {
  const items = data?.products || [];
  const [showCreate, setShowCreate] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState({ name: '', product_model: '', category: 'ip_camera', service_capabilities: ['video_streaming'] });
  const [message, setMessage] = useState('');
  const [collaborationProduct, setCollaborationProduct] = useState(null);
  const [collaboration, setCollaboration] = useState(null);
  const [invite, setInvite] = useState({ email: '', role: 'product_editor' });
  const canManage = Boolean(data?.can_manage);
  async function loadCollaborators(product) {
    setCollaborationProduct(product); setCollaboration(null);
    const response = await fetch(`/api/products/${encodeURIComponent(product.id)}/collaborators`);
    setCollaboration(response.ok ? await response.json() : { source_status: 'unavailable' });
  }
  async function inviteCollaborator(event) {
    event.preventDefault();
    const response = await fetch(`/api/products/${encodeURIComponent(collaborationProduct.id)}/collaborator-invitations`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `product-invite-${collaborationProduct.id}-${invite.email}` }, body: JSON.stringify(invite) });
    setMessage(response.ok ? 'Product collaborator invitation sent.' : 'The invitation could not be sent. Confirm that the email belongs to a registered Developer who is not already a collaborator.');
    if (response.ok) { setInvite({ email: '', role: 'product_editor' }); await loadCollaborators(collaborationProduct); }
  }
  async function updateCollaborator(userId, role) {
    const response = await fetch(`/api/products/${encodeURIComponent(collaborationProduct.id)}/collaborators/${encodeURIComponent(userId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `product-role-${collaborationProduct.id}-${userId}-${role}` }, body: JSON.stringify({ role }) });
    setMessage(response.ok ? 'Collaborator role updated.' : 'Could not update collaborator role.'); if (response.ok) await loadCollaborators(collaborationProduct);
  }
  async function removeCollaborator(userId) {
    const response = await fetch(`/api/products/${encodeURIComponent(collaborationProduct.id)}/collaborators/${encodeURIComponent(userId)}`, { method: 'DELETE', headers: { 'Idempotency-Key': `product-remove-${collaborationProduct.id}-${userId}` } });
    setMessage(response.ok ? 'Collaborator removed.' : 'Could not remove collaborator.'); if (response.ok) await loadCollaborators(collaborationProduct);
  }
  async function transferOwner(userId) {
    const response = await fetch(`/api/products/${encodeURIComponent(collaborationProduct.id)}/owner-transfer`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `product-owner-${collaborationProduct.id}-${userId}` }, body: JSON.stringify({ target_user_id: userId }) });
    setMessage(response.ok ? 'Product ownership transferred.' : 'Product ownership could not be transferred.'); if (response.ok) { await loadCollaborators(collaborationProduct); onRefresh(); }
  }
  async function invitationAction(invitationId, action) {
    const response = await fetch(`/api/products/${encodeURIComponent(collaborationProduct.id)}/collaborator-invitations/${encodeURIComponent(invitationId)}/${action}`, { method: 'POST', headers: { 'Idempotency-Key': `product-invite-${action}-${invitationId}-${Date.now()}` } });
    setMessage(response.ok ? (action === 'resend' ? 'Invitation resent.' : 'Invitation canceled.') : 'The invitation could not be updated.'); if (response.ok) await loadCollaborators(collaborationProduct);
  }
  async function createProduct(event) {
    event.preventDefault();
    const response = await fetch(editingProduct ? `/api/products/${encodeURIComponent(editingProduct.id)}` : '/api/products', { method: editingProduct ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `product-write-${editingProduct?.id || form.name}` }, body: JSON.stringify(form) });
    setMessage(response.ok ? (editingProduct ? 'Product updated.' : 'Product created.') : 'The Product cannot be saved right now.');
    if (response.ok) { setShowCreate(false); setEditingProduct(null); setPreview(null); onRefresh(); }
  }
  async function previewProduct() {
    if (!editingProduct) return;
    const response = await fetch(`/api/products/${encodeURIComponent(editingProduct.id)}/impact-preview`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `product-impact-${editingProduct.id}-${Date.now()}` }, body: JSON.stringify(form) });
    setPreview(response.ok ? await response.json() : { source_status: 'unavailable' });
  }
  const unavailable = data?.source_status === 'unavailable' || data?.source_status === 'unconfigured';
  return (
    <section className="page-content">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Brand Fleet</p>
          <h2>Products and Services</h2>
          <p>See what services are available for each product and what your current role can manage.</p>
        </div>
        {canManage ? <button type="button" className="primary-button" onClick={() => { setEditingProduct(null); setPreview(null); setShowCreate((value) => !value); }}>＋ Add Product</button> : null}
      </div>
      {message ? <div className="notice">{message}</div> : null}
      {showCreate ? <section className="panel"><form className="product-create-form" onSubmit={createProduct}><input required placeholder="Product Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><input required placeholder="Product Model" value={form.product_model} onChange={(event) => setForm({ ...form, product_model: event.target.value })} /><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="ip_camera">Imaging Device</option><option value="mqtt_device">Telemetry Device</option><option value="generic">General Device</option></select><div className="service-checks">{PRODUCT_SERVICE_CAPABILITIES.map((service) => <label key={service.code}><input type="checkbox" checked={form.service_capabilities.includes(service.code)} onChange={(event) => setForm({ ...form, service_capabilities: event.target.checked ? [...form.service_capabilities, service.code] : form.service_capabilities.filter((item) => item !== service.code) })} />{translate(service.label)}</label>)}</div>{editingProduct ? <button type="button" className="ghost-button" onClick={previewProduct}>{translate('Preview Change Impact')}</button> : null}<button type="submit" className="primary">{editingProduct ? translate('Save Changes') : translate('Save Product')}</button>{preview ? <p className="notice">{preview.source_status === 'available' ? translate('{{count}} devices will be affected. {{impact}}', { count: formatNumber(preview.affected_devices || 0), impact: preview.requires_reprovision ? 'Reconfiguration may be required.' : 'No reconfiguration is required.' }) : translate('Impact preview is currently unavailable.')}</p> : null}</form></section> : null}
      {loading ? <section className="panel split-panel"><div><h3>Loading Product</h3><p>Getting product and service settings.</p></div></section> : null}
      {!loading && unavailable ? <section className="panel split-panel"><div><h3>Product data temporarily unavailable</h3><p>{sourceMessage(data, 'Please try again later or make sure your Brand Cloud is configured.')}</p></div></section> : null}
      {!loading && !unavailable && items.length === 0 ? <section className="panel split-panel"><div><h3>No Products yet</h3><p>Products and their available services will appear here after setup.</p></div></section> : null}
      {!loading && !unavailable && items.length > 0 ? (
        <section className="panel">
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Product</th><th>My Role</th><th>Product Model</th><th>Devices</th><th>Production Runs</th><th>Available Services</th><th>Device Policy</th><th>Firmware Policy</th><th>Available Actions</th><th>Status</th></tr></thead>
              <tbody>{items.map((product) => <tr key={product.id}>
                <td><strong>{product.name}</strong><small>{product.id}</small></td>
                <td><span className="status-badge neutral">{product.current_user_role === 'brand_owner' ? 'Brand Owner' : product.current_user_role === 'product_owner' ? 'Owner' : product.current_user_role === 'product_editor' ? 'Editor' : 'Viewer'}</span>{product.allowed_actions?.includes('manage_collaborators') ? <button type="button" className="link-button" onClick={() => loadCollaborators(product)}>Collaborators ({product.collaborator_count || 0})</button> : null}</td>
                <td>{product.product_model || product.category || '—'}</td>
                <td>{formatNumber(product.device_count || 0)}</td>
                <td>{formatNumber(product.production_run_count || 0)} production runs</td>
                <td>{product.service_capabilities?.length ? product.service_capabilities.map(productServiceCapabilityLabel).join(', ') : 'Inactive'}</td>
                <td>{product.device_policy?.setup_available || product.device_policy?.binding_available ? 'Set' : 'Not set'}</td>
                <td>{product.firmware_policy?.ota_enabled ? 'Allow firmware updates' : 'Inactive'}</td>
                <td>{product.allowed_actions?.length ? product.allowed_actions.map((action) => action === 'manage_devices' ? 'Manage Devices' : action === 'manage_updates' ? 'Manage Updates' : action === 'view_reports' ? 'View Reports' : action === 'manage_collaborators' ? 'Manage Collaborators' : action === 'edit_product' ? 'Edit Product' : 'View').join(', ') : 'Contact an administrator'}{product.allowed_actions?.includes('edit_product') ? <button type="button" className="link-button" onClick={() => { setEditingProduct(product); setForm({ name: product.name, product_model: product.product_model || '', category: product.category || 'generic', service_capabilities: (product.service_capabilities || []).map(normalizeProductServiceCapability) }); setPreview(null); setShowCreate(true); }}>Edit</button> : null}</td>
                <td><span className={product.status === 'active' ? 'status-badge good' : 'status-badge neutral'}>{product.status === 'active' ? 'Activate' : 'Deactivate'}</span>{product.status === 'active' && product.allowed_actions?.includes('disable_product') ? <button type="button" className="link-button" onClick={async () => { await fetch(`/api/products/${encodeURIComponent(product.id)}/disable`, { method: 'POST', headers: { 'Idempotency-Key': `product-disable-${product.id}` } }); onRefresh(); }}>Deactivate</button> : null}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>
      ) : null}
      {collaborationProduct ? <section className="panel" data-testid="product-collaborators"><div className="panel-head"><div><h3>{collaborationProduct.name} Collaborators</h3><p>Collaborators will only see the assigned Product; the Editor can perform project work and the Viewer is read-only.</p></div><button type="button" className="link-button" onClick={() => { setCollaborationProduct(null); setCollaboration(null); }}>Close</button></div>{collaboration?.source_status === 'unavailable' ? <p className="notice">Collaborator data is currently unavailable.</p> : <><form className="inline-form" onSubmit={inviteCollaborator}><input required type="email" placeholder="Registered Developer Email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} /><select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value })}><option value="product_editor">Editor</option><option value="product_viewer">Viewer</option></select><button type="submit" className="primary">Invite to this Product</button></form><div className="table-wrap"><table className="data-table"><thead><tr><th>Developer</th><th>Role</th><th>Action</th></tr></thead><tbody>{(collaboration?.collaborators || []).map((person) => <tr key={person.user_id}><td><strong>{person.display_name || person.email}</strong><small>{person.email}</small></td><td>{person.role === 'product_owner' ? 'Owner' : <select value={person.role} onChange={(event) => updateCollaborator(person.user_id, event.target.value)}><option value="product_editor">Editor</option><option value="product_viewer">Viewer</option></select>}</td><td>{person.role === 'product_owner' ? 'Ownership transfer required' : <><button type="button" className="link-button" onClick={() => transferOwner(person.user_id)}>Transfer Owner</button><button type="button" className="link-button" onClick={() => removeCollaborator(person.user_id)}>Remove</button></>}</td></tr>)}</tbody></table></div>{(collaboration?.invitations || []).some((item) => item.status === 'pending') ? <div className="chip-list">{collaboration.invitations.filter((item) => item.status === 'pending').map((item) => <span className="status-badge neutral" key={item.id}>{item.target_email} · {item.role === 'product_editor' ? 'Editor' : 'Viewer'} · Pending Acceptance <button type="button" className="link-button" onClick={() => invitationAction(item.id, 'resend')}>Resend</button><button type="button" className="link-button" onClick={() => invitationAction(item.id, 'cancel')}>Cancel</button></span>)}</div> : null}</>}</section> : null}
    </section>
  );
}

function GroupsPage({ data, loading, onRefresh }) {
  const groups = data?.groups || [];
  const tags = data?.tags || [];
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [message, setMessage] = useState('');
  const [editingTag, setEditingTag] = useState(null);
  const [tagName, setTagName] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const canManage = data?.allowed_actions?.includes('manage');
  async function createGroup(event) {
    event.preventDefault();
    const response = await fetch(scopedCustomerAPI('/api/groups', cloudIdFromPath(window.location.pathname)), { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `group-create-${form.name}` }, body: JSON.stringify(form) });
    setMessage(response.ok ? 'Group created.' : 'The group could not be created at this time.');
    if (response.ok) { setForm({ name: '', description: '' }); setShowCreate(false); onRefresh(); }
  }
  async function deleteGroup(group) {
    if (!window.confirm(`Are you sure you want to delete “${group.name}”?`)) return;
    const response = await fetch(scopedCustomerAPI(`/api/groups/${encodeURIComponent(group.id)}`, cloudIdFromPath(window.location.pathname)), { method: 'DELETE', headers: { 'Idempotency-Key': `group-delete-${group.id}` } });
    setMessage(response.ok ? 'Group deleted.' : 'The group cannot be deleted at this time.');
    if (response.ok) onRefresh();
  }
  async function renameTag(event) {
    event.preventDefault();
    const response = await fetch(scopedCustomerAPI(`/api/tags/${encodeURIComponent(editingTag.tag)}`, cloudIdFromPath(window.location.pathname)), { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `tag-rename-${editingTag.tag}-${tagName}` }, body: JSON.stringify({ name: tagName }) });
    setMessage(response.ok ? 'Tag renamed.' : 'The tag could not be renamed.');
    if (response.ok) { setEditingTag(null); setTagName(''); onRefresh(); }
  }
  async function createTag(event) {
    event.preventDefault();
    const response = await fetch(scopedCustomerAPI('/api/tags', cloudIdFromPath(window.location.pathname)), { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `tag-create-${newTagName}` }, body: JSON.stringify({ name: newTagName }) });
    setMessage(response.ok ? 'Tag created.' : 'The tag could not be created.');
    if (response.ok) { setNewTagName(''); onRefresh(); }
  }
  async function deleteTag(tag) {
    if (!window.confirm(`Delete tag “${tag.tag}” from all devices?`)) return;
    const response = await fetch(scopedCustomerAPI(`/api/tags/${encodeURIComponent(tag.tag)}`, cloudIdFromPath(window.location.pathname)), { method: 'DELETE', headers: { 'Idempotency-Key': `tag-delete-${tag.tag}` } });
    setMessage(response.ok ? 'Tag deleted.' : 'The tag could not be deleted.');
    if (response.ok) onRefresh();
  }
  return <section className="page-content">
    <div className="page-intro"><div><p className="eyebrow">Fleet Organization</p><h2>Groups and Tags</h2><p>Organize devices into groups to manage firmware updates and reports.</p></div>{canManage ? <button type="button" className="primary" onClick={() => setShowCreate((value) => !value)}>＋ Add Group</button> : null}</div>
    {message ? <div className="notice">{message}</div> : null}
    {showCreate ? <section className="panel"><form className="inline-form" onSubmit={createGroup}><input required placeholder="Group name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><input placeholder="Description (optional)" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><button type="submit" className="primary">Save Group</button></form></section> : null}
    {loading ? <section className="panel split-panel"><div><h3>Loading groups</h3></div></section> : null}
    {!loading && data?.source_status !== 'available' ? <section className="panel split-panel"><div><h3>Group data temporarily unavailable</h3><p>{sourceMessage(data, 'Please try again later.')}</p></div></section> : null}
    {!loading && data?.source_status === 'available' ? <section className="panel"><div className="table-wrap"><table className="data-table"><thead><tr><th>Group</th><th>Description</th><th>Devices</th>{canManage ? <th>Action</th> : null}</tr></thead><tbody>{groups.map((group) => <tr key={group.id}><td><strong>{group.name}</strong><small>{group.id}</small></td><td>{group.description || '—'}</td><td>{formatNumber(group.device_count || 0)} devices</td>{canManage ? <td><button type="button" className="link-button" onClick={() => deleteGroup(group)}>Delete</button></td> : null}</tr>)}</tbody></table>{!groups.length ? <p className="empty-state">No groups yet.</p> : null}</div></section> : null}
    {!loading && data?.source_status === 'available' ? <section className="panel"><div className="panel-head"><div><h3>Tags</h3><p>Tags can be used to search for devices and define firmware update scopes.</p></div></div>{canManage ? <form className="inline-form" onSubmit={createTag}><input required maxLength="100" placeholder="New tag name" value={newTagName} onChange={(event) => setNewTagName(event.target.value)} /><button type="submit" className="primary">Add Tag</button></form> : null}{editingTag ? <form className="inline-form" onSubmit={renameTag}><input required maxLength="100" value={tagName} onChange={(event) => setTagName(event.target.value)} /><button type="submit" className="primary">Save Tag</button><button type="button" className="link-button" onClick={() => setEditingTag(null)}>Cancel</button></form> : null}<div className="chip-list">{tags.map((tag) => <span className="status-badge neutral" key={tag.tag}>{tag.tag} · {formatNumber(tag.device_count)} devices{canManage ? <><button type="button" className="link-button" onClick={() => { setEditingTag(tag); setTagName(tag.tag); }}>Rename</button><button type="button" className="link-button" onClick={() => deleteTag(tag)}>Delete</button></> : null}</span>)}</div>{!tags.length ? <p className="empty-state">No tags yet.</p> : null}</section> : null}
  </section>;
}

function BrandCloudMemberInvitationAcceptPage() {
	const isProductInvitation = window.location.pathname === '/product-collaborator-invitation/accept';
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') || '');
  const [requestKey] = useState(() => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState(token ? 'Confirm to join Brand Cloud.' : 'The invitation link is missing a token.');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.history.replaceState({}, '', isProductInvitation ? '/product-collaborator-invitation/accept' : '/brand-cloud-member-invitation/accept');
  }, []);

  async function acceptInvitation() {
    if (busy) return;
    setBusy(true);
    setMessage('Verifying invitation…');
    try {
    const response = await fetch(isProductInvitation ? '/api/developer/product-collaborator-invitations/accept' : '/api/developer/brand-cloud-member-invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `member-invitation-accept-${requestKey}` },
      body: JSON.stringify({ token }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setResult(body);
      setMessage(isProductInvitation ? 'Invitation accepted. Product access has been granted.' : 'Invitation accepted. Brand Cloud membership has been created.');
    } else if (response.status === 404) {
      setMessage('The invitation is invalid, expired, used, or the login account is not the invitee.');
    } else if (response.status === 409) {
      setMessage('Invitation canceled, expired, or membership already exists.');
    } else {
      setMessage('Unable to accept invitation at this time, please try again later.');
    }
    } catch (_) {
      setMessage('Connection interrupted. Retry the same invitation; access has not been confirmed.');
    } finally { setBusy(false); }
  }

  const cloudID = result?.invitation?.brand_cloud_id || '';
  return <div className="public-auth-shell"><section className="auth-hero"><p className="eyebrow">{isProductInvitation ? 'Product invitation' : 'Brand Cloud invitation'}</p><h1>{isProductInvitation ? 'Accept Product collaboration invitation' : 'Accept team invitation'}</h1><p>We’ll verify both the invitation token and the signed-in Developer account.</p></section><section className="panel auth-panel"><p className="auth-status">{message}</p>{!result ? <button type="button" className="primary" disabled={!token || busy} onClick={acceptInvitation}>{busy ? 'Verifying…' : 'Accept invitation'}</button> : <a className="inline-action" href={isProductInvitation ? productInvitationDestination(result) : `/console/clouds/${encodeURIComponent(cloudID)}`}>{isProductInvitation ? 'Go to Product' : 'Open shared cloud'}</a>}</section></div>;
}

function TeamAccessPage({ data, me, cloudName, loading, activeCloudId, canManage, onRefresh }) {
  const members = data?.members || [];
  const invitations = (data?.invitations || []).filter((invitation) => invitation.status === 'pending');
  const assignments = data?.role_assignments || [];
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [message, setMessage] = useState('');
  const activeMembership = getActiveMembership(me);
  const currentMember = members.find((member) => member.email === me?.email);
  const currentRole = activeMembership?.role || currentMember?.role || assignments[0]?.role_name || '';
  const currentRoleDetails = userRoleDetails(currentRole);
  const sourceAvailableFor = (key) => !data || data[key] !== 'unavailable';
  const scopeLabel = (assignment) => {
    if (assignment.scope_type === 'organization') return 'Entire Brand Account';
    if (assignment.scope_type === 'product') return `Product: ${assignment.scope_id}`;
    if (assignment.scope_type === 'region') return `Area:${assignment.scope_id}`;
    if (assignment.scope_type === 'group') return `Group:${assignment.scope_id}`;
    if (assignment.scope_type === 'device') return 'Designated Devices';
    return 'Assign Scope';
  };

  async function inviteMember(event) {
    event.preventDefault();
    const response = await fetch(`/api/developer/brand-clouds/${encodeURIComponent(activeCloudId)}/members/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `member-invite-${email}-${role}` },
      body: JSON.stringify({ email, role }),
    });
    setMessage(response.ok ? 'The invitation has been sent and they won’t be a member until they accept.' : 'Invitations can’t be sent right now.');
    if (response.ok) {
      setEmail('');
      setShowInviteForm(false);
      onRefresh();
    }
  }

  async function invitationAction(invitation, action) {
    const response = await fetch(`/api/developer/brand-clouds/${encodeURIComponent(activeCloudId)}/members/invitations/${encodeURIComponent(invitation.id)}/${action}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `member-invite-${action}-${invitation.id}-${Date.now()}` },
    });
    setMessage(response.ok ? (action === 'resend' ? 'Invitation resent.' : 'Invitation canceled.') : 'Invitations can’t be updated at this time.');
    if (response.ok) onRefresh();
  }

  async function updateMember(member, action, nextRole = '') {
    const roleUpdate = action === 'role';
    const response = await fetch(`/api/developer/brand-clouds/${encodeURIComponent(activeCloudId)}/members/${encodeURIComponent(member.user_id)}${roleUpdate || action === 'remove' ? '' : `/${action}`}`, {
      method: action === 'remove' ? 'DELETE' : 'PATCH',
      headers: {
        ...(roleUpdate ? { 'Content-Type': 'application/json' } : {}),
        'Idempotency-Key': `member-${action}-${member.user_id}-${nextRole || Date.now()}`,
      },
      body: roleUpdate ? JSON.stringify({ role: nextRole }) : undefined,
    });
    setMessage(response.ok ? 'Member information updated.' : 'Member information cannot be updated at this time.');
    if (response.ok) onRefresh();
  }

  return <section className="page-content team-access-page">
    <div className="page-intro"><div><p className="eyebrow">Fleet Governance</p><h2><Icon name="users" />Members and Access</h2><p>The role determines what can be done, and the scope determines which Products, Regions, Groups, or Devices can be managed.</p></div>
      {canManage && activeCloudId ? <button type="button" className="primary" onClick={() => setShowInviteForm((visible) => !visible)}><Icon name="user-plus" /> Invite members</button> : null}
    </div>
    {showInviteForm ? <section className="panel invite-member-panel"><form className="inline-form" onSubmit={inviteMember}>
      <input required type="email" placeholder="Member Email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <select value={role} onChange={(event) => setRole(event.target.value)}><option value="member">Member</option><option value="admin">Admin</option></select>
      <button type="submit" className="primary">Send invitation</button>
      <button type="button" className="ghost-button" onClick={() => setShowInviteForm(false)}>Cancel</button>
    </form></section> : null}
    {message ? <div className="notice">{message}</div> : null}
    {loading && !data ? <section className="panel split-panel"><div><h3>Loading permissions</h3></div></section> : null}
    {!loading && data?.source_status === 'unavailable' ? <section className="panel split-panel"><div><h3>Permission data temporarily unavailable</h3><p>{sourceMessage(data, 'Please try again later.')}</p></div></section> : null}
    {canManage && sourceAvailableFor('invitations_source_status') ? <section className="panel"><div className="panel-head"><div><h3><Icon name="envelope" />Pending invitations</h3><p>Invitation links are valid for 30 minutes. Resending immediately expires the previous link.</p></div></div>{invitations.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Expires</th><th>Action</th></tr></thead><tbody>{invitations.map((invitation) => <tr key={invitation.id}><td>{invitation.target_email}</td><td>{invitation.role}</td><td><span className="status-badge neutral">Pending acceptance</span></td><td>{formatProviderTimestamp(invitation.expires_at)}</td><td><button type="button" className="link-button" onClick={() => invitationAction(invitation, 'resend')}>Resend</button> <button type="button" className="link-button" onClick={() => invitationAction(invitation, 'cancel')}>Cancel</button></td></tr>)}</tbody></table></div> : <p className="access-empty"><Icon name="inbox" /> {loading ? "Loading invitations…" : "No pending invitations."}</p>}</section> : null}
    {sourceAvailableFor('members_source_status') ? <section className="panel"><div className="panel-head"><div><h3><Icon name="users" />Brand Cloud Members</h3><p>Manage who can access this Brand Cloud and what each member can do.</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Members</th><th>Role</th><th>Status</th>{canManage ? <th>Action</th> : null}</tr></thead><tbody>{members.map((member) => <tr key={member.user_id}><td><strong>{member.display_name || member.email}</strong>{member.display_name && member.display_name !== member.email ? <small>{member.email}</small> : null}</td><td>{canManage && member.role !== 'owner' ? <select value={member.role} onChange={(event) => updateMember(member, 'role', event.target.value)}><option value="admin">Admin</option><option value="member">Member</option></select> : userRoleDetails(member.role).title}</td><td><span className={`status-badge ${member.disabled_at ? 'neutral' : 'good'}`}><Icon name={member.disabled_at ? "circle-pause" : "circle-check"} /> {member.disabled_at ? 'Inactive' : 'Active'}</span></td>{canManage ? <td>{member.role === 'owner' ? 'Owner transfer only' : <><button type="button" className="link-button" onClick={() => updateMember(member, member.disabled_at ? 'enable' : 'disable')}>{member.disabled_at ? 'Activate' : 'Deactivate'}</button> <button type="button" className="link-button" onClick={() => updateMember(member, 'remove')}>Remove</button></>}</td> : null}</tr>)}</tbody></table>{!members.length ? <p className="empty-state">There are currently no Brand Cloud members.</p> : null}</div></section> : null}
    {sourceAvailableFor('assignments_source_status') ? <>
      <section className="panel current-role-panel"><div className="panel-head"><div><h3><Icon name="shield-halved" />Your Roles and Permissions</h3><p>Your role defines your actions. Your assigned scope determines where you can use them.</p></div><span className="status-badge good"><Icon name="circle-check" /> Your access</span></div><div className="current-role-card"><div className="current-role-icon"><Icon name={currentRoleDetails.icon} /></div><div><div className="current-role-title"><h4>{currentRoleDetails.title}</h4>{currentRole ? <code>{currentRole}</code> : null}</div><p>{currentRoleDetails.description}</p><ul className="current-role-actions">{currentRoleDetails.actions.map((action) => <li key={action}><Icon name="circle-check" />{action}</li>)}</ul>{cloudName || activeMembership?.organization ? <p className="current-role-scope"><strong>Currently Applied:</strong>{cloudName || activeMembership.organization}</p> : null}</div></div>{canManage ? <p className="field-help">You can invite or adjust team members above; brand owners can only pass through the Ownership Transfer.</p> : <p className="field-help">If you need more access, contact your brand owner or administrator to adjust your role and scope.</p>}</section>
      <section className="panel"><div className="panel-head"><div><h3><Icon name="bullseye" />Current Permission Scope</h3><p>The Brand Cloud, products, and other resources covered by your roles.</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Role</th><th>Manage Scope</th><th>Status</th></tr></thead><tbody>{assignments.map((assignment) => <tr key={assignment.id}><td><strong>{userRoleDetails(assignment.role_name).title}</strong></td><td>{scopeLabel(assignment)}</td><td><span className="status-badge good"><Icon name="circle-check" /> Active</span></td></tr>)}</tbody></table>{!assignments.length ? <p className="empty-state">There are currently no additional range assignments.</p> : null}</div></section>
    </> : <section className="panel split-panel"><div><h3>Roles and scopes are temporarily unavailable</h3><p>{sourceMessage(data, 'Please try again later.')}</p></div></section>}
  </section>;
}

function BrandCloudSettingsPage({ activeCloudId, canIssuePKITest, products = [], productsLoading, productsUnavailable }) {
  return <section className="page-content brand-cloud-settings-page">
    <div className="page-intro"><h2>Settings</h2></div>
    <section className="panel"><h3 className="test-device-icon-text"><Icon name="arrows-rotate" />Ownership and Billing handoff</h3><p>Manage ownership in My Clouds. Invitation acceptance starts settlement; it does not complete the transfer.</p><a className="ghost-button settings-action" href={activeCloudId ? `/console/clouds/${encodeURIComponent(activeCloudId)}` : '/console/clouds'}><Icon name="cloud" />Open cloud management<Icon name="arrow-right" /></a></section>
    {canIssuePKITest && activeCloudId ? <PKITestBundleTool activeCloudId={activeCloudId} products={products} productsLoading={productsLoading} productsUnavailable={productsUnavailable} /> : null}
  </section>;
}

const BillingScope = React.createContext(null);

function CloudBillingApp() {
  const route = cloudBillingRoute(window.location.pathname), cloudId = route.cloudId;
  const [state, setState] = useState(null), [error,setError] = useState(''), [reload,setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setState(null); setError('');
    (async () => { try {
      const me = await managedCloudRequest('/api/me',{signal:controller.signal});
      if (!me.authenticated) { window.location.replace(loginPathFor(window.location.pathname)); return; }
      const {brand_cloud:cloud} = await managedCloudRequest(cloudAPI(cloudId),{signal:controller.signal});
      if (cloud.my_role !== 'owner' || cloud.owner_user_id !== me.user_id || !cloud.capabilities?.includes('billing_account.read')) throw {status:403};
      const data = await fetchCloudBillingData(cloudId,{signal:controller.signal});
      if (String(cloud.ownership_version) !== data.ownershipVersion) throw {status:409};
      if (!controller.signal.aborted) setState({cloud,data,me});
    } catch (err) { if (!controller.signal.aborted) { setState(null); setError(billingScopeError(err.status)); } } })();
    return () => controller.abort();
  },[cloudId,reload]);
  useEffect(()=>{
    if (!state) return;
    const controller=new AbortController(); let checking=false;
    const verify=async()=>{
      if (checking || controller.signal.aborted) return;
      checking=true;
      try {
        const {brand_cloud:cloud}=await managedCloudRequest(cloudAPI(cloudId),{signal:controller.signal});
        if (cloud.my_role!=='owner' || cloud.owner_user_id!==state.cloud.owner_user_id || !cloud.capabilities?.includes('billing_account.read')) throw {status:403};
        if (String(cloud.ownership_version)!==state.data.ownershipVersion) throw {status:409};
      } catch(err) { if (!controller.signal.aborted) {setState(null);setError(billingScopeError(err.status));} }
      finally {checking=false;}
    };
    const timer=setInterval(verify,10000);window.addEventListener('focus',verify);
    return ()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',verify);};
  },[cloudId,state?.cloud.id,state?.data.ownershipVersion]);
  return <CloudConsoleShell me={state?.me} cloud={state?.cloud} active="billing" title="Billing" onError={setError}><div className="billing-workspace">{error ? <p role="alert">{error}</p> : !state && <p role="status">Loading owner-scoped Billing…</p>}<button onClick={()=>setReload(v=>v+1)}>Refresh Billing</button>{state && <BillingScope.Provider value={{cloudId,version:state.data.ownershipVersion,onAccessLost:()=>{setState(null);setError(billingScopeError(403));}}}><BillingPage key={`${cloudId}:${state.data.ownershipVersion}`} data={state.data} loading={false} capabilities={state.cloud.capabilities} onRefresh={()=>setReload(v=>v+1)} /></BillingScope.Provider>}</div></CloudConsoleShell>;
}

function BillingPage({ data, loading, capabilities, onRefresh }) {
  const billingScope = React.useContext(BillingScope);
  const {cloudId} = billingScope;
  const account = data?.account?.account;
  const summary = data?.summary || {};
  const usage = data?.usage || summary?.current_period || {};
  const invoices = data?.invoices?.invoices || [];
  const activities = data?.activity?.activities || [];
  const billingProfile = data?.profile?.billing_profile || data?.profile?.profile || {};
  const methods = data?.methods?.payment_methods || [];
  const intents = data?.intents?.payment_intents || [];
  const ledger = data?.ledger?.ledger_entries || [];
  const policy = data?.policy?.auto_topup || data?.account?.auto_topup || null;
  const providers = data?.account?.payment_providers || [];
  const setupProvider = providers.find((provider) => provider.capabilities?.hosted_setup);
  const hostedChargeProvider = providers.find((provider) => provider.capabilities?.hosted_charge);
  const policyState = autoTopUpAssessment(policy);
  const activeMethod = methods.find((method) => method.status === 'active') || methods[0];
  const canManageMethods = capabilities.includes('payment_method.manage');
  const canManagePolicy = capabilities.includes('auto_topup.manage');
  const chargeQualified = Boolean(activeMethod?.capabilities?.merchant_initiated_charge);
  const [threshold, setThreshold] = useState(String(policy?.threshold_minor || 300));
  const [topUpAmount, setTopUpAmount] = useState(String(policy?.top_up_amount_minor || 300));
  const [dailyAmount, setDailyAmount] = useState(String(policy?.daily_amount_limit_minor || 1000));
  const [dailyAttempts, setDailyAttempts] = useState(String(policy?.daily_attempt_limit || 2));
  const [paymentConsentAccepted, setPaymentConsentAccepted] = useState(false);
  const [autoConsentAccepted, setAutoConsentAccepted] = useState(false);
  const [manualAmount, setManualAmount] = useState('300');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const billingIntent = useRef(null), billingLocked = useRef(false), billingAlive = useRef(false);
  useEffect(()=>{billingAlive.current=true;return()=>{billingAlive.current=false;};},[]);
  const [billingView, setBillingView] = useState(() => window.location.pathname.match(/\/billing\/(usage|invoices|activity|settings|profile)(?:\/|$)/)?.[1] || 'overview');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [selectedActivity, setSelectedActivity] = useState(null);

  useEffect(() => {
    setThreshold(String(policy?.threshold_minor || 300));
    setTopUpAmount(String(policy?.top_up_amount_minor || 300));
    setDailyAmount(String(policy?.daily_amount_limit_minor || 1000));
    setDailyAttempts(String(policy?.daily_attempt_limit || 2));
  }, [policy?.version]);

  function selectBillingView(view) {
    const base = window.location.pathname.replace(/\/billing(?:\/.*)?$/, '/billing');
    const canonical = billingSubpaths[view] || billingSubpaths.overview;
    const suffix = canonical.slice('/console/billing'.length);
    window.history.pushState({}, '', base + suffix);
    setBillingView(view);
  }

  function openBillingInvoice(invoice) {
    const base = window.location.pathname.replace(/\/billing(?:\/.*)?$/, '/billing');
    window.history.pushState({}, '', `${base}/invoices/${encodeURIComponent(invoice.id)}`);
    setBillingView('invoices');
    setSelectedInvoice(invoice);
  }

  function openBillingActivity(activity) {
    const base = window.location.pathname.replace(/\/billing(?:\/.*)?$/, '/billing');
    window.history.pushState({}, '', `${base}/activity/${encodeURIComponent(activity.id)}`);
    setBillingView('activity');
    setSelectedActivity(activity);
  }

  useEffect(() => {
    const invoiceID = window.location.pathname.match(/\/billing\/invoices\/([^/]+)$/)?.[1];
    const activityID = window.location.pathname.match(/\/billing\/activity\/([^/]+)$/)?.[1];
    if (invoiceID && invoices.length) setSelectedInvoice(invoices.find((invoice) => invoice.id === decodeURIComponent(invoiceID)) || null);
    if (activityID && activities.length) setSelectedActivity(activities.find((activity) => activity.id === decodeURIComponent(activityID)) || null);
  }, [data?.invoices, data?.activity]);

  async function mutate(method, path, body, headers = {}) {
    if (billingLocked.current) return null;
    billingLocked.current = true; setBusy(true); setMessage('');
    const scoped = billingAPI(cloudId, path);
    const next = cloudWriteIntent(billingIntent.current, method, scoped, body); billingIntent.current=next;
    try {
      const response = await fetch(scoped, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers, 'Idempotency-Key':next.key, 'X-Cloud-Ownership-Version':billingScope.version },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!billingAlive.current) return null;
      if ([401,403,404,409].includes(response.status)) { billingScope.onAccessLost(); return null; }
      if (!response.ok) {
        const error = new Error(result.message || 'billing request failed');
        error.code = result.code;
        throw error;
      }
      setMessage(response.status === 202 ? 'Request accepted for processing. Check its current payment status; acceptance is not a successful charge.' : 'The server accepted the update. Refresh to read the current state.');
      billingIntent.current=null;
      if (!result.payment_action && !result.hosted_url) onRefresh();
      return result;
    } catch (error) {
      if (billingAlive.current) setMessage(billingErrorMessage(error));
      return null;
    } finally {
      billingLocked.current=false; if (billingAlive.current) setBusy(false);
    }
  }

  function savePolicy(event) {
    event.preventDefault();
    if (!activeMethod || !chargeQualified || !autoConsentAccepted) {
      setMessage(billingErrorMessage({ code: 'PAYMENT_CAPABILITY_UNSUPPORTED' }));
      return;
    }
    if (![threshold,topUpAmount,dailyAttempts,dailyAmount].every(value=>value.trim()!=='' && Number.isSafeInteger(Number(value)) && Number(value)>0)) {
      setMessage(billingErrorMessage({code:'PAYMENT_AMOUNT_INVALID'})); return;
    }
    mutate('PUT', '/api/billing/auto-topup', {
      enabled: true,
      threshold_minor: Number(threshold),
      top_up_amount_minor: Number(topUpAmount),
      currency: account?.currency || 'TWD',
      payment_method_id: activeMethod.id,
      daily_attempt_limit: Number(dailyAttempts),
      daily_amount_limit_minor: Number(dailyAmount),
      cooldown_seconds: policy?.cooldown_seconds || 3600,
      consent: AUTO_TOPUP_CONSENT,
    }, { 'If-Match': data?.policyEtag || '"0"' });
  }

  async function createManualTopUp(event) {
    event.preventDefault();
    const amount = Number(manualAmount);
    if (!Number.isSafeInteger(amount) || amount < 1) {
      setMessage(billingErrorMessage({ code: 'PAYMENT_AMOUNT_INVALID' }));
      return;
    }
    const idempotency = crypto.randomUUID();
    if (hostedChargeProvider) {
      const result = await mutate('POST', '/api/billing/topups/checkout', {
        amount_minor: amount,
        currency: account?.currency || 'TWD',
        provider: hostedChargeProvider.name,
      }, { 'Idempotency-Key': idempotency });
      const action = result?.payment_action;
      if (action?.method === 'POST' && action.url && action.fields) {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = action.url;
        for (const [name, value] of Object.entries(action.fields)) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = name;
          input.value = String(value);
          form.append(input);
        }
        document.body.append(form);
        form.submit();
      }
      return;
    }
    if (!activeMethod || !chargeQualified) {
      setMessage(billingErrorMessage({ code: 'PAYMENT_CAPABILITY_UNSUPPORTED' }));
      return;
    }
    await mutate('POST', '/api/billing/topups', { amount_minor: amount, currency: account?.currency || 'TWD', payment_method_id: activeMethod.id }, { 'Idempotency-Key': idempotency });
  }

  async function setupPaymentMethod() {
    if (!setupProvider) {
      setMessage(billingErrorMessage({ code: 'PAYMENT_PROVIDER_NOT_CONFIGURED' }));
      return;
    }
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    const result = await mutate('POST', '/api/billing/payment-methods/setup', {
      provider: setupProvider.name,
      consent: PAYMENT_METHOD_CONSENT,
    }, { 'Idempotency-Key': `payment-setup-${Date.now()}` });
    if (result?.hosted_url) {
      if (popup) popup.location.replace(result.hosted_url);
      else window.location.assign(result.hosted_url);
    } else if (popup) {
      popup.close();
    }
  }

  if (loading && !data) return <section className="panel split-panel"><div><h2>Loading billing information</h2><p>Read only the secure account summary of the current active Brand Cloud.</p></div></section>;
  if (data?.source_status === 'unavailable') return <section className="panel split-panel"><div><h2>Billing information temporarily unavailable</h2><p>{data.source_message}</p></div></section>;

  const billingTabs = <nav className="billing-tabs" aria-label="Billing Pages">
    {[['overview', 'Billing Overview'], ['usage', 'Usage and Forecast'], ['invoices', 'Invoices'], ['activity', 'Billing Activity'], ['settings', 'Payments and Automatic Top-Up'], ['profile', 'Billing Profile']].map(([id, label]) => <button key={id} type="button" className={billingView === id ? 'active' : ''} onClick={() => selectBillingView(id)}>{label}</button>)}
  </nav>;

  if (selectedInvoice) return <BillingInvoiceDetail invoice={selectedInvoice} onBack={() => { setSelectedInvoice(null); selectBillingView('invoices'); }} />;
  if (selectedActivity) return <BillingActivityDetail activity={selectedActivity} onBack={() => { setSelectedActivity(null); selectBillingView('activity'); }} />;

  if (billingView === 'overview') return <section className="page-content billing-page" data-testid="billing-page">
    <div className="page-intro"><div><p className="eyebrow">Commercial Settlement</p><h2>Billing overview</h2><p>Keep track of available balances, estimated charges for the month, invoices, and recent billing changes.</p></div><small>Updated {formatProviderTimestamp(summary.calculated_at || account?.updated_at)}</small></div>
    {billingTabs}
    <details className="ui-settings-advanced" data-testid="managed-cloud-plan"><summary>Service plan and deployment options</summary><section className="managed-cloud-plan">
      <div className="managed-cloud-plan-main">
        <span className="managed-cloud-plan-badge">Recommended plan</span>
        <div>
          <p className="eyebrow">Realtek Managed Cloud</p>
          <h3>Hosted and operated by Realtek. Pay only for what you use.</h3>
          <p>Realtek manages cloud deployment, hosting, maintenance, and platform operations. Customers pay for actual service usage. Official rates and pricing units will be confirmed separately; this page does not represent a price commitment.</p>
        </div>
        <div className="inline-actions">
          <button type="button" className="primary" onClick={() => selectBillingView('usage')}>View This Month’s Usage and Costs</button>
          <button type="button" className="ghost-button" onClick={() => selectBillingView('invoices')}>View Invoice</button>
          <button type="button" className="ghost-button" onClick={() => selectBillingView('settings')}>Payment Settings</button>
        </div>
      </div>
      <aside className="managed-cloud-private-option">
        <span><Icon name="cloud" /></span>
        <div><strong>Need Private Cloud?</strong><p>If you need a customer’s own infrastructure, data location, or governance boundaries, contact Realtek for a dedicated deployment plan.</p></div>
      </aside>
    </section></details>
    <div className="metric-grid billing-overview-metrics">
      <MetricCard icon="wallet" label="Available Balance" value={formatMinorAmount(account?.available_balance_minor, account?.currency)} hint={summary.runway?.state === 'available' ? `Estimated availability ${summary.runway.projected_days} days` : 'Insufficient usage to estimate available days'} tone="info" />
      <MetricCard icon="chart-column" label="Estimated Cost This Month" value={formatMinorAmount(usage.total_minor, usage.currency || account?.currency)} hint={`From ${formatProviderTimestamp(usage.period_start)} · Estimate`} tone="neutral" />
      <MetricCard icon="chart-line" label="End-of-Month Forecast" value={summary.forecast?.state === 'available' ? formatMinorAmount(summary.forecast.projected_period_total_minor, usage.currency || account?.currency) : 'Insufficient data'} hint={summary.forecast?.state === 'available' ? `${summary.forecast.confidence === 'medium' ? 'Medium' : 'Low'} confidence · ${summary.forecast.observation_days} observation days` : 'Available after at least one complete observation day'} tone="neutral" />
      <MetricCard icon="credit-card" label="Payment method" value={paymentMethodLabel(activeMethod)} hint={activeMethod ? 'Status is OK' : 'No payment method set'} tone={activeMethod?.status === 'active' ? 'good' : 'warning'} />
    </div>
    <div className="billing-overview-grid">
      <section className="panel billing-auto-card"><div className="panel-head"><div><h3>Automatic Top-Up · {policy?.enabled ? 'Enabled' : 'Disabled'}</h3><p>{policy ? `Top up ${formatMinorAmount(policy.top_up_amount_minor, policy.currency)} when the balance falls below ${formatMinorAmount(policy.threshold_minor, policy.currency)}.` : 'Set a threshold and payment method to enable automatic top-up.'}</p></div><span className={`status-badge ${policyState.tone}`}>{policyState.label}</span></div>{policy?.last_succeeded_at ? <p>Last top-up: {formatProviderTimestamp(policy.last_succeeded_at)}</p> : null}<button type="button" className="ghost-button" onClick={() => selectBillingView('settings')}>Manage Automatic Top-Up</button></section>
      <section className="panel billing-usage-card" id="billing-usage"><div className="panel-head"><div><h3>Estimated Cost by Service Category</h3><p>Once the pricing version is locked, the settlement result becomes an immutable invoice.</p></div></div><div className="billing-breakdown">{(usage.lines || []).map((line) => <div key={`${line.service_code}-${line.metric_code}`}><span><strong>{String(line.service_code || '').toUpperCase()}</strong><small>{line.description}</small></span><b>{formatMinorAmount(line.total_minor, usage.currency)}</b></div>)}</div><div className="billing-total"><span>Total</span><strong>{formatMinorAmount(usage.total_minor, usage.currency)}</strong></div></section>
    </div>
    <div className="billing-overview-grid lower">
      <section className="panel"><div className="panel-head"><div><h3>View Invoice</h3><p>Invoiced and immutable PDF documents.</p></div><button type="button" className="link-button" onClick={() => selectBillingView('invoices')}>All invoices</button></div><BillingInvoiceTable invoices={invoices.slice(0, 3)} onSelect={openBillingInvoice} /></section>
      <section className="panel"><div className="panel-head"><div><h3>Recent Billing Activity</h3><p>Top-ups, invoice charges, and statuses to be processed.</p></div><button type="button" className="link-button" onClick={() => selectBillingView('activity')}>All Events</button></div><BillingActivityTable activities={activities.slice(0, 4)} onSelect={openBillingActivity} /></section>
    </div>
  </section>;

  if (billingView === 'usage') return <section className="page-content billing-page" data-testid="billing-usage-page">
    <div className="page-intro"><div><h2>Usage and Forecast</h2><p>The Billing server estimates costs using the applicable pricing version. The end-of-month forecast is not a final invoice.</p></div><small>Data through {formatProviderTimestamp(usage.usage_through)}</small></div>
    {billingTabs}
    <div className="metric-grid billing-overview-metrics">
      <MetricCard icon="chart-column" label="Month to Date" value={formatMinorAmount(usage.total_minor, usage.currency)} hint={`${formatNumber(usage.fact_count || 0)} usage records`} tone="info" />
      <MetricCard icon="chart-line" label="End-of-Month Forecast" value={summary.forecast?.state === 'available' ? formatMinorAmount(summary.forecast.projected_period_total_minor, usage.currency) : 'Insufficient data'} hint={summary.forecast?.state === 'available' ? `Approximately ${formatMinorAmount(summary.forecast.projected_remaining_minor, usage.currency)} remaining · ${summary.forecast.confidence === 'medium' ? 'Medium' : 'Low'} confidence` : 'At least one complete observation day is required'} tone="neutral" />
      <MetricCard icon="wallet" label="Balance Runway" value={summary.runway?.state === 'available' ? `${summary.runway.projected_days} days` : 'Insufficient data'} hint={summary.runway?.state === 'available' ? `Average daily cost ${formatMinorAmount(summary.runway.average_daily_cost_minor, usage.currency)}` : 'Cannot be estimated yet'} tone="neutral" />
    </div>
    <section className="panel billing-usage-card"><div className="panel-head"><div><h3>Cost This Month by Service Category</h3><p>{formatProviderTimestamp(usage.period_start)} – {formatProviderTimestamp(usage.period_end)}</p></div></div><div className="billing-breakdown">{(usage.lines || []).map((line) => <div key={`${line.service_code}-${line.metric_code}`}><span><strong>{String(line.service_code || '').toUpperCase()}</strong><small>{line.description} · {line.quantity} {line.unit}</small></span><b>{formatMinorAmount(line.total_minor, usage.currency)}</b></div>)}</div><div className="billing-total"><span>Month to Date</span><strong>{formatMinorAmount(usage.total_minor, usage.currency)}</strong></div></section>
  </section>;

  if (billingView === 'invoices') return <section className="page-content billing-page" data-testid="billing-invoices-page"><div className="page-intro"><div><h2>Invoice</h2><p>Check the billing period, amount, payment status, and download PDF.</p></div><a className="ghost-button" href={billingAPI(cloudId, '/api/billing/statements')}>Export statement</a></div>{billingTabs}<section className="panel"><BillingInvoiceTable invoices={invoices} onSelect={openBillingInvoice} /></section></section>;
  if (billingView === 'activity') return <section className="page-content billing-page" data-testid="billing-activity-page"><div className="page-intro"><div><h2>Billing Activity</h2><p>Track top-ups, invoice charges, retries, and reconciliations with consistent status.</p></div></div>{billingTabs}<section className="panel"><BillingActivityTable activities={activities} onSelect={openBillingActivity} /></section></section>;
  if (billingView === 'profile') return <BillingProfilePage profile={billingProfile} tabs={billingTabs} canManage={capabilities.includes('billing_profile.manage')} onRefresh={onRefresh} />;

  return <section className="page-content billing-page" data-testid="billing-page">
    <div className="page-intro"><div><p className="eyebrow">Commercial Settlement</p><h2>Payments and Automatic Top-Up</h2><p>A top-up intent is created only when the balance falls strictly below the threshold. The backend validates the amount, attempt limits, cooldown, and consent.</p></div></div>
    {billingTabs}
    <div className="metric-grid billing-metrics">
      <MetricCard icon="wallet" label="Available Balance" value={formatMinorAmount(account?.available_balance_minor, account?.currency)} hint={`Account ${account?.state || 'unavailable'} · Last updated ${formatProviderTimestamp(account?.updated_at)}`} tone="info" />
      <MetricCard icon="arrows-rotate" label="Automatic Top-Up" value={policyState.label} hint={policyState.detail} tone={policyState.tone} />
      <MetricCard icon="credit-card" label="Payment method" value={paymentMethodLabel(activeMethod)} hint={activeMethod ? `Status: ${activeMethod.status}` : 'Don’t enter a card number or CVV on this page'} tone={activeMethod?.status === 'active' ? 'good' : 'neutral'} />
      <MetricCard icon="clock-rotate-left" label="Recent Intents" value={String(intents.length)} hint="Includes succeeded, failed, reconciliation-pending, and processing states" tone="neutral" />
    </div>

    <section className="panel billing-safety" data-testid="billing-provider-gate"><div className="panel-head"><div><h3>Payment Service Eligibility Status</h3><p>{setupProvider?.environment === 'simulated' ? 'Currently using staging virtual cash flow; no real charge will be generated.' : 'Verified hosted payment setup is not currently available.'}</p></div><span className={`status-badge ${setupProvider ? 'good' : 'warning'}`}>{setupProvider ? 'READY' : 'BLOCKED'}</span></div><p>Payment information is only processed on the provider hosted page; RTK Cloud does not receive card numbers or CVVs.</p><label className="billing-consent"><input type="checkbox" checked={paymentConsentAccepted} onChange={(event) => setPaymentConsentAccepted(event.target.checked)} />{PAYMENT_METHOD_CONSENT_TEXT}</label><button type="button" className="primary" disabled={busy || !canManageMethods || !setupProvider || !paymentConsentAccepted} onClick={setupPaymentMethod}>{busy ? 'Preparing…' : 'Add payment method'}</button></section>

    <div className="billing-columns">
      <section className="panel"><div className="panel-head"><div><h3>Automatic top-up policy</h3><p>Daily limits use {policy?.limit_timezone || 'Asia/Taipei'}. Next reset: {policy?.limit_reset_at ? formatProviderTimestamp(policy.limit_reset_at) : '—'}</p></div><span className={`status-badge ${policyState.tone}`}>{policyState.label}</span></div>
        <form className="billing-policy-form" onSubmit={savePolicy}>
          <label>Low Balance Threshold (TWD)<input type="number" min="1" step="1" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>
          <label>Top-up amount (TWD)<input type="number" min="1" step="1" value={topUpAmount} onChange={(event) => setTopUpAmount(event.target.value)} /></label>
          <label>Maximum Daily Value (TWD)<input type="number" min="1" step="1" value={dailyAmount} onChange={(event) => setDailyAmount(event.target.value)} /></label>
          <label>Maximum daily charges<input type="number" min="1" max="10" step="1" value={dailyAttempts} onChange={(event) => setDailyAttempts(event.target.value)} /></label>
          <label className="billing-consent"><input type="checkbox" checked={autoConsentAccepted} onChange={(event) => setAutoConsentAccepted(event.target.checked)} />{AUTO_TOPUP_CONSENT_TEXT}</label>
          <div className="inline-actions"><button type="submit" className="primary" disabled={busy || !canManagePolicy || !chargeQualified || !autoConsentAccepted}>{busy ? 'Updating…' : 'Save and Enable'}</button>{policy?.enabled ? <button type="button" className="ghost-button" disabled={busy || !canManagePolicy} onClick={() => mutate('DELETE', '/api/billing/auto-topup', { reason: 'customer disabled automatic top-up' }, { 'If-Match': data?.policyEtag || `"${policy.version}"` })}>Disable Automatic Top-Up</button> : null}</div>
        </form>
        {!chargeQualified ? <p className="notice">The payment method does not yet have merchant-initiated charge capability; the save button remains disabled and no charge will be submitted.</p> : null}
        {message ? <p className="notice" role="status">{message}</p> : null}
      </section>

      <section className="panel"><div className="panel-head"><div><h3>Payment Methods</h3><p>Only safe metadata such as provider, brand, last four digits, and expiration month is stored.</p></div></div>{methods.length ? <div className="payment-method-list">{methods.map((method) => <div className="payment-method-card" key={method.id}><div><strong>{paymentMethodLabel(method)}</strong><small>{method.provider} · {method.expiry_month && method.expiry_year ? `${String(method.expiry_month).padStart(2, '0')}/${method.expiry_year}` : 'Expiration date not provided'}</small></div><span className={`status-badge ${method.status === 'active' ? 'good' : 'neutral'}`}>{method.status}</span>{canManageMethods && method.status === 'active' ? <button type="button" className="link-button" disabled={busy} onClick={() => mutate('DELETE', `/api/billing/payment-methods/${encodeURIComponent(method.id)}`, { reason: 'customer revoked payment method' })}>Revoke</button> : null}</div>)}</div> : <p className="empty-state">No verified payment methods are available.</p>}
        <form className="inline-form" onSubmit={createManualTopUp}><label>Manual Top-Up Amount (TWD)<input type="number" min="1" step="1" value={manualAmount} onChange={(event) => setManualAmount(event.target.value)} /></label><button type="submit" className="ghost-button" disabled={busy || (!hostedChargeProvider && (!activeMethod || !chargeQualified)) || !capabilities.includes('payment_intent.create')}>{hostedChargeProvider ? 'Continue to Card Top-Up' : 'Top Up Now'}</button></form>
      </section>
    </div>

    <section className="panel"><div className="panel-head"><div><h3>Payment Intents</h3><p>Normalized states are shown for customer tracking. Provider transaction references and payloads are not displayed.</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Created</th><th>Reason</th><th>Amount</th><th>Status</th></tr></thead><tbody>{intents.map((intent) => { const state = paymentIntentState(intent.state); return <tr key={intent.id}><td>{formatProviderTimestamp(intent.created_at)}</td><td>{intent.reason === 'auto_top_up' ? 'Automatic Top-Up' : 'Manual Top-Up'}</td><td>{formatMinorAmount(intent.amount_minor, intent.currency)}</td><td><span className={`status-badge ${state.tone}`}>{state.label}</span></td></tr>; })}</tbody></table>{!intents.length ? <p className="empty-state">No payment intents are available.</p> : null}</div></section>

    <section className="panel"><div className="panel-head"><div><h3>Balance changes</h3><p>Non-overwritable ledger, only customer safety fields are displayed.</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Time</th><th>Reason</th><th>Transfers</th><th>Balance after change</th></tr></thead><tbody>{ledger.map((entry) => <tr key={entry.id}><td>{formatProviderTimestamp(entry.created_at)}</td><td>{entry.reason}</td><td>{entry.direction === 'debit' ? '−' : '+'}{formatMinorAmount(entry.amount_minor, entry.currency)}</td><td>{formatMinorAmount(entry.balance_after_minor, entry.currency)}</td></tr>)}</tbody></table>{!ledger.length ? <p className="empty-state">There are currently no balance changes.</p> : null}</div></section>
  </section>;
}

function BillingInvoiceTable({ invoices, onSelect }) {
  const {cloudId,version,onAccessLost} = React.useContext(BillingScope);
  if (!invoices.length) return <p className="empty-state">There are currently no invoices.</p>;
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Invoice number</th><th>Billing period</th><th>Amount</th><th>Status</th><th>File</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td><button type="button" className="link-button" onClick={() => onSelect(invoice)}>{invoice.invoice_number}</button></td><td>{formatProviderTimestamp(invoice.period_start)} – {formatProviderTimestamp(invoice.period_end)}</td><td>{formatMinorAmount(invoice.total_minor, invoice.currency)}</td><td><span className={`status-badge ${invoice.state === 'settled' ? 'good' : 'warning'}`}>{invoice.state === 'settled' ? 'Paid' : invoice.state}</span></td><td>{invoice.document ? <a className="icon-download" aria-label={`Download ${invoice.invoice_number} PDF`} href={billingAPI(cloudId, `/api/billing/invoices/${encodeURIComponent(invoice.id)}/pdf`)}><i className="fa-solid fa-download" /></a> : '—'}</td></tr>)}</tbody></table></div>;
}

function BillingActivityTable({ activities, onSelect }) {
  if (!activities.length) return <p className="empty-state">There is currently no billing activity.</p>;
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Time</th><th>Type</th><th>Reference</th><th>Amount</th><th>Status</th></tr></thead><tbody>{activities.map((activity) => <tr key={activity.id}><td>{formatProviderTimestamp(activity.occurred_at)}</td><td>{activity.type === 'invoice' ? 'Invoice' : activity.type === 'auto_top_up' ? 'Automatic Top-Up' : activity.type}</td><td><button type="button" className="link-button" onClick={() => onSelect(activity)}>{activity.customer_reference}</button></td><td className={activity.balance_effect === 'credit' ? 'money-credit' : ''}>{activity.balance_effect === 'credit' ? '+' : '−'}{formatMinorAmount(activity.amount_minor, activity.currency)}</td><td><span className={`status-badge ${activity.state === 'completed' ? 'good' : activity.state === 'failed' ? 'danger' : 'warning'}`}>{activity.state === 'completed' ? 'Succeeded' : activity.state}</span></td></tr>)}</tbody></table></div>;
}

function BillingInvoiceDetail({ invoice, onBack }) {
  const {cloudId,version,onAccessLost} = React.useContext(BillingScope);
  return <section className="page-content billing-page" data-testid="billing-invoice-detail"><button type="button" className="link-button billing-back" onClick={onBack}>← Back to invoices</button><div className="page-intro"><div><p className="eyebrow">Invoice</p><h2>{invoice.invoice_number}</h2><p>{formatProviderTimestamp(invoice.period_start)} – {formatProviderTimestamp(invoice.period_end)}</p></div><div className="inline-actions"><span className={`status-badge ${invoice.state === 'settled' ? 'good' : 'warning'}`}>{invoice.state === 'settled' ? 'Paid' : invoice.state}</span>{invoice.document ? <a className="primary button-link" href={billingAPI(cloudId, `/api/billing/invoices/${encodeURIComponent(invoice.id)}/pdf`)}>Download PDF</a> : null}</div></div><section className="panel invoice-paper"><div className="invoice-parties"><div><small>Billing recipient</small><strong>{invoice.recipient?.legal_name || '—'}</strong><span>{invoice.recipient?.tax_identifier || ''}</span><span>{invoice.recipient?.billing_address || ''}</span></div><div><small>Issue date</small><strong>{formatProviderTimestamp(invoice.issued_at)}</strong><small>Total</small><strong>{formatMinorAmount(invoice.total_minor, invoice.currency)}</strong></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Service</th><th>Description</th><th>Usage</th><th>Subtotal</th></tr></thead><tbody>{(invoice.lines || []).map((line) => <tr key={line.id}><td>{line.service_code}</td><td>{line.description}</td><td>{line.quantity} {line.unit}</td><td>{formatMinorAmount(line.total_minor, invoice.currency)}</td></tr>)}</tbody></table></div><div className="invoice-totals"><span>Subtotal {formatMinorAmount(invoice.subtotal_minor, invoice.currency)}</span><span>Tax {formatMinorAmount(invoice.tax_minor, invoice.currency)}</span><strong>Total {formatMinorAmount(invoice.total_minor, invoice.currency)}</strong></div><p className="notice">This invoice is settled from a prepaid balance; the payment-method top-up and invoice charge are separate accounting events.</p></section></section>;
}

function BillingActivityDetail({ activity, onBack }) {
  return <section className="page-content billing-page" data-testid="billing-activity-detail"><button type="button" className="link-button billing-back" onClick={onBack}>← Back to billing activity</button><div className="page-intro"><div><p className="eyebrow">Billing activity</p><h2>{activity.customer_reference}</h2><p>{activity.type === 'invoice' ? 'Invoice charge' : 'Automatic top-up'} · {formatMinorAmount(activity.amount_minor, activity.currency)}</p></div><span className={`status-badge ${activity.state === 'completed' ? 'good' : 'warning'}`}>{activity.state === 'completed' ? 'Completed' : activity.state}</span></div><section className="panel"><h3>Processing timeline</h3><ol className="billing-timeline">{(activity.steps?.length ? activity.steps : [{ kind: activity.type, state: activity.state, occurred_at: activity.occurred_at, customer_reference: activity.customer_reference }]).map((step, index) => <li key={`${step.kind}-${index}`}><i className="fa-solid fa-circle-check" /><div><strong>{step.kind}</strong><p>{step.state} · {formatProviderTimestamp(step.occurred_at)}</p><small>{step.customer_reference}</small></div></li>)}</ol></section></section>;
}

function BillingProfilePage({ profile, tabs, canManage, onRefresh }) {
  const {cloudId,version,onAccessLost} = React.useContext(BillingScope);
  const [form, setForm] = useState(profile);
  const [message, setMessage] = useState('');
  const profileLocked = useRef(false), profileAlive = useRef(false);
  useEffect(()=>{profileAlive.current=true;return()=>{profileAlive.current=false;};},[]);
  useEffect(() => setForm(profile), [profile.version]);
  async function submit(event) {
    event.preventDefault();
    if (profileLocked.current || !canManage) return;
    profileLocked.current=true;
    try {
    const response = await fetch(billingAPI(cloudId, '/api/billing/profile'), { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': `"${form.version}"`, 'X-Cloud-Ownership-Version':version }, body: JSON.stringify(Object.fromEntries(['legal_name','tax_identifier','billing_address','contact_email','locale','timezone','delivery_preference','version'].filter(key=>form[key]!==undefined).map(key=>[key,form[key]]))) });
    if (!profileAlive.current) return;
    if ([401,403,404,409].includes(response.status)) { onAccessLost(); return; }
    setMessage(response.ok ? 'Billing information has been updated; existing invoice snapshots will not be overwritten.' : 'Failed to update billing information, please refresh and try again.');
    if (response.ok) onRefresh();
    } catch (_) { if (profileAlive.current) setMessage('Update status is unknown. Refresh before retrying; no successful update has been confirmed.'); }
    finally { profileLocked.current=false; }
  }
  return <section className="page-content billing-page" data-testid="billing-profile-page"><div className="page-intro"><div><h2>Billing information</h2><p>Each new invoice saves the current recipient details. Later changes do not overwrite existing invoice snapshots.</p></div></div>{tabs}<section className="panel"><form className="billing-profile-form" onSubmit={submit}><label>Company or legal name<input value={form.legal_name || ''} onChange={(event) => setForm({ ...form, legal_name: event.target.value })} required /></label><label>VAT number<input value={form.tax_identifier || ''} onChange={(event) => setForm({ ...form, tax_identifier: event.target.value })} /></label><label>Billing email<input type="email" value={form.contact_email || ''} onChange={(event) => setForm({ ...form, contact_email: event.target.value })} /></label><label className="wide">Billing address<textarea value={form.billing_address || ''} onChange={(event) => setForm({ ...form, billing_address: event.target.value })} /></label><label>Locale<input value={form.locale || 'en-US'} onChange={(event) => setForm({ ...form, locale: event.target.value })} /></label><label>Billing timezone<input value={form.timezone || 'Asia/Taipei'} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /></label><label>Delivery method<select value={form.delivery_preference || 'portal'} onChange={(event) => setForm({ ...form, delivery_preference: event.target.value })}><option value="portal">Portal</option><option value="portal_and_email">Portal + Email</option></select></label><div className="wide"><button type="submit" className="primary" disabled={!canManage}>Save billing information</button>{message ? <p className="notice" role="status">{message}</p> : null}</div></form></section></section>;
}
function PKITestBundleTool({ activeCloudId, products = [], productsLoading, productsUnavailable }) {
  const [quantity, setQuantity] = useState(1);
  const [profileId, setProfileId] = useState(() => products[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const availableProducts = products.filter((product) => product.status === 'active');
  const selectedProductAvailable = availableProducts.some((product) => product.id === profileId);
  const productBlocked = productsLoading || productsUnavailable || !selectedProductAvailable;
  useEffect(() => {
    if (!products.some((product) => product.id === profileId && product.status === 'active')) {
      setProfileId(products.find((product) => product.status === 'active')?.id || '');
    }
  }, [products, profileId]);
  async function issue(event) {
    event.preventDefault();
    if (busy || productBlocked) return;
    setBusy(true); setMessage('Creating test devices and credentials on the server…');
    try {
      const endpoint = '/api/developer/test-device-batches';
      const requestBody = { brand_cloud_id: activeCloudId, device_item_profile_id: profileId, quantity: Number(quantity) };
      const response = await fetch(endpoint, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(requestBody) });
      if (!response.ok) throw new Error('certificate issuance failed');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = blob.type.includes('json') ? 'rtk-test-device.json' : 'rtk-test-devices.zip'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage('Your test-device download has started. It contains server-generated private keys; keep it secure.');
    } catch (_) { setMessage('The test bundle could not be created. Please try again.'); }
    finally { setBusy(false); }
  }
  return <section className="panel">
    <div className="panel-head"><div><h3 className="test-device-icon-text"><Icon name="microchip" />Test Devices</h3><p>Select a Product and quantity. Device IDs, private keys, and certificates are generated automatically.</p></div></div>
    <form className="inline-form pki-test-form" onSubmit={issue}>
        <label><span className="test-device-icon-text"><Icon name="cube" />Product</span><select className="select-control" required aria-describedby="test-device-product-help" disabled={productsLoading || productsUnavailable || !availableProducts.length} value={selectedProductAvailable ? profileId : ''} onChange={(event) => setProfileId(event.target.value)}>
          <option value="" disabled>{productsLoading ? 'Loading products…' : productsUnavailable ? 'Products unavailable' : !availableProducts.length ? 'No active products available' : 'Select a product'}</option>
          {availableProducts.map((product) => <option key={product.id} value={product.id}>{product.display_name || product.name || product.profile_key || product.id}</option>)}
        </select></label>
        <label><span className="test-device-icon-text"><Icon name="hashtag" />Quantity</span><input type="number" min="1" max="10" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
      <button type="submit" className="primary-button test-device-icon-text" disabled={busy || productBlocked}><Icon name={busy ? 'hourglass-half' : 'plus'} />{busy ? 'Creating…' : 'Create test devices'}</button>
    </form>
    <div className="test-device-product-help">
      <p className="test-device-icon-text"><Icon name="download" /><strong>Your download</strong></p>
      <p><strong>Download once, when created.</strong> Save your files immediately. To reduce private-key exposure, this page does not retain a copy for later download. If you lose the files, create new test devices: they receive new Device IDs, private keys, and certificates, not replacements for the lost credentials.</p>
      <p><Icon name="clock" /> <strong>Certificates are valid for 30 days from issuance.</strong> This limits how long leaked credentials or forgotten test devices can be used. After expiry, the certificate cannot authenticate new connections; create a new test device to continue testing. Creating another device does not revoke the old certificate or extend its expiry.</p>
      <p>Includes each device's identity, certificate, and server-generated private key. The Device ID identifies the device in the cloud and is also recorded in its certificate; you do not need to assign an ID yourself.</p>
      <details><summary><Icon name="file-zipper" /> Files and next steps</summary>
        <ul>
          <li><strong>One device:</strong> <code>rtk-test-device.json</code>, a certificate bundle containing the device identity, certificate chain, and private key.</li>
          <li><strong>Multiple devices:</strong> <code>rtk-test-devices.zip</code>. Each successful device has a folder with <code>certificate-bundle.json</code>, <code>device.crt</code>, and <code>device.key</code>. <code>index.json</code> lists device results and any errors.</li>
        </ul>
        <p>Load the matching bundle into your test client, or configure it with the device certificate and private key. Use the Device ID to find the device in the console and correlate requests or logs. Complete any required device claim and account binding separately; downloading credentials does not mean the device is online.</p>
        <p>For this version, use the certificate chain in the JSON bundle; separate CA-chain files, connection-configuration files, and a README are not included. The CSR is not included.</p>
      </details>
      <p><Icon name="key" /> The download contains private keys. Keep it secure and do not share it in source control, logs, or support screenshots.</p>
    </div>
    <div id="test-device-product-help" className="test-device-product-help">
      <p className="test-device-icon-text"><Icon name="circle-info" /><strong>Why a Product?</strong></p>
      <p>A Product is a shared configuration for a device model, not an individual device. It groups the model and cloud services so you can create multiple test devices with the same settings instead of configuring each one separately.</p>
      <p>For example, create a Product for your camera model and select its services, then request several test devices for it. They share the Product configuration, but each receives its own Device ID, private key, and certificate. No mass-production run is required.</p>
      {productsLoading ? <p role="status">Loading products for this Brand Cloud…</p> : productsUnavailable ? <p role="status">Products could not be loaded. Refresh this page to try again.</p> : !availableProducts.length ? <div role="status">
        <div className="test-device-empty-action"><span><Icon name="cube" /> No active products yet. Create a Product to get started.</span><a className="ghost-button settings-action" href={`/console/${encodeURIComponent(activeCloudId)}/product-services`}><Icon name="cube" />Open Products and Services<Icon name="arrow-right" /></a></div>
        <details><summary><Icon name="list-check" /> How to create a Product</summary>
        <ol><li>Open Products and Services and select Add Product.</li><li>Enter the product details, choose its cloud services, and save.</li><li>Return to Brand Cloud Home → Settings → Test Devices, then choose your Product and quantity.</li></ol>
        <p>If Add Product is unavailable, ask your Brand Cloud owner or administrator to create a Product or grant the required access.</p>
        </details>
      </div> : null}
    </div>
    {message ? <p className="notice" role="status">{message}</p> : null}
  </section>;
}

function ReportsPage({ data, products, loading, canCreate, onRefresh }) {
  const reports = data?.reports || [];
  const [name, setName] = useState('Device Status Report');
  const [reportType, setReportType] = useState('fleet_status');
  const [format, setFormat] = useState('json');
  const [timezone, setTimezone] = useState('Asia/Taipei');
  const [dimensions, setDimensions] = useState(['product', 'model', 'status', 'region']);
  const [filters, setFilters] = useState({ product_id: '', region: '', group_id: '', firmware: '', status: '', start_at: '', end_at: '' });
  const [message, setMessage] = useState('');
  const reportURL = (id, format = '') => scopedCustomerAPI(`/api/reports/${encodeURIComponent(id)}${format ? `?format=${format}` : ''}`, cloudIdFromPath(window.location.pathname));
  const toggleDimension = (dimension) => setDimensions((current) => current.includes(dimension) ? current.filter((item) => item !== dimension) : [...current, dimension]);
  async function createReport(event) {
    event.preventDefault();
    const scope = Object.fromEntries(Object.entries(filters).filter(([, value]) => value.trim()));
    const payload = { name, report_type: reportType, dimensions, timezone, time_range: { start_at: filters.start_at, end_at: filters.end_at }, format, scope };
    const response = await fetch(scopedCustomerAPI('/api/reports', cloudIdFromPath(window.location.pathname)), { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `report-${JSON.stringify(payload)}` }, body: JSON.stringify(payload) });
    setMessage(response.ok ? 'The report has been created and you will see the results when you are done.' : 'Report cannot be created at this time.');
    if (response.ok) { onRefresh(); }
  }
    return <section className="page-content">
    <div className="page-intro"><div><p className="eyebrow">Fleet Insights</p><h2>Reports</h2><p>Organize operational results by product, region, group, firmware, and timeframe.</p></div></div>
    {!canCreate ? <section className="panel split-panel"><div><h3>You currently do not have reports.create permission</h3><p>Existing reports can be viewed, but new reports cannot be created.</p></div></section> : <section className="panel report-builder-panel"><form className="report-builder" onSubmit={createReport}>
      <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Report Name" />
      <select className="select-control" aria-label="Report Type" value={reportType} onChange={(event) => setReportType(event.target.value)}><option value="fleet_status">Device Status</option><option value="firmware_coverage">Firmware Coverage</option></select>
      <select className="select-control" aria-label="Output Format" value={format} onChange={(event) => setFormat(event.target.value)}><option value="json">JSON</option><option value="csv">CSV</option></select>
      <select className="select-control" aria-label="Timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)}><option>Asia/Taipei</option><option>UTC</option><option>America/Los_Angeles</option></select>
      <select className="select-control" aria-label="Product Filter" value={filters.product_id} onChange={(event) => setFilters({ ...filters, product_id: event.target.value })}><option value="">All Products</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
      <select className="select-control" aria-label="Device Status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">All Statuses</option><option value="online">Online</option><option value="offline">Offline</option></select>
      <input placeholder="Area" value={filters.region} onChange={(event) => setFilters({ ...filters, region: event.target.value })} />
      <input placeholder="Group ID" value={filters.group_id} onChange={(event) => setFilters({ ...filters, group_id: event.target.value })} />
      <input placeholder="Firmware Version" value={filters.firmware} onChange={(event) => setFilters({ ...filters, firmware: event.target.value })} />
      <label className="report-date-field"><span>From</span><input type="date" aria-label="Report Start Date" value={filters.start_at} onChange={(event) => setFilters({ ...filters, start_at: event.target.value })} /></label>
      <label className="report-date-field"><span>To</span><input type="date" aria-label="Report End Date" value={filters.end_at} onChange={(event) => setFilters({ ...filters, end_at: event.target.value })} /></label>
      <fieldset className="dimension-picker"><legend>Dimensions</legend>{['product', 'model', 'region', 'group', 'firmware', 'status'].map((dimension) => <label key={dimension}><input type="checkbox" checked={dimensions.includes(dimension)} onChange={() => toggleDimension(dimension)} />{dimension}</label>)}</fieldset>
      <div className="report-builder-actions"><button type="submit" className="primary-button">Create Report</button></div>
    </form>{message ? <p className="notice">{message}</p> : null}</section>}
    {loading ? <section className="panel split-panel"><div><h3>Loading report</h3></div></section> : null}
        {!loading && data?.source_status === 'available' ? <section className="panel"><div className="table-wrap"><table className="data-table"><thead><tr><th>Report</th><th>Status</th><th>Scope / Freshness</th><th>Created By</th><th>Created</th><th>Results</th></tr></thead><tbody>{reports.map((report) => <tr key={report.id}><td><strong>{report.name}</strong><small>{report.id}</small></td><td>{batchJobStateLabel(report.state)}{report.failure_reason ? <small className="error-text">The report could not be completed. Please try again.</small> : null}</td><td><small>{report.scope?.scope_hash || '—'}</small><small>{report.result_metadata?.source_freshness || report.scope?.source_freshness || '—'} · expires {report.expires_at || '—'}</small></td><td>{report.created_by}</td><td>{formatRelativeTime(report.created_at)}</td><td><a href={reportURL(report.id)}>View Results</a>{report.state === 'completed' ? <> <a href={reportURL(report.id, 'csv')}>Download CSV</a> <a href={reportURL(report.id, 'json')}>Download JSON</a></> : null}</td></tr>)}</tbody></table>{!reports.length ? <p className="empty-state">No reports are available.</p> : null}</div></section> : null}
  </section>;
}

function batchJobStateLabel(state) {
  const labels = {
    queued: 'Pending',
    running: 'In Progress',
    completed: 'Completed',
    failed: 'Failed',
    partial_failed: 'Partially Completed',
    cancelled: 'Cancelled',
  };
  return labels[normalizeStatusKey(state)] || 'Unknown';
}

function FirmwareOTAPage({ loading, distribution, selectedProductId, products, releases, onViewDevices, onCampaignAction, onStatusRefresh, canRelease, canManageOTA, onSelectProduct, onRefresh }) {
  const versions = distribution?.versions || [];
  const campaigns = sortFirmwareCampaignsByStartTime(distribution?.campaigns || []);
  const selectedProduct = products.find((product) => product.id === selectedProductId) || null;
  const hasSelection = Boolean(selectedProductId && selectedProduct);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [releaseVersion, setReleaseVersion] = useState('');
  const [releaseHardware, setReleaseHardware] = useState('');
  const [releaseArtifact, setReleaseArtifact] = useState(null);
  const [releaseArtifactLoading, setReleaseArtifactLoading] = useState(false);
  const [releaseMessage, setReleaseMessage] = useState('');
  const releaseArtifactRequest = useRef(0);
  const releaseFileInput = useRef(null);
  const [planRelease, setPlanRelease] = useState('');
  const [planName, setPlanName] = useState('');
  const [planRate, setPlanRate] = useState(100);
  const [planMessage, setPlanMessage] = useState('');
  const [scopeQuery, setScopeQuery] = useState({ region: '', group_ids: '', firmware: '', health: '' });
  const [excludedDeviceText, setExcludedDeviceText] = useState('');
  const [scopePreview, setScopePreview] = useState(null);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const [campaignActionBusy, setCampaignActionBusy] = useState('');
  function selectProduct(event) {
    const productID = event.target.value;
    setSelectedCampaignId('');
    setPlanRelease('');
    setPlanMessage('');
    setScopePreview(null);
    setReleaseMessage('');
    onSelectProduct(productID);
  }

  useEffect(() => {
    if (!campaigns.length) {
      if (selectedCampaignId) setSelectedCampaignId('');
      return;
    }
    if (!campaigns.some((campaign) => campaign.campaign_id === selectedCampaignId)) {
      setSelectedCampaignId(campaigns[0].campaign_id);
    }
  }, [campaigns, selectedCampaignId]);

  const shouldPollStatus = campaigns.some(firmwareCampaignNeedsPolling);
  useEffect(() => {
    if (!hasSelection || !shouldPollStatus || !onStatusRefresh) return undefined;
    const timer = window.setInterval(() => { onStatusRefresh(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [hasSelection, onStatusRefresh, shouldPollStatus]);

  async function refreshStatus() {
    if (!hasSelection) return;
    setStatusRefreshing(true);
    await onStatusRefresh?.();
    setStatusRefreshing(false);
  }
  async function runCampaignAction(campaignId, action, payload = {}) {
    const key = `${campaignId}:${action}`;
    setCampaignActionBusy(key);
    try {
      return await onCampaignAction?.(campaignId, action, payload);
    } finally {
      setCampaignActionBusy('');
    }
  }
  async function selectReleaseArtifact(event) {
    const file = event.target.files?.[0] || null;
    const request = releaseArtifactRequest.current + 1;
    releaseArtifactRequest.current = request;
    setReleaseArtifact(null);
    setReleaseMessage('');
    if (!file) {
      setReleaseArtifactLoading(false);
      return;
    }
    setReleaseArtifactLoading(true);
    try {
      const metadata = await firmwareArtifactMetadata(file);
      if (releaseArtifactRequest.current === request) setReleaseArtifact(metadata);
    } catch {
      if (releaseArtifactRequest.current === request) setReleaseMessage('Firmware metadata could not be calculated. Please select a non-empty binary file.');
    } finally {
      if (releaseArtifactRequest.current === request) setReleaseArtifactLoading(false);
    }
  }
  async function publishRelease(event) {
    event.preventDefault();
    if (!selectedProductId || !releaseVersion.trim()) return;
    if (!releaseArtifact) {
      setReleaseMessage('Please select a firmware binary and wait for its metadata to be calculated.');
      return;
    }
    const response = await fetch(scopedCustomerAPI(`/api/products/${encodeURIComponent(selectedProductId)}/releases`, cloudIdFromPath(window.location.pathname)), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `release-${selectedProductId}-${releaseVersion.trim()}-${releaseArtifact.sha256.slice(0, 12)}` },
      body: JSON.stringify({ version: releaseVersion.trim(), build_number: releaseArtifact.buildNumber, artifact_size: releaseArtifact.size, artifact_sha256: releaseArtifact.sha256, hardware_revisions: releaseHardware.split(',').map((item) => item.trim()).filter(Boolean), content_type: releaseArtifact.contentType, anti_rollback_counter: 0 }),
    });
    if (response.ok) {
      const result = await response.json();
      if (result.upload?.url) {
        const upload = await fetch(result.upload.url, { method: 'PUT', body: releaseArtifact.file });
        if (!upload.ok) {
          setReleaseMessage('Version created, but file upload failed, please try again from the publishing process.');
          return;
        }
      }
    }
    setReleaseMessage(response.ok ? 'Firmware version created and binary uploaded.' : 'Firmware version cannot be created at this time.');
    if (response.ok) {
      setReleaseVersion('');
      setReleaseHardware('');
      setReleaseArtifact(null);
      if (releaseFileInput.current) releaseFileInput.current.value = '';
      onRefresh();
    }
  }
  async function createUpdatePlan(event) {
    event.preventDefault();
    const release = releases.find((item) => item.id === planRelease || item.release_id === planRelease);
    if (!release || !scopePreview?.scope) { setPlanMessage('Please get a valid server scope preview first.'); return; }
    const response = await fetch(scopedCustomerAPI('/api/update-plans', cloudIdFromPath(window.location.pathname)), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `plan-${release.product_id}-${release.id || release.release_id}-${Date.now()}` },
      body: JSON.stringify({ product_id: release.product_id, release_id: release.id || release.release_id, name: planName.trim() || `Update ${release.version}`, scope: scopePreview.scope, selector: scopePreview.scope.query, phases: [{ phase: 0, cumulative_percentage: 100, soak_seconds: 0 }], failure_policy: { minimum_sample_size: 10, failure_percentage: 10, timeout_percentage: 10 }, rate_limit_per_minute: Number(planRate) }),
    });
    setPlanMessage(response.ok ? 'The update protocol has been created, please activate it below.' : 'The update plan could not be created at this time.');
    if (response.ok) { setPlanName(''); setPlanRelease(''); setPlanRate(100); setScopePreview(null); onRefresh(); }
  }
  async function previewScope() {
    const release = releases.find((item) => item.id === planRelease || item.release_id === planRelease);
    if (!release) { setPlanMessage('Please select firmware version first.'); return; }
    const query = Object.fromEntries(Object.entries(scopeQuery).flatMap(([key, value]) => {
      const values = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
      return values.length ? [[key, values]] : [];
    }));
    setScopeLoading(true);
    const response = await fetch(scopedCustomerAPI('/api/update-plans/scope-preview', cloudIdFromPath(window.location.pathname)), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: release.product_id, query, excluded_device_ids: excludedDeviceText.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean) }),
    });
    const body = await response.json().catch(() => ({}));
    setScopeLoading(false);
    if (!response.ok) { setScopePreview(null); setPlanMessage('The scope preview is temporarily unavailable. Check the filters and try again.'); return; }
    setScopePreview(body);
    setPlanMessage('The server calculated the scope preview for the immutable OTA plan.');
  }
  async function releaseAction(release, action) {
    const id = release.id || release.release_id;
    const response = await fetch(scopedCustomerAPI(`/api/products/${encodeURIComponent(release.product_id)}/releases/${encodeURIComponent(id)}/${action}`, cloudIdFromPath(window.location.pathname)), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `release-action-${id}-${action}-${Date.now()}` },
      body: JSON.stringify(action === 'revoke' ? { reason: 'Withdrawn by Brand Operator' } : {}),
    });
    setReleaseMessage(response.ok ? `Version ${action === 'publish' ? 'published' : 'updated'}.` : 'The version status cannot be updated right now.');
    if (response.ok) onRefresh();
  }
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
  const latestVersionRow = versions.find((version) => version.is_latest) || versions[0] || null;
  const latestVersion = latestVersionRow?.version || '—';
  const currentDevices = latestVersionRow?.count || 0;
  const primaryCampaign = campaigns[0] || null;
  const selectedCampaign = campaigns.find((campaign) => campaign.campaign_id === selectedCampaignId) || null;
  const failedRollout = primaryCampaign?.failed ?? 0;
  const primaryProgress = firmwareCampaignProgress(primaryCampaign || {});

  return (
    <section className="panel firmware-ota-page">
      <div className="panel-head">
        <div>
          <h2>Firmware OTA</h2>
          <p>Start and stop OTA rollouts, publish firmware versions, and track device progress for the selected Product.</p>
        </div>
        <button type="button" className="ghost-button" disabled={!hasSelection || statusRefreshing} onClick={refreshStatus}>{statusRefreshing ? 'Updating status…' : 'Refresh status'}</button>
      </div>

      <section className="firmware-product-selector" aria-label="Firmware Product selector">
        <label className="firmware-product-field">
          <span>Product</span>
          <select className="select-control" aria-label="Select Firmware Product" value={selectedProductId} onChange={selectProduct} disabled={!products.length}>
            <option value="">Please select Product first</option>
            {products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}
          </select>
        </label>
        <p>{selectedProduct ? `Showing firmware versions, device distribution, and OTA update status for ${selectedProduct.name}.` : 'Select a Product to load its firmware and OTA status.'}</p>
      </section>

      {!hasSelection ? <section className="firmware-selection-empty"><Icon name="microchip" /><div><h3>Please select Product first</h3><p>Different Product hardware models, firmware versions and update plans are independent of each other.</p></div></section> : null}

      {hasSelection && available ? <section className="metrics firmware-page-metrics">
        <MetricCard icon="microchip" label="Latest version" value={latestVersion} hint="Current target version" tone="info" />
        <MetricCard icon="circle-check" label="Already up to date" value={currentDevices} hint={`of the selected Product ${formatPercent(latestVersionRow?.pct || 0)}`} tone="good" />
        <MetricCard icon="cloud-arrow-up" label="Recent updates" value={primaryCampaign ? formatPercent(primaryProgress.pct) : '—'} hint={primaryCampaign ? `${formatNumber(primaryProgress.completed)} of ${formatNumber(primaryProgress.total)} devices processed` : 'No updates are currently running'} tone="info" />
        <MetricCard icon="circle-exclamation" label="Update failed" value={failedRollout} hint={primaryCampaign ? `${formatPercent(primaryCampaign.total ? failedRollout / primaryCampaign.total * 100 : 0)} of target devices` : 'No updates are currently running'} tone={failedRollout ? 'danger' : 'good'} />
      </section> : null}

      {hasSelection && distribution && available ? (
        <FirmwareOTADashboard
          campaigns={campaigns}
          selectedCampaignId={selectedCampaignId}
          onSelect={setSelectedCampaignId}
          onAction={runCampaignAction}
          canManage={canManageOTA}
          busyAction={campaignActionBusy}
        />
      ) : null}

      {hasSelection && canRelease && selectedProduct.allowed_actions?.includes('manage_updates') ? <section className="panel firmware-panel"><div className="panel-head"><div><h3>Add firmware version</h3><p>The version will be registered to {selectedProduct.name}. You can then create an update plan for the same Product.</p></div></div><form className="inline-form" onSubmit={publishRelease}><input required placeholder="Version, e.g. 1.4.3" value={releaseVersion} onChange={(event) => setReleaseVersion(event.target.value)} /><input ref={releaseFileInput} name="artifact" required type="file" accept="application/octet-stream,.bin" aria-label="Firmware binary" onChange={selectReleaseArtifact} /><input required placeholder="Hardware versions (comma separated)" value={releaseHardware} onChange={(event) => setReleaseHardware(event.target.value)} />{releaseArtifactLoading ? <div className="firmware-artifact-metadata" role="status">Calculating firmware metadata…</div> : null}{releaseArtifact ? <dl className="firmware-artifact-metadata" aria-label="Firmware binary metadata"><div><dt>File</dt><dd>{releaseArtifact.name}</dd></div><div><dt>Size</dt><dd>{formatFirmwareSize(releaseArtifact.size)}{releaseArtifact.size >= 1024 ? ` (${releaseArtifact.size.toLocaleString('en-US')} bytes)` : ''}</dd></div><div><dt>SHA-256</dt><dd><code>{releaseArtifact.sha256}</code></dd></div></dl> : null}<button type="submit" className="primary-button" disabled={releaseArtifactLoading || !releaseArtifact}>Create version</button></form>{releaseMessage ? <p className="notice">{releaseMessage}</p> : null}</section> : null}
      {hasSelection && canManageOTA && releases.some((release) => String(release.state || '').toLowerCase() === 'published') ? <section className="panel firmware-panel"><div className="panel-head"><div><h3>Create an update plan</h3><p>Obtain the server scope preview before creating the immutable OTA plan; the browser does not determine the target count.</p></div></div><form className="inline-form" onSubmit={createUpdatePlan}><select className="select-control" required value={planRelease} onChange={(event) => { setPlanRelease(event.target.value); setScopePreview(null); }}><option value="">Select firmware version</option>{releases.filter((release) => String(release.state || '').toLowerCase() === 'published').map((release) => <option value={release.id || release.release_id} key={release.id || release.release_id}>{release.version}</option>)}</select><input placeholder="Plan name (optional)" value={planName} onChange={(event) => setPlanName(event.target.value)} /><label className="ota-rate-field"><span>Upgrade rate (devices/minute)</span><input required type="number" min="1" max="10000" step="1" value={planRate} onChange={(event) => setPlanRate(event.target.value)} /></label><input placeholder="Regions (comma separated)" value={scopeQuery.region} onChange={(event) => { setScopeQuery({ ...scopeQuery, region: event.target.value }); setScopePreview(null); }} /><input placeholder="Group IDs (comma separated)" value={scopeQuery.group_ids} onChange={(event) => { setScopeQuery({ ...scopeQuery, group_ids: event.target.value }); setScopePreview(null); }} /><input placeholder="Firmware versions (comma separated)" value={scopeQuery.firmware} onChange={(event) => { setScopeQuery({ ...scopeQuery, firmware: event.target.value }); setScopePreview(null); }} /><input placeholder="Health statuses (comma separated)" value={scopeQuery.health} onChange={(event) => { setScopeQuery({ ...scopeQuery, health: event.target.value }); setScopePreview(null); }} /><input className="wide-input" placeholder="Exclude device IDs (comma or space separated)" value={excludedDeviceText} onChange={(event) => { setExcludedDeviceText(event.target.value); setScopePreview(null); }} /><button type="button" className="ghost-button" disabled={scopeLoading || !planRelease} onClick={previewScope}>{scopeLoading ? 'Calculating scope…' : 'Preview server scope'}</button><button type="submit" className="primary-button" disabled={!scopePreview?.scope || Number(planRate) < 1 || Number(planRate) > 10000}>Create update plan</button></form>{scopePreview?.scope ? <div className="scope-preview-grid"><span>Target <strong>{formatNumber(scopePreview.target_count || 0)}</strong></span><span>Excluded <strong>{formatNumber(scopePreview.excluded_count || 0)}</strong></span><span>Scope <code>{scopePreview.scope.scope_hash}</code></span><span>Expires <strong>{scopePreview.scope.expires_at || '—'}</strong></span></div> : null}{planMessage ? <p className="notice">{planMessage}</p> : null}</section> : null}
      {hasSelection && releases.length ? <section className="panel firmware-panel"><div className="panel-head"><div><h3>Firmware Version</h3><p>The version must be uploaded and checked before it can be published to the update plan.</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Product</th><th>Version</th><th>Status</th><th>Action</th></tr></thead><tbody>{releases.map((release) => <tr key={`${release.product_id}:${release.id || release.release_id}`}><td>{selectedProduct.name}</td><td>{release.version}</td><td>{release.state}</td><td>{canRelease && String(release.state).toLowerCase() === 'ready' ? <button type="button" className="ghost-button" onClick={() => releaseAction(release, 'publish')}>Publish</button> : null}{canRelease && String(release.state).toLowerCase() === 'published' ? <button type="button" className="link-button" onClick={() => releaseAction(release, 'revoke')}>Withdraw</button> : null}{!canRelease ? <span className="muted">Read-only</span> : null}</td></tr>)}</tbody></table></div></section> : null}

      {hasSelection && loading && !distribution ? <p className="empty-state">Loading {selectedProduct.name} state of the firmware.</p> : null}
      {hasSelection && distribution && !available ? <SourceBlockedState title={pageState.title} message={unavailableText} /> : null}

      {hasSelection && distribution && available ? (
        <>
        <div className="firmware-layout">
          <section className="panel firmware-panel">
            <div className="panel-head">
              <div>
                <h3>Firmware Version Distribution</h3>
                <p>See the number of devices for each version; tap a version to go to the list of devices that have that version applied.</p>
              </div>
            </div>
            {versions.length ? (
              <div className="firmware-version-list">
                {versions.map((version) => (
                  <button
                    key={version.version}
                    type="button"
                    className={`firmware-version-row${version.is_latest ? ' is-latest' : ''}`}
                    onClick={() => onViewDevices(version.version, selectedProductId)}
                  >
                    <div className="firmware-version-row__meta">
                      <div>
                        <strong>{version.version}</strong>
                        {version.is_latest ? <span className="version-badge">Latest</span> : null}
                      </div>
                      <small>{version.count} Devices</small>
                    </div>
                    <div className="firmware-version-row__bar" aria-hidden="true">
                      <span style={{ width: `${Math.max(version.pct || 0, version.count ? 8 : 0)}%` }} />
                    </div>
                    <strong className="firmware-version-row__pct">{formatPercent(version.pct || 0)}</strong>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-state">No firmware version data available at this time.</p>
            )}
          </section>

          <FirmwareCampaignSummary campaign={selectedCampaign || primaryCampaign} />
        </div>

        <div className="firmware-lower-grid">
          <FirmwareCampaignDetail campaign={selectedCampaign} onAction={canManageOTA ? runCampaignAction : null} canManage={canManageOTA} />
          <FirmwareRiskQueue campaigns={campaigns} onViewDevices={(version) => onViewDevices(version, selectedProductId)} />
        </div>
        </>
      ) : null}
    </section>
  );
}

function FirmwareOTADashboard({ campaigns, selectedCampaignId, onSelect, onAction, canManage, busyAction }) {
  const [rateDrafts, setRateDrafts] = useState({});
  const [rateMessages, setRateMessages] = useState({});
  async function updateRate(campaign) {
    const rate = Number(rateDrafts[campaign.campaign_id] ?? campaign.rate_limit_per_minute ?? 100);
    if (!Number.isInteger(rate) || rate < 1 || rate > 10000) {
      setRateMessages((messages) => ({ ...messages, [campaign.campaign_id]: 'Enter a whole number from 1 to 10,000.' }));
      return;
    }
    const ok = await onAction(campaign.campaign_id, 'rate-limit', { rate_limit_per_minute: rate });
    setRateMessages((messages) => ({ ...messages, [campaign.campaign_id]: ok ? 'Upgrade rate updated.' : 'Upgrade rate could not be updated.' }));
  }
  return (
    <section className="panel firmware-panel ota-dashboard" aria-label="OTA Dashboard">
      <div className="panel-head">
        <div>
          <h3>OTA Dashboard</h3>
          <p>OTA rollouts are ordered by start time, newest first. Stop pauses an active rollout so it can be started again.</p>
        </div>
      </div>
      {campaigns.length ? (
        <div className="ota-dashboard-list">
          {campaigns.map((campaign) => {
            const waiting = firmwareCampaignWaitingProgress(campaign);
            const control = firmwareDashboardAction(campaign, canManage);
            const controlBusy = control && busyAction === `${campaign.campaign_id}:${control.action}`;
            const rateBusy = busyAction === `${campaign.campaign_id}:rate-limit`;
            const configuredRate = campaign.rate_limit_per_minute || 100;
            const effectiveRate = campaign.effective_rate_limit_per_minute || configuredRate;
            const systemMaxRate = campaign.system_max_rate_limit_per_minute || 10000;
            const canChangeRate = canManage && ['draft', 'scheduled', 'active', 'paused'].includes(normalizeStatusKey(campaign.state));
            return (
              <article className={`ota-dashboard-row${selectedCampaignId === campaign.campaign_id ? ' is-selected' : ''}`} key={campaign.campaign_id}>
                <button
                  type="button"
                  className="ota-dashboard-row__details"
                  aria-pressed={selectedCampaignId === campaign.campaign_id}
                  onClick={() => onSelect(campaign.campaign_id)}
                >
                  <span className="ota-dashboard-row__heading">
                    <strong>{campaign.campaign_id}</strong>
                    <StatusBadge value={normalizeStatusKey(campaign.state)} label={firmwareCampaignStatusLabel(campaign.state)} />
                  </span>
                  <span className="ota-dashboard-row__meta">
                    <span>Target {campaign.target_version || '—'}</span>
                    <time dateTime={campaign.started_at || undefined}>Started {formatFirmwareStartTime(campaign.started_at)}</time>
                    <span>Rate {formatNumber(configuredRate)}/min · effective {formatNumber(effectiveRate)}/min</span>
                  </span>
                  <span className="ota-dashboard-waiting-copy">
                    <span>Waiting devices</span>
                    <strong>{formatNumber(waiting.waiting)} / {formatNumber(waiting.total)}</strong>
                  </span>
                  <span
                    className="ota-dashboard-progress"
                    role="progressbar"
                    aria-label={`Waiting devices for ${campaign.campaign_id}`}
                    aria-valuemin="0"
                    aria-valuemax={Math.max(waiting.total, 1)}
                    aria-valuenow={Math.min(waiting.waiting, waiting.total || 0)}
                    aria-valuetext={`${waiting.waiting} waiting of ${waiting.total} total devices`}
                  >
                    <span style={{ width: `${waiting.pct}%` }} />
                  </span>
                </button>
                <div className="ota-dashboard-row__actions">
                  {canChangeRate ? <div className="ota-dashboard-rate"><label><span>Devices/minute</span><input type="number" min="1" max={systemMaxRate} step="1" value={rateDrafts[campaign.campaign_id] ?? configuredRate} onChange={(event) => setRateDrafts((rates) => ({ ...rates, [campaign.campaign_id]: event.target.value }))} /></label><button type="button" className="ghost-button" disabled={Boolean(busyAction)} onClick={() => updateRate(campaign)}>{rateBusy ? 'Saving…' : 'Update rate'}</button><small>System max {formatNumber(systemMaxRate)}/min</small>{rateMessages[campaign.campaign_id] ? <small role="status">{rateMessages[campaign.campaign_id]}</small> : null}</div> : <span className="muted">Rate {formatNumber(configuredRate)}/min · effective {formatNumber(effectiveRate)}/min</span>}
                  {control ? (
                    <button
                      type="button"
                      className={control.action === 'pause' ? 'danger-button' : 'primary-button'}
                      disabled={Boolean(busyAction)}
                      onClick={() => onAction(campaign.campaign_id, control.action)}
                    >
                      {controlBusy ? `${control.label.replace(' OTA', '')}…` : control.label}
                    </button>
                  ) : <span className="muted">{canManage ? 'No action available' : 'Read-only'}</span>}
                </div>
              </article>
            );
          })}
        </div>
      ) : <p className="empty-state">There are currently no OTA rollouts for this Product.</p>}
    </section>
  );
}

function formatFirmwareStartTime(value) {
  if (Number.isNaN(Date.parse(value || ''))) return 'not started';
  return formatDateTime(value, { dateStyle: 'medium', timeStyle: 'short' });
}

function FirmwareCampaignDetail({ campaign, onAction, canManage }) {
  const rows = firmwareCampaignDetailRows(campaign || {});
  const actions = firmwareCampaignActions(campaign || {}, canManage);
  const actionLabels = { start: 'Activate update', pause: 'Pause', resume: 'Resume', retry: 'Retry failed device', cancel: 'Cancel update' };
  return (
    <section className="panel firmware-panel firmware-campaign-detail">
      <div className="panel-head">
        <div>
          <h3>Device upgrade details</h3>
          <p>{campaign ? `${campaign.campaign_id} · Target Version ${campaign.target_version || '—'} · Last Updated ${campaign.updated_at ? formatRelativeTime(campaign.updated_at) : '—'}` : 'Please select a firmware update record.'}</p>
        </div>
        {campaign && actions.length ? (
          <div className="inline-actions">
            {actions.map((action) => <button type="button" className={action === 'cancel' ? 'danger-button' : 'ghost-button'} key={action} onClick={() => onAction?.(campaign.campaign_id, action)}>{actionLabels[action]}</button>)}
          </div>
        ) : campaign ? <span className="status-badge neutral">{canManage ? 'No action available' : 'Read-only'}</span> : null}
      </div>
      {campaign && rows.length ? (
        <div className="firmware-rollout-table">
          <div className="firmware-rollout-table__head">
            <span>Device</span>
            <span>Current Version</span>
            <span>Target Version</span>
            <span>Upgrade Status</span>
            <span>Reason</span>
            <span>Final report</span>
          </div>
          {rows.map((rollout) => (
            <div className="firmware-rollout-table__row" key={`${campaign.campaign_id}:${rollout.device_id}`}>
              <strong>{rollout.device_name || rollout.device_id}</strong>
              <span>{rollout.current_version}</span>
              <span>{rollout.target_version || campaign.target_version || '—'}</span>
              <StatusBadge value={normalizeStatusKey(rollout.rollout_status)} label={firmwareRolloutStatusLabel(rollout.rollout_status)} />
              <span>{rollout.reason || '—'}</span>
              <time>{rollout.last_updated ? formatRelativeTime(rollout.last_updated) : '—'}</time>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">{campaign ? 'There is currently no device status data for this update.' : 'No firmware update history selected.'}</p>
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
            <h3>Firmware Update Summary</h3>
            <p>There are currently no firmware updates.</p>
          </div>
        </div>
      </section>
    );
  }
  const total = campaign.total || 0;
  const segments = [
    { key: 'applied', label: 'Update complete', count: campaign.applied, tone: 'good' },
    { key: 'pending', label: 'Waiting', count: campaign.pending, tone: 'info' },
    { key: 'failed', label: 'Update failed', count: campaign.failed, tone: 'danger' },
    { key: 'skipped', label: 'Skipped', count: campaign.skipped, tone: 'neutral' },
  ];
  const progress = firmwareCampaignProgress(campaign);
  return (
    <section className="panel firmware-panel rollout-summary">
      <div className="panel-head">
        <div>
          <h3>Firmware Update Summary</h3>
          <p>Target {campaign.target_version} · {firmwarePolicyLabel(campaign.policy)} · Processed {formatPercent(progress.pct)} · Last updated {campaign.updated_at ? formatRelativeTime(campaign.updated_at) : '—'}</p>
        </div>
        <StatusBadge value={normalizeStatusKey(campaign.state)} label={firmwareCampaignStatusLabel(campaign.state)} />
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
          <span>Target Device</span>
          <strong>{total}</strong>
          <small>100%</small>
        </div>
      </div>
      <div className="rollout-progress" aria-label="Firmware update progress">
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
          <h3>Devices that need attention</h3>
          <p>List devices that failed to update, are waiting, or have an unknown version.</p>
        </div>
        <span>{rows.length} Devices</span>
      </div>
      {rows.length ? (
        <div className="risk-table">
          <div className="risk-table-head">
            <span>Device</span>
            <span>Current Version</span>
            <span>Status</span>
            <span>Final report</span>
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
              <StatusBadge value={normalizeStatusKey(rollout.rollout_status)} label={firmwareRolloutStatusLabel(rollout.rollout_status)} />
              <time>{rollout.last_updated ? formatRelativeTime(rollout.last_updated) : '—'}</time>
            </button>
          ))}
        </div>
      ) : (
        <p className="empty-state">There are currently no devices to process.</p>
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
      value: available ? formatPercent(stats?.success_rate_pct ?? 0) : 'N/A',
      hint: available ? 'Percent of stream requests that succeeded in the selected window' : unavailableText,
    },
    {
      key: 'avg-duration',
      icon: 'clock',
      label: 'Avg Stream Duration',
      value: available ? formatDurationMinutes(stats.avg_duration_seconds) : 'N/A',
      hint: available ? 'Average session length across observed requests' : unavailableText,
    },
    {
      key: 'active-sessions',
      icon: 'tower-broadcast',
      label: 'Active Sessions Now',
      value: available ? (stats?.active_sessions ?? 0) : 'N/A',
      hint: available ? 'Count of currently open stream sessions' : unavailableText,
    },
    {
      key: 'never-streamed',
      icon: 'circle-question',
      label: 'Devices Never Streamed',
      value: available ? (stats?.never_streamed_count ?? 0) : 'N/A',
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

function CustomerAccessGate({ me, active }) {
  if (me?.authenticated && me.kind === 'customer') {
    return (
      <section className="panel split-panel">
        <div>
          <h2>Brand Cloud capability required</h2>
          <p>Your active membership cannot access {titleFor(active)}. The active Cloud was preserved and no write controls were loaded.</p>
        </div>
      </section>
    );
  }
  if (me?.kind === 'platform_admin') {
    return (
      <section className="panel split-panel">
        <div>
          <h2>Platform admin cannot use the Brand Cloud console</h2>
          <p>Your platform session remains isolated from customer data. Open the platform home to inspect cross-tenant operations.</p>
          <a className="inline-action" href="/admin">Go to platform homepage</a>
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
        <p>{signedInCustomer ? 'Your current customer session cannot open platform administration routes.' : `Sign in with a platform admin session to open ${titleFor(active)}.`}</p>
        {!signedInCustomer ? <a className="inline-action" href={loginPathFor(protectedPathFromLocation(window.location))}>Go to sign in</a> : null}
      </div>
    </section>
  );
}

function platformSourceLabel(status) {
  const labels = {
    configured: 'configured',
    stale: 'stale',
    empty: 'empty',
    unavailable: 'unavailable',
    unconfigured: 'unconfigured',
  };
  return labels[String(status || '').toLowerCase()] || 'unknown';
}

function dashboardSourceStatus(dashboard) {
  return dashboard?.sources?.prometheus?.source_status || dashboard?.prometheus?.queries?.find((query) => query.source_status)?.source_status || 'unconfigured';
}

function platformCheckedAt(dashboard) {
  return dashboard?.sources?.prometheus?.checked_at
    || dashboard?.panel_sources?.service_metrics?.checked_at
    || dashboard?.prometheus?.queries?.find((query) => query.checked_at)?.checked_at
    || '';
}

function ssoStatusLabel(provider) {
  if (!provider) return 'SSO unavailable';
  if (provider.status === 'disabled' || provider.enabled === false && provider.configured) return 'SSO disabled';
  if (provider.enabled) return 'SSO enabled';
  if (provider.configured) return 'SSO configured';
  return 'SSO not configured';
}

function PlatformDashboardLanding({ dashboard, summary, health, operations, logs }) {
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
  const dashboardHealth = platformDashboardHealth({
    sourceStatus: dashboardSourceStatus(dashboard),
    targetsDown,
    workloadsDegraded,
    failedOperations: risk.failed_operations,
  });
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
        <div className="platform-context-controls" aria-label="Platform dashboard status">
          <span className="platform-health-chip"><StatusDot value={dashboardHealth.tone} />{dashboardHealth.label}</span>
          <span className="platform-source-state">Source: {platformSourceLabel(dashboardSourceStatus(dashboard))}</span>
        </div>
        <span className="platform-updated"><Icon name="rotate" /> {platformCheckedAt(dashboard) ? `Checked ${formatRelativeTime(platformCheckedAt(dashboard))}` : 'Source freshness unavailable'}</span>
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
        <PlatformIncidentContext logs={logs} />
        <PlatformMetricPanel title="Cross-Service Risk" icon="diagram-project" rows={crossServiceRows} />
        <PlatformMetricPanel title="Business Signals" icon="chart-line" rows={businessRows} secondary />
        <PlatformMetricPanel title="Infrastructure Health" icon="microchip" rows={infrastructureRows} />
        {serverResources.length ? <ServerResourceStatus resources={serverResources} source={dashboard?.panel_sources?.server_resources || source} legacy /> : null}
      </section>
    </section>
  );
}

function PlatformGrafanaView({ status }) {
  const embed = grafanaEmbedState(status);
  return (
    <section className="platform-dashboard grafana-page">
      <div className="platform-dashboard-head">
        <div>
          <h2>Grafana</h2>
          <p>Private LKE observability dashboard embedded through the Admin Console.</p>
        </div>
      </div>
      {embed.ready ? (
        <article className="panel grafana-frame-panel">
          <iframe
            title="RTK LKE Staging Grafana dashboard"
            src={embed.iframeURL}
            className="grafana-frame"
            loading="lazy"
            referrerPolicy="same-origin"
          />
        </article>
      ) : (
        <section className="panel split-panel">
          <div>
            <h2>Grafana unavailable</h2>
            <p>{embed.message}</p>
          </div>
        </section>
      )}
    </section>
  );
}

function ScrapeHealthPanel({ groups }) {
  return (
    <article className="panel platform-dashboard-panel platform-compact-panel">
      <div className="panel-head">
        <div>
          <h2 className="heading-with-icon"><Icon name="gauge-high" />Scrape Health</h2>
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
          <h2 className="heading-with-icon"><Icon name="building" />Tenant &amp; Device Footprint</h2>
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
          <h2 className="heading-with-icon"><Icon name="triangle-exclamation" />Operation Risk</h2>
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
      <div className="panel-action-row"><a className="inline-action" href="/admin/ops">View all operations <Icon name="arrow-right" /></a></div>
      <OperationList operations={operations} detailed />
    </article>
  );
}

function PlatformActivityPanel({ health }) {
  return (
    <article className="panel platform-dashboard-panel platform-activity-panel platform-compact-panel">
      <div className="panel-head">
        <div>
          <h2 className="heading-with-icon"><Icon name="chart-line" />Platform Activity</h2>
          <p>{health.filter((item) => item.status === 'ok').length} of {health.length} services healthy.</p>
        </div>
      </div>
      <ServiceHealth health={health} compact />
    </article>
  );
}

function PlatformIncidentContext({ logs }) {
  const events = (logs?.events || []).filter((event) => ['error', 'fatal', 'warn', 'warning'].includes(String(event.level || '').toLowerCase())).slice(0, 5);
  return (
    <article className="panel platform-dashboard-panel platform-compact-panel platform-incident-panel">
      <div className="panel-head">
        <div>
          <h2 className="heading-with-icon"><Icon name="triangle-exclamation" />Recent Incident Context</h2>
          <p>Recent log events that help explain degraded platform state.</p>
        </div>
        <a className="inline-action" href="/admin/logs">View service logs <Icon name="arrow-up-right-from-square" /></a>
      </div>
      {logs?.message ? <p className="source-note">{logs.message}</p> : null}
      {events.length ? (
        <div className="incident-list">
          {events.map((event) => (
            <article className="incident-row" key={event.event_id || `${event.ts}-${event.msg}`}>
              <StatusDot value="warning" />
              <div>
                <strong>{event.msg || 'Service event'}</strong>
                <span>{[event.service, event.level, event.trace_id || event.request_id].filter(Boolean).join(' · ')}</span>
              </div>
              <time>{event.ts ? formatRelativeTime(event.ts) : '-'}</time>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-state compact-empty">No recent warning or error log events.</p>
      )}
    </article>
  );
}

function ServiceMetricsTable({ metrics, source }) {
  return (
    <article className="panel platform-dashboard-panel server-resource-panel">
      <div className="panel-head">
        <div>
          <h2 className="heading-with-icon"><Icon name="heart-pulse" />Service Health</h2>
          <p>Current k8s service target health and basic runtime metrics. Long-term trends live in Grafana.</p>
        </div>
        <a className="inline-action" href="/admin/health">View service health <Icon name="arrow-right" /></a>
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
                <td colSpan="7" className="empty-state">{sourceMessage(source, 'No Kubernetes service metrics are available.')}</td>
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
          <h2 className="heading-with-icon"><Icon name="boxes-stacked" />K8s Workloads</h2>
          <p>Deployment replica, pod readiness, restart, and crashloop status.</p>
        </div>
        <a className="inline-action" href="/admin/health">View workload health <Icon name="arrow-right" /></a>
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
                <td colSpan="8" className="empty-state">{sourceMessage(source, 'No Kubernetes workload health data is available.')}</td>
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
          <h2 className="heading-with-icon"><Icon name="server" />Cluster Nodes</h2>
          <p>Current k8s node readiness and resource snapshot.</p>
        </div>
        <a className="inline-action" href="/admin/health">View service health <Icon name="arrow-right" /></a>
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
                <td colSpan="5" className="empty-state">{sourceMessage(source, 'No Kubernetes node metrics are available.')}</td>
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
          <h2 className="heading-with-icon"><Icon name="file-export" />Service Exporter Status</h2>
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
          <h2 className="heading-with-icon"><Icon name="server" />{legacy ? 'Legacy Server Resource Status' : 'Server Resource Status'}</h2>
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

function PlatformMetricPanel({ title, icon = 'layer-group', rows, secondary = false }) {
  return (
    <article className={`panel platform-dashboard-panel ${secondary ? 'platform-dashboard-panel-secondary' : ''}`}>
      <div className="panel-head">
        <div>
          <h2 className="heading-with-icon"><Icon name={icon} />{title}</h2>
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
  if (Math.abs(number) >= 1000) return formatNumber(number, { maximumFractionDigits: 0 });
  if (Math.abs(number) >= 10) return formatNumber(number, { maximumFractionDigits: 1 });
  return formatNumber(number, { maximumFractionDigits: 2 });
}

function PlatformHealth({ summary, health }) {
  const customerCount = summary?.customers ?? '-';
  const demoServices = health.filter((item) => item.status === 'demo');
  const hasDemo = demoServices.length > 0;
  return (
    <>
      <section className="panel split-panel">
        <div>
          <h2 className="heading-with-icon"><Icon name="server" />Platform Operations</h2>
          <p>Cross-customer view for service and operations support teams.</p>
          <div className="admin-kpis">
            <div><Icon name="building" /><strong>{customerCount}</strong><span>Customers</span></div>
            <div><Icon name="heart-pulse" /><strong>{health.length}</strong><span>Service checks</span></div>
          </div>
        </div>
        <ServiceHealth health={health} compact />
      </section>
      {hasDemo ? <section className="panel demo-banner"><p><Icon name="flask" />{`Demo services active: ${demoServices.map((service) => service.name).join(', ')}`}</p></section> : null}
    </>
  );
}

function PlatformServiceLogs({ logs, loading }) {
  const events = logs?.events || [];
  const status = logs?.status || (loading ? 'loading' : 'unavailable');
  const [filters, setFilters] = useState({ query: '', level: '', service: '' });
  const visibleEvents = events.filter((event) => {
    const query = filters.query.trim().toLowerCase();
    const matchesQuery = !query || [event.msg, event.trace_id, event.request_id, event.operation_id, event.device_id, event.org_id, event.user_id]
      .some((value) => String(value || '').toLowerCase().includes(query));
    const matchesLevel = !filters.level || String(event.level || '').toLowerCase() === filters.level;
    const matchesService = !filters.service || String(event.service || '').toLowerCase() === filters.service;
    return matchesQuery && matchesLevel && matchesService;
  });
  const levels = [...new Set(events.map((event) => String(event.level || '').toLowerCase()).filter(Boolean))];
  const services = [...new Set(events.map((event) => String(event.service || '').toLowerCase()).filter(Boolean))];
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const clearFilters = () => setFilters({ query: '', level: '', service: '' });
  return (
    <section className="panel platform-dashboard-panel">
      <div className="panel-head">
        <div>
          <h2 className="heading-with-icon"><Icon name="file-lines" />Cloud Service Logs</h2>
          <p>Use this page to find a failed request, identify the affected service, and follow its trace or request ID.</p>
        </div>
        <span className={`status-pill ${status === 'ok' ? 'ok' : 'warn'}`}><Icon name={status === 'ok' ? 'circle-check' : 'triangle-exclamation'} />{status}</span>
      </div>
      <div className="logs-start-here">
        <strong><Icon name="wand-magic-sparkles" />Start here</strong>
        <span>Choose a level or service, or search an ID/message to investigate a specific incident.</span>
      </div>
      <div className="logs-filter-panel">
        <div className="logs-filter-heading"><strong><Icon name="filter" />Find log events</strong><span>{visibleEvents.length} of {events.length} events</span></div>
        <div className="filter-row logs-filter-row">
          <label className="logs-search-field"><span><Icon name="magnifying-glass" />Search message or ID</span><input value={filters.query} onChange={(event) => updateFilter('query', event.target.value)} placeholder="e.g. trace-e2e-001" /></label>
          <label><span><Icon name="layer-group" />Level</span><select value={filters.level} onChange={(event) => updateFilter('level', event.target.value)}><option value="">All levels</option>{levels.map((level) => <option key={level} value={level}>{toTitleCase(level)}</option>)}</select></label>
          <label><span><Icon name="server" />Service</span><select value={filters.service} onChange={(event) => updateFilter('service', event.target.value)}><option value="">All services</option>{services.map((service) => <option key={service} value={service}>{service}</option>)}</select></label>
          <button type="button" className="ghost-button logs-clear-button" onClick={clearFilters} disabled={!filters.query && !filters.level && !filters.service}><Icon name="rotate-left" />Clear filters</button>
        </div>
      </div>
      {logs?.message ? <p className="source-note">{logs.message}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th><Icon name="clock" />Time</th><th><Icon name="server" />Service</th><th><Icon name="shield-halved" />Level</th><th><Icon name="desktop" />Host</th><th><Icon name="message" />Message</th><th><Icon name="route" />Trace</th><th><Icon name="arrow-right-to-bracket" />Request</th></tr>
          </thead>
          <tbody>
            {visibleEvents.map((event) => (
              <tr key={event.event_id || `${event.ts}-${event.msg}`}>
                <td>{event.ts || '-'}</td>
                <td>{event.service || '-'}</td>
                <td><span className={`log-level log-level-${String(event.level || 'unknown').toLowerCase()}`}><Icon name={statusIconName(event.level)} />{event.level || '-'}</span></td>
                <td>{event.host || '-'}</td>
                <td>{event.msg || '-'}</td>
                <td>{event.trace_id || '-'}</td>
                <td>{event.request_id || '-'}</td>
              </tr>
            ))}
            {!visibleEvents.length ? <tr><td colSpan="7"><div className="logs-empty"><Icon name={events.length ? 'filter-circle-xmark' : loading ? 'spinner' : 'inbox'} /><strong>{loading ? 'Loading service logs' : events.length ? 'No matching log events' : 'No service log events found'}</strong><span>{events.length ? 'Try clearing a filter or searching for another message or ID.' : 'When an event is available, start with its level and follow the trace or request ID.'}</span></div></td></tr> : null}
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

      {drawerMode === 'create' ? <BrandCloudCreateDrawer onClose={onCloseDrawer} onCreate={onCreateBrand} /> : null}
      {drawerMode === 'detail' && selectedBrand ? (
        <BrandCloudDetailDrawer
          brand={selectedBrand}
          onClose={onCloseDrawer}
          onUpdateBrand={onUpdateBrand}
          onCreateUser={onCreateUser}
        />
      ) : null}
    </section>
  );
}

function BrandCloudDetailDrawer({ brand, onClose, onUpdateBrand, onCreateUser }) {
  const [detailBrand, setDetailBrand] = useState(brand);
  const [ssoProvider, setSSOProvider] = useState(null);
  const [detailSource, setDetailSource] = useState({ status: 'loading', message: '' });
  const [user, setUser] = useState({ email: '', display_name: '', role: 'admin' });
  const [users, setUsers] = useState([]);
  const [userFilter, setUserFilter] = useState('all');
  const [usersSource, setUsersSource] = useState({ status: 'loading', message: '' });
  const [message, setMessage] = useState('');
  const disabled = brandCloudStatusKey(detailBrand) === 'disabled';
  const owner = brandCloudOwner(detailBrand);
  const pendingUsers = users.filter((row) => brandCloudUserStatus(row).key === 'pending_verification').length;
  const disabledUsers = users.filter((row) => brandCloudUserStatus(row).key === 'disabled').length;
  const activeUsers = users.filter((row) => brandCloudUserStatus(row).key === 'active').length;

  async function loadDetail() {
    setDetailSource({ status: 'loading', message: '' });
    try {
      const [detailResult, ssoResult] = await Promise.all([
        fetchJSON(`/api/admin/brand-clouds/${encodeURIComponent(brand.id)}`),
        fetchJSON(`/api/admin/orgs/${encodeURIComponent(brand.id)}/sso-provider`).catch(() => ({ provider: null })),
      ]);
      setDetailBrand(detailResult.brand_cloud || brand);
      setSSOProvider(ssoResult.provider || null);
      setDetailSource({ status: 'ready', message: '' });
    } catch (err) {
      setDetailBrand(brand);
      setDetailSource({ status: 'unavailable', message: userFacingBrandCloudError(err) });
    }
  }

  async function loadUsers(nextFilter = userFilter) {
    setUsersSource({ status: 'loading', message: '' });
    try {
      const params = new URLSearchParams();
      if (nextFilter !== 'all') params.set('status', nextFilter);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const result = await fetchJSON(`/api/admin/brand-clouds/${encodeURIComponent(brand.id)}/users${suffix}`);
	  setUsers(result.users || []);
      setUsersSource({ status: 'ready', message: '' });
    } catch (err) {
      setUsers([]);
      setUsersSource({ status: 'unavailable', message: userFacingBrandCloudError(err) });
    }
  }

  useEffect(() => {
    loadDetail();
    loadUsers('all');
  }, [brand.id]);

  async function changeUserFilter(nextFilter) {
    setUserFilter(nextFilter);
    await loadUsers(nextFilter);
  }

  async function updateStatus(nextStatus) {
    setMessage('');
    try {
      const updated = await onUpdateBrand(brand.id, { name: detailBrand.name, status: nextStatus });
      setDetailBrand(updated || { ...detailBrand, status: nextStatus });
      setMessage(nextStatus === 'disabled' ? 'Brand Cloud disabled.' : 'Brand Cloud enabled.');
    } catch (err) {
      setMessage(userFacingBrandCloudError(err));
    }
  }

  async function submitUser(event) {
    event.preventDefault();
    setMessage('');
	if (!user.email.trim()) {
	  setMessage('Email is required.');
      return;
    }
    try {
      const result = await onCreateUser(brand.id, {
        email: user.email.trim(),
		display_name: user.display_name.trim() || undefined,
		role: user.role,
		activation_mode: 'email',
      });
	  setMessage(result.action === 'created' ? 'Global user created; activation email queued.' : 'Existing global user assigned; sign-in email queued.');
	  setUser({ email: '', display_name: '', role: 'admin' });
      await loadUsers(userFilter);
    } catch (err) {
      setMessage(userFacingBrandCloudError(err));
    }
  }

  async function updateBrandUser(row, action) {
    setMessage('');
    try {
      if (action === 'delete' && !window.confirm(`Remove Brand Cloud access for ${row.email}?`)) return;
	  const path = `/api/admin/brand-clouds/${encodeURIComponent(brand.id)}/users/${encodeURIComponent(row.user_id)}`;
      if (action === 'delete') {
        await sendJSONWithMethod('DELETE', path);
        setMessage('Membership removed.');
      } else {
        await sendJSONWithMethod('POST', `${path}/${action}`, {});
		setMessage(action === 'disable' ? 'Membership disabled.' : 'Membership enabled.');
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
            <h2>{detailBrand.name || detailBrand.id}</h2>
            <p>{detailBrand.id} / {detailBrand.organization_kind || 'brand_cloud'}</p>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close Brand Cloud drawer">x</button>
        </div>
        {detailSource.status === 'unavailable' ? <p className="form-message">{detailSource.message}</p> : null}
        <section className={`brand-cloud-detail-hero brand-cloud-detail-${brandCloudStatusKey(detailBrand)}`}>
          <div className="brand-cloud-status-block">
            <StatusBadge value={brandCloudStatusKey(brand)} label={brandCloudStatusLabel(brand)} />
            <strong>{detailBrand.name || detailBrand.metadata?.brandname || detailBrand.id}</strong>
            <small>{detailBrand.id}</small>
          </div>
          <div className="brand-cloud-fact-grid">
            <div><Icon name="location-dot" /><span>Region</span><strong>{brandCloudRegion(detailBrand)}</strong></div>
            <div><Icon name="layer-group" /><span>Tier</span><strong>{brandCloudTier(detailBrand)}</strong></div>
            <div><Icon name="user-shield" /><span>Owner/Admin</span><strong>{owner || 'Unassigned'}</strong></div>
            <div><Icon name="video" /><span>Devices</span><strong>{brandCloudQuotaLabel(detailBrand)}</strong></div>
          </div>
        </section>
        <section className="setup-list brand-cloud-setup-list" aria-label="Brand Cloud setup state">
          <span className="ok"><Icon name="circle-check" />Created</span>
          <span className={owner ? 'ok' : 'warn'}><Icon name={owner ? 'user-check' : 'user-clock'} />{owner ? 'Owner assigned' : 'Owner pending'}</span>
          <span className={ssoProvider?.configured || ssoProvider?.enabled ? 'ok' : 'warn'}><Icon name="key" />{ssoStatusLabel(ssoProvider)}</span>
          <span className="neutral"><Icon name="database" />{detailBrand.updated_at ? `Updated ${formatRelativeTime(detailBrand.updated_at)}` : 'No update time'}</span>
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
            <a className="inline-action action-link" href={`/admin/sso?org=${encodeURIComponent(detailBrand.id)}`}>
            <Icon name="key" />Open SSO Providers
          </a>
        </div>
        <section className="brand-cloud-users">
          <div className="panel-head compact-head">
            <div>
			  <h3>Global Users</h3>
			  <p>Review each global account's membership in this Brand Cloud.</p>
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
					  <tr key={row.user_id}>
						<td><strong>{row.email}</strong><small>{row.display_name || row.user_id}</small></td>
                        <td><StatusBadge value={status.key === 'pending_verification' ? 'setup_required' : status.key} label={status.label} /></td>
                        <td>{row.updated_at ? formatRelativeTime(row.updated_at) : '-'}</td>
                        <td>
                          <div className="row-actions">
                            {row.disabled_at ? (
                              <button type="button" className="inline-action" onClick={() => updateBrandUser(row, 'enable')}><Icon name="rotate-right" />Enable</button>
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
		  <form className="drawer-form compact" onSubmit={submitUser}>
			<h3><Icon name="envelope-circle-check" />Assign Global User</h3>
			<label>Email<input className="input" type="email" value={user.email} onChange={(event) => setUser((current) => ({ ...current, email: event.target.value }))} /></label>
			<label>Display name<input className="input" value={user.display_name} onChange={(event) => setUser((current) => ({ ...current, display_name: event.target.value }))} /></label>
			<label>Role<select className="input" value={user.role} onChange={(event) => setUser((current) => ({ ...current, role: event.target.value }))}><option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option></select></label>
			<p className="source-note">Email activation uses the shared global account flow. Owner accounts can never be provisioned with an admin-supplied password.</p>
			<button type="submit" className="primary-button"><Icon name="plus" />Assign and Send Email</button>
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

function AttentionQueuePanel({ loading, items, onOpenDevice }) {
  return (
    <section className="panel overview-panel attention-panel">
      <div className="panel-head">
        <div>
          <h2>Devices that need attention ({items.length})</h2>
          <p>Prioritized by current health, signal quality, and recent alerts.</p>
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

function Devices({ active, devices, serverPage, serverSource, selectedDevice, deviceDrawerOpen, me, setSelectedDeviceId, closeDeviceDrawer, onAction }) {
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
    fetchJSON(scopedCustomerAPI(`/api/devices/${selectedDevice.id}/telemetry`, cloudIdFromPath(window.location.pathname)))
      .then((payload) => {
        if (!alive) return;
        setTelemetryById((current) => ({
          ...current,
          [selectedDevice.id]: payload,
        }));
      })
      .catch((err) => {
        if (!alive) return;
        setTelemetryError('Telemetry is temporarily unavailable for this device.');
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
          <strong title={device.name}>{device.name}</strong>
          <small title={device.serial_number}>{device.serial_number}</small>
        </>
      ),
    },
    { key: 'model', label: 'Product Model', value: (device) => device.model, render: (device) => <span title={device.model}>{device.model}</span> },
    {
      key: 'firmware',
      label: 'Firmware Version',
      value: (device) => device.firmware_version_display,
      render: (device) => device.firmware_version_display,
    },
    {
      key: 'health',
      label: 'Device Health',
      value: (device) => device.health_display,
      render: (device) => <StatusBadge value={normalizeStatusKey(device.health_display)} label={device.health_display} />,
    },
    {
      key: 'readiness',
      label: 'Device Status',
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
      label: 'Action',
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
          View
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

  function updateServerQuery(next = {}) {
    const current = new URLSearchParams(window.location.search);
    const query = {
      q: next.q === undefined ? current.get('q') || '' : next.q,
      sort: next.sort === undefined ? current.get('sort') || '' : next.sort,
      direction: next.direction === undefined ? current.get('direction') || '' : next.direction,
      offset: next.offset === undefined ? current.get('offset') || '' : next.offset,
    };
    updateDevicesLocation(query);
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
          tableClassName="device-table"
          rowClassName={(device) => deviceDrawerOpen && selectedDevice?.id === device.id ? 'selected-row' : ''}
          onRowClick={(device) => setSelectedDeviceId(device.id)}
          serverMode={Boolean(serverPage)}
          serverTotal={serverPage?.total || 0}
          serverOffset={serverPage?.offset || 0}
          serverPageSize={serverPage?.limit || 100}
          onServerSearch={(value) => updateServerQuery({ q: value, offset: 0 })}
          onServerSort={(key, direction) => updateServerQuery({ sort: key, direction, offset: 0 })}
          onServerPage={(offset) => updateServerQuery({ offset })}
          paginationLabel="Devices"
          mobileContent={(
            <div className="mobile-device-list" aria-label="Compact device list">
              {tableRows.map((device) => (
                <button key={device.id} type="button" className="mobile-device-row" onClick={() => setSelectedDeviceId(device.id)}>
                  <span>
                    <strong>{device.name}</strong>
                    <small>{device.product_id || 'Product not set'} · {device.serial_number}</small>
                  </span>
                  <span>
                    <StatusBadge value={normalizeStatusKey(device.health_display)} label={device.health_display} />
                    <StatusBadge value={normalizeStatusKey(device.readiness)} label={device.readiness_display} />
                  </span>
                  <time title={device.last_seen_at || ''}>{device.last_seen_at ? formatRelativeTime(device.last_seen_at) : 'No transport evidence'}</time>
                  <span className="mobile-row-action" aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          )}
        />
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
              <button type="button" className="destructive" disabled={!deactivateState.enabled} title={deactivateState.reason} onClick={() => runDrawerAction('deactivate')}>Deactivate device</button>
              <small>{!deactivateState.enabled ? deactivateState.reason : 'Device setup and enrollment are handled by existing processes; only status and deactivation are shown here.'}</small>
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
      icon: 'list-check',
      value: (operation) => operationSummary(operation),
      render: (operation) => (
        <div className="operation-summary">
          <Icon name={operationIconName(operation.state)} />
          <strong>{operationSummary(operation)}</strong>
          <span className="operation-summary__raw">
            <small><Icon name="code" />{operation.type}</small>
            <small><StatusBadge value={operation.state} /></small>
          </span>
        </div>
      ),
    },
    { key: 'organization', label: 'Customer', icon: 'building', value: (operation) => operation.organization },
    { key: 'device_name', label: 'Device', icon: 'microchip', value: (operation) => operation.device_name },
    { key: 'updated_at', label: 'Updated', icon: 'clock', value: (operation) => operation.updated_at },
    { key: 'message', label: 'Message', icon: 'message', value: (operation) => operation.message },
  ], []);

  return (
    <section className="panel operations-page">
      <div className="panel-head">
        <div>
          <h2 className="heading-with-icon"><Icon name="list-check" />Lifecycle operations</h2>
          <p>Provisioning and deactivation commands projected from account/video contracts.</p>
        </div>
        <label className="operation-filter">
          <span><Icon name="traffic-light" />State</span>
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
  serverMode = false,
  serverTotal = 0,
  serverOffset = 0,
  serverPageSize = 100,
  onServerSearch,
  onServerSort,
  onServerPage,
  paginationLabel = 'List',
  mobileContent = null,
}) {
  const [serverFilter, setServerFilter] = useState('');
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
  const safeServerPageSize = Math.max(1, serverPageSize);
  const currentServerPage = Math.floor(serverOffset / safeServerPageSize) + 1;
  const maxServerPage = Math.max(1, Math.ceil(serverTotal / safeServerPageSize));
  const goToServerPage = (nextPage) => onServerPage?.((nextPage - 1) * safeServerPageSize);

  return (
    <>
      <div className="table-toolbar">
        <input aria-label={searchPlaceholder || "Search table"} value={serverMode ? serverFilter : filter} onChange={(event) => {
          if (serverMode) {
            setServerFilter(event.target.value);
            onServerSearch?.(event.target.value);
          } else {
            setFilter(event.target.value);
          }
        }} placeholder={searchPlaceholder} />
        <span>{serverMode ? `${serverTotal} Devices` : `${totalRows} of ${rows.length}`}</span>
      </div>
      {serverMode ? (
        <PaginationControls
          currentPage={currentServerPage}
          totalPages={maxServerPage}
          onPage={goToServerPage}
          ariaLabel={`${paginationLabel} pages (top)`}
          position="top"
        />
      ) : null}
      <div className="table-scroll-region">
        <table className={tableClassName}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} aria-sort={column.sortable === false ? undefined : sort.key === column.key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  {column.sortable === false ? (
                    <span className="data-table-heading">{column.icon ? <Icon name={column.icon} /> : null}{column.label}</span>
                  ) : (
                    <button className="sort-button" onClick={() => {
                        if (serverMode) {
                          const nextDirection = sort.key === column.key && sort.direction === 'asc' ? 'desc' : 'asc';
                          requestSort(column.key);
                          onServerSort?.(column.key, nextDirection);
                        } else {
                          requestSort(column.key);
                        }
                      }}>
                      <span className="data-table-heading">{column.icon ? <Icon name={column.icon} /> : null}{column.label}</span>
                      <span aria-hidden="true">{sort.key === column.key ? (sort.direction === 'asc' ? '^' : 'v') : '-'}</span>
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(serverMode ? rows : visibleRows).map((row) => (
              <tr
                key={rowKey(row)}
                className={[onRowClick ? 'clickable-row' : '', rowClassName ? rowClassName(row) : ''].filter(Boolean).join(' ')}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (event) => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onRowClick(row); } } : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key}>{column.render ? column.render(row) : displayValue(column.value(row))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mobileContent}
      {!(serverMode ? rows : visibleRows).length ? <p className="empty-table">{emptyLabel}</p> : null}
      <PaginationControls
        currentPage={serverMode ? currentServerPage : page}
        totalPages={serverMode ? maxServerPage : maxPage}
        onPage={serverMode ? goToServerPage : setPage}
        ariaLabel={`${paginationLabel} pages (bottom)`}
        position="bottom"
      />
    </>
  );
}

function PaginationControls({ currentPage, totalPages, onPage, ariaLabel, position }) {
  const items = paginationItems(currentPage, totalPages);
  return (
    <nav className={`pagination pagination-${position}`} aria-label={ariaLabel}>
      <span className="pagination-summary">Page {currentPage} of {totalPages}</span>
      <div className="pagination-page-list">
        <button
          type="button"
          className="pagination-arrow"
          aria-label="Previous page"
          disabled={currentPage <= 1}
          onClick={() => onPage(Math.max(1, currentPage - 1))}
        >
          ‹
        </button>
        {items.map((item, index) => item === 'ellipsis' ? (
          <span className="pagination-ellipsis" aria-hidden="true" key={`ellipsis-${index}`}>…</span>
        ) : (
          <button
            type="button"
            className={item === currentPage ? 'active' : ''}
            aria-label={`Page ${item}`}
            aria-current={item === currentPage ? 'page' : undefined}
            key={item}
            onClick={() => onPage(item)}
          >
            {item}
          </button>
        ))}
        <button
          type="button"
          className="pagination-arrow"
          aria-label="Next"
          disabled={currentPage >= totalPages}
          onClick={() => onPage(Math.min(totalPages, currentPage + 1))}
        >
          ›
        </button>
      </div>
    </nav>
  );
}

function paginationItems(currentPage, totalPages, maxVisible = 7) {
  if (totalPages <= maxVisible) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const edgeCount = maxVisible - 2;
  if (currentPage <= Math.ceil(edgeCount / 2) + 1) {
    return [...Array.from({ length: edgeCount }, (_, index) => index + 1), 'ellipsis', totalPages];
  }
  if (currentPage >= totalPages - Math.floor(edgeCount / 2)) {
    return [1, 'ellipsis', ...Array.from({ length: edgeCount }, (_, index) => totalPages - edgeCount + index + 1)];
  }

  const siblingCount = Math.floor((maxVisible - 4) / 2);
  return [
    1,
    'ellipsis',
    ...Array.from({ length: siblingCount * 2 + 1 }, (_, index) => currentPage - siblingCount + index),
    'ellipsis',
    totalPages,
  ];
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

function userRoleDetails(role) {
  const normalized = String(role || '').toLowerCase().replaceAll('-', '_');
  const roles = {
    owner: {
      title: 'Brand owner',
      icon: 'crown',
      description: 'You are responsible for the final management and ownership handover of this Brand Cloud.',
      actions: ['Manage team members and roles', 'Manage device, product, and operational capabilities under your brand', 'Securely transfer brand ownership to other members'],
    },
    admin: {
      title: 'Brand administrator',
      icon: 'user-shield',
      description: 'You help brand owners manage their teams and day-to-day operations, but you can’t transfer brand ownership.',
      actions: ['Invite, deactivate, or remove team members', 'Manage device, product, and operations settings', 'View reports and status at the brand level'],
    },
    member: {
      title: 'Team member',
      icon: 'user',
      description: 'You can use features that your team makes available to you; the visibility varies based on the scope of the assignment.',
      actions: ['View authorized devices and Products', 'Use daily actions allowed by the role', 'View status for your assigned scope'],
    },
    tenant_admin: {
      title: 'Organization administrator',
      icon: 'user-shield',
      description: 'You manage brand accounts, users, and overall device operations.',
      actions: ['Manage organization members and permissions', 'Manage overall device and operations settings', 'View status and reports at organization level'],
    },
    fleet_manager: {
      title: 'Device operations manager',
      icon: 'gauge-high',
      description: 'You are responsible for day-to-day device operations and maintenance within the assigned scope.',
      actions: ['Manage device enrollment and lifecycle', 'Check device and streaming health', 'Perform allowed firmware updates'],
    },
    installer: {
      title: 'Installer',
      icon: 'screwdriver-wrench',
      description: 'You are responsible for device installation, bundling, and activation for the specified site or group.',
      actions: ['Enroll and assign designated devices', 'Complete initial device setup', 'Check device readiness'],
    },
    firmware_operator: {
      title: 'Firmware update manager',
      icon: 'microchip',
      description: 'You are responsible for the specified range of firmware versions and update schedules.',
      actions: ['Check firmware versions and rollout status', 'Manage update schedules and release cadence', 'Monitor or cancel updates in progress'],
    },
    read_only_observer: {
      title: 'Read-only viewer',
      icon: 'eye',
      description: 'You can view operational information, but you can’t modify devices, settings, or member information.',
      actions: ['Check device and health status', 'View firmware, telemetry, and readiness information', 'View reports for authorized scopes'],
    },
    product_owner: {
      title: 'Product owner',
      icon: 'boxes-stacked',
      description: 'You are responsible for Product settings, collaborators, and associated devices.',
      actions: ['Manage Product settings and collaborators', 'Manage devices and updates for the Product', 'View Product reports'],
    },
    product_editor: {
      title: 'Product editor',
      icon: 'pen-to-square',
      description: 'You can maintain the assigned Product and work on the project, but you can’t transfer ownership.',
      actions: ['Edit the assigned Product', 'Manage related services and updates', 'View Product reports'],
    },
    product_viewer: {
      title: 'Product viewer',
      icon: 'eye',
      description: 'You can view assigned products and reports, but you cannot change the settings.',
      actions: ['View assigned Products', 'View device information', 'View Product reports'],
    },
  };
  return roles[normalized] || {
    title: normalized ? roleLabel(normalized) : 'No role data yet',
    icon: 'circle-user',
    description: normalized ? 'Your available features are determined by your current role and scope.' : 'If your role does not appear after refreshing, contact your brand administrator to confirm your membership settings.',
    actions: ['Use features authorized for your account', 'Access data and operations allowed by platform permissions'],
  };
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
  if (!response.ok) {
    const error = new Error(`${url} failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function browserSessionDestination(me, nextPath) {
  const rememberedCloudID = readCloudPreference(document.cookie);
  if (rememberedCloudID && preferredCloudID(me, rememberedCloudID) !== rememberedCloudID) {
    forgetCloudPreference();
  }
  return destinationForSession(me, nextPath, rememberedCloudID);
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

async function fetchRecentAlerts(devices, cloudId = '') {
  if (!devices.length) return [];
  const settled = await Promise.allSettled(
    devices.map((device) => fetchJSON(scopedCustomerAPI(`/api/devices/${device.id}/telemetry`, cloudId))),
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
  return new Intl.DateTimeFormat(FORMAT_LOCALE, { month: 'short', day: 'numeric' }).format(new Date(parsed));
}

function formatTrendAxisLabel(date, range) {
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) return { primary: date, secondary: '' };
  const value = new Date(parsed);
  const normalizedRange = String(range || '24h').toLowerCase();
  if (normalizedRange === '24h') {
    return {
      primary: new Intl.DateTimeFormat(FORMAT_LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false }).format(value),
      secondary: new Intl.DateTimeFormat(FORMAT_LOCALE, { month: 'short', day: 'numeric' }).format(value),
    };
  }
  if (normalizedRange === '7d') {
    return {
      primary: new Intl.DateTimeFormat(FORMAT_LOCALE, { weekday: 'short' }).format(value),
      secondary: new Intl.DateTimeFormat(FORMAT_LOCALE, { month: 'short', day: 'numeric' }).format(value),
    };
  }
  return {
    primary: new Intl.DateTimeFormat(FORMAT_LOCALE, { month: 'short', day: 'numeric' }).format(value),
    secondary: new Intl.DateTimeFormat(FORMAT_LOCALE, { year: 'numeric' }).format(value),
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

function updateDevicesLocation({ deviceId, health, status, signal, firmware, productID, q, sort, direction, offset } = {}) {
  const current = new URLSearchParams(window.location.search);
  const path = devicesPathWithFilters({
    cloudId: cloudIdFromPath(window.location.pathname),
    deviceId: deviceId === undefined ? current.get('device') || '' : deviceId,
    health: health === undefined ? current.get('health') || '' : health,
    status: status === undefined ? current.get('status') || '' : status,
    signal: signal === undefined ? current.get('signal') || '' : signal,
    firmware: firmware === undefined ? current.get('firmware') || '' : firmware,
    productID: productID === undefined ? current.get('product_id') || '' : productID,
    q: q === undefined ? current.get('q') || '' : q,
    sort: sort === undefined ? current.get('sort') || '' : sort,
    direction: direction === undefined ? current.get('direction') || '' : direction,
    offset: offset === undefined ? current.get('offset') || '' : offset,
  });
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const initialCanonicalPath = canonicalCustomerPath(window.location.pathname);
if (initialCanonicalPath !== window.location.pathname) {
  window.history.replaceState({}, '', `${initialCanonicalPath}${window.location.search}${window.location.hash}`);
}
const initialManagedCloudRoute = managedCloudRoute(window.location.pathname);
const usesManagedCloudApp = Boolean(initialManagedCloudRoute && (
  !initialManagedCloudRoute.cloudId || ['products', 'members', 'settings', 'test-lab'].includes(initialManagedCloudRoute.section)
));

document.documentElement.lang = i18n.language;
createRoot(document.getElementById('root')).render(
  <I18nextProvider i18n={i18n}>
    {handoffRoute(window.location.pathname) ? <OwnerHandoffPage /> : cloudBillingRoute(window.location.pathname) ? <CloudBillingApp /> : usesManagedCloudApp ? <MyCloudsApp /> : <App />}
  </I18nextProvider>,
);
