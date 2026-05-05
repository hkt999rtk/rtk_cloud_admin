import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { customerNavItems, platformNavItems, routeFromLocation, titleFor } from './routes.mjs';
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
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [overviewWindow, setOverviewWindow] = useState('7d');
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const isPlatformView = active.startsWith('platform');
  const visibleNavItems = isPlatformView ? platformNavItems : customerNavItems;
  const needsPlatformAccess = isPlatformView && me?.kind !== 'platform_admin';

  useEffect(() => {
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

        if (nextMe.authenticated && nextMe.kind === 'customer' && !useAdminApi) {
          const [nextFleetHealth, nextStreamStats] = await Promise.all([
            fetchJSON(`/api/fleet/health-summary?window=${overviewWindow}`),
            fetchJSON(`/api/fleet/stream-stats?window=${overviewWindow}`),
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
  }, [active, overviewWindow, refreshTick]);

  useEffect(() => {
    const onPopState = () => setActive(routeFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deviceId = params.get('device');
    if (deviceId) setSelectedDeviceId(deviceId);
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
    const path = '/console/devices';
    window.history.pushState({}, '', `${path}?device=${encodeURIComponent(deviceId)}`);
    setActive('devices');
  }

  function filterDevicesByHealth(healthState) {
    const path = '/console/devices';
    window.history.pushState({}, '', `${path}?health=${encodeURIComponent(healthState)}`);
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
    if (!devices.length) return null;
    return devices.find((device) => device.id === selectedDeviceId) || devices[0];
  }, [devices, selectedDeviceId]);

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
          />
        ) : null}
        {!needsPlatformAccess && active === 'devices' ? (
          <Devices
            active={active}
            devices={devices}
            selectedDevice={selectedDevice}
            setSelectedDeviceId={selectDevice}
            onAction={runDeviceAction}
          />
        ) : null}
        {!needsPlatformAccess && active === 'operations' ? <Operations operations={operations} /> : null}
        {!needsPlatformAccess && active === 'firmware-ota' ? <FirmwareOTAPage /> : null}
        {!needsPlatformAccess && active === 'stream-health' ? <StreamHealthPage /> : null}
        {!needsPlatformAccess && active === 'groups' ? <GroupsPage /> : null}
        {!needsPlatformAccess && active === 'platform-health' ? <PlatformHealth summary={summary} health={health} /> : null}
        {!needsPlatformAccess && active === 'platform-operations' ? <Operations operations={operations} /> : null}
        {!needsPlatformAccess && active === 'platform-audit' ? <AuditLog audit={audit} /> : null}
      </main>
    </div>
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
}) {
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

      <RecentAlertsPanel loading={loading} alerts={recentAlerts} />
    </div>
  );
}

function FirmwareOTAPage() {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Firmware &amp; OTA</h2>
          <p>Firmware policy and rollout staging is in progress and will be added in this section.</p>
        </div>
      </div>
      <p className="placeholder-subtitle">This section is a temporary placeholder while the OTA workflow is being integrated.</p>
    </section>
  );
}

function StreamHealthPage() {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Stream Health</h2>
          <p>Stream diagnostics and quality summaries will be available in the next milestone.</p>
        </div>
      </div>
      <p className="placeholder-subtitle">Placeholder area for customer-facing stream observability insights.</p>
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

function Devices({ active, devices, selectedDevice, setSelectedDeviceId, onAction }) {
  const [readinessFilter, setReadinessFilter] = useState('All');
  const [healthFilter, setHealthFilter] = useState('All');
  const [signalFilter, setSignalFilter] = useState('All');
  const [firmwareFilter, setFirmwareFilter] = useState('All');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const health = params.get('health');
    if (health) {
      setHealthFilter(toTitleCase(health));
    } else {
      setHealthFilter('All');
    }
  }, [active]);

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
          <button type="button" onClick={() => { setReadinessFilter('All'); setHealthFilter('All'); setSignalFilter('All'); setFirmwareFilter('All'); }}>
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
          rowClassName={(device) => selectedDevice?.id === device.id ? 'selected-row' : ''}
          onRowClick={(device) => setSelectedDeviceId(device.id)}
        />
      </div>
      <DeviceDetail device={selectedDevice} onAction={onAction} />
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

function DeviceDetail({ device, onAction }) {
  if (!device) {
    return (
      <aside className="panel detail-panel">
        <h2>Device detail</h2>
        <p>No device selected.</p>
      </aside>
    );
  }

  return (
    <aside className="panel detail-panel">
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Selected device</p>
          <h2>{device.name}</h2>
        </div>
        <StatusBadge value={device.readiness} />
      </div>
      <dl>
        <div><dt>Customer</dt><dd>{device.organization}</dd></div>
        <div><dt>Model</dt><dd>{device.model}</dd></div>
        <div><dt>Serial</dt><dd>{device.serial_number}</dd></div>
        <div><dt>Firmware</dt><dd>{device.firmware_version || '—'}</dd></div>
        <div><dt>Health</dt><dd>{device.health || 'Unknown'}</dd></div>
        <div><dt>Signal</dt><dd>{device.signal_quality || '—'}</dd></div>
        <div><dt>Registry status</dt><dd>{device.status}</dd></div>
        <div><dt>Last seen</dt><dd>{device.last_seen_at || 'No transport evidence'}</dd></div>
      </dl>
      <div className="readiness-steps">
        {['registered', 'cloud_activation_pending', 'activated', 'online'].map((step) => (
          <span key={step} className={device.readiness === step ? 'current' : ''}>{formatReadinessLabel(step)}</span>
        ))}
      </div>
      <div className="source-facts">
        <h3>Source facts</h3>
        {(device.source_facts || []).length ? (device.source_facts || []).map((fact) => (
          <article className="source-fact" key={`${fact.layer}-${fact.state}-${fact.operation_id || ''}`}>
            <div>
              <strong>{fact.layer}</strong>
              <span>{fact.detail}</span>
              {fact.updated_at ? <time>{fact.updated_at}</time> : null}
              {fact.error_code ? <small>{fact.error_code}</small> : null}
              {fact.operation_id ? <small>{fact.operation_id}</small> : null}
              {fact.state === 'failed' ? <small>{fact.retryable ? 'retryable' : 'not retryable'}</small> : null}
            </div>
            <StatusBadge value={fact.state || 'missing'} />
          </article>
        )) : <p>No source facts available.</p>}
      </div>
      <div className="detail-actions">
        <button onClick={() => onAction(device.id, 'provision')}>Provision device</button>
        <button onClick={() => onAction(device.id, 'deactivate')}>Deactivate device</button>
      </div>
    </aside>
  );
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

function runRowAction(event, onAction, deviceId, action) {
  event.stopPropagation();
  onAction(deviceId, action);
}

createRoot(document.getElementById('root')).render(<App />);
