import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const navItems = [
  { id: 'console', label: 'Customer Fleet', path: '/console' },
  { id: 'customers', label: 'Customers', path: '/console/customers' },
  { id: 'devices', label: 'Devices', path: '/console/devices' },
  { id: 'operations', label: 'Provisioning', path: '/console/operations' },
  { id: 'admin', label: 'Platform Admin', path: '/admin' },
  { id: 'audit', label: 'Audit', path: '/console/audit' },
];

function App() {
  const [active, setActive] = useState(routeFromLocation());
  const [me, setMe] = useState(null);
  const [summary, setSummary] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [operations, setOperations] = useState([]);
  const [health, setHealth] = useState([]);
  const [audit, setAudit] = useState([]);
  const [query, setQuery] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [error, setError] = useState('');

  const loadData = () => {
    let alive = true;
    Promise.all([
      fetchJSON('/api/me'),
      fetchJSON('/api/summary'),
      fetchJSON('/api/customers'),
      fetchJSON('/api/devices'),
      fetchJSON('/api/operations'),
      fetchJSON('/api/service-health'),
      fetchJSON('/api/audit'),
    ])
      .then(([nextMe, nextSummary, nextCustomers, nextDevices, nextOperations, nextHealth, nextAudit]) => {
        if (!alive) return;
        setMe(nextMe);
        setSummary(nextSummary);
        setCustomers(nextCustomers);
        setDevices(nextDevices);
        setOperations(nextOperations);
        setHealth(nextHealth);
        setAudit(nextAudit);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  };

  useEffect(() => {
    return loadData();
  }, []);

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

  function selectDevice(deviceId) {
    setSelectedDeviceId(deviceId);
    const path = '/console/devices';
    window.history.pushState({}, '', `${path}?device=${encodeURIComponent(deviceId)}`);
    setActive('devices');
  }

  async function runDeviceAction(deviceId, action) {
    setError('');
    const response = await fetch(`/api/devices/${deviceId}/${action}`, { method: 'POST' });
    if (!response.ok) {
      setError(`${action} failed with ${response.status}`);
      return;
    }
    loadData();
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
    loadData();
  }

  const filteredDevices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return devices;
    return devices.filter((device) =>
      [device.name, device.organization, device.model, device.serial_number, device.readiness]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [devices, query]);

  const selectedDevice = useMemo(() => {
    if (!devices.length) return null;
    return devices.find((device) => device.id === selectedDeviceId) || filteredDevices[0] || devices[0];
  }, [devices, filteredDevices, selectedDeviceId]);

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
        <nav>
          {navItems.map((item) => (
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
            <span>{me?.active_org_id || 'all orgs'}</span>
          </div>
        </header>

        {error ? <div className="error">{error}</div> : null}

        {active === 'console' ? <Dashboard summary={summary} health={health} operations={operations} me={me} onLogin={handleLogin} /> : null}
        {active === 'customers' ? <Customers customers={customers} /> : null}
        {active === 'devices' ? (
          <Devices
            devices={filteredDevices}
            query={query}
            selectedDevice={selectedDevice}
            setQuery={setQuery}
            setSelectedDeviceId={selectDevice}
            onAction={runDeviceAction}
          />
        ) : null}
        {active === 'operations' ? <Operations operations={operations} /> : null}
        {active === 'admin' ? <PlatformAdmin summary={summary} health={health} devices={devices} customers={customers} audit={audit} me={me} onLogin={handleLogin} /> : null}
        {active === 'audit' ? <AuditLog audit={audit} /> : null}
      </main>
    </div>
  );
}

function Dashboard({ summary, health, operations, me, onLogin }) {
  return (
    <>
      <MetricGrid summary={summary} />
      {!me?.authenticated ? <LoginPanel mode="customer" title="Customer Account Manager login" onLogin={onLogin} /> : null}
      <section className="panel split-panel">
        <div>
          <h2>Lifecycle focus</h2>
          <p>Provisioning and readiness use the shared contract vocabulary.</p>
          <div className="timeline">
            <span>registered</span>
            <span>cloud_activation_pending</span>
            <span>activated</span>
            <span>online</span>
          </div>
        </div>
        <div>
          <h2>Recent operations</h2>
          <OperationList operations={operations.slice(0, 3)} />
        </div>
      </section>
      <ServiceHealth health={health} />
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

function Devices({ devices, query, selectedDevice, setQuery, setSelectedDeviceId, onAction }) {
  return (
    <section className="device-workspace">
      <div className="panel device-table-panel">
        <div className="panel-head">
          <div>
            <h2>Device fleet</h2>
            <p>Registry, video identity, readiness, and last known status.</p>
          </div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search devices" />
        </div>
        <table>
          <thead>
            <tr>
              <th>Device</th>
              <th>Customer</th>
              <th>Model</th>
              <th>Video ID</th>
              <th>Readiness</th>
              <th>Last seen</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr
                key={device.id}
                className={selectedDevice?.id === device.id ? 'selected-row' : ''}
                onClick={() => setSelectedDeviceId(device.id)}
              >
                <td>
                  <strong>{device.name}</strong>
                  <small>{device.serial_number}</small>
                </td>
                <td>{device.organization}</td>
                <td>{device.model}</td>
                <td>{device.video_cloud_devid}</td>
                <td><StatusBadge value={device.readiness} /></td>
                <td>{device.last_seen_at || 'No transport evidence'}</td>
                <td>
                  <div className="row-actions">
                    <button onClick={(event) => runRowAction(event, onAction, device.id, 'provision')}>Provision</button>
                    <button onClick={(event) => runRowAction(event, onAction, device.id, 'deactivate')}>Deactivate</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DeviceDetail device={selectedDevice} onAction={onAction} />
    </section>
  );
}

function Customers({ customers }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Customers</h2>
          <p>Organization-level fleet health aggregated from cached device projections.</p>
        </div>
      </div>
      <table className="customers-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Total</th>
            <th>Online</th>
            <th>Activated</th>
            <th>Pending</th>
            <th>Failed</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((customer) => (
            <tr key={customer.organization_id}>
              <td>
                <strong>{customer.organization}</strong>
                <small>{customer.organization_id}</small>
              </td>
              <td>{customer.total_devices}</td>
              <td>{customer.online_devices}</td>
              <td>{customer.activated_devices}</td>
              <td>{customer.pending_devices}</td>
              <td>{customer.failed_devices}</td>
              <td>{customer.last_seen_at || 'No activity'}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
        <div><dt>Video Cloud ID</dt><dd>{device.video_cloud_devid}</dd></div>
        <div><dt>Registry status</dt><dd>{device.status}</dd></div>
        <div><dt>Last seen</dt><dd>{device.last_seen_at || 'No transport evidence'}</dd></div>
      </dl>
      <div className="readiness-steps">
        {['registered', 'cloud_activation_pending', 'activated', 'online'].map((step) => (
          <span key={step} className={device.readiness === step ? 'current' : ''}>{step}</span>
        ))}
      </div>
      <div className="source-facts">
        <h3>Source facts</h3>
        {(device.source_facts?.length ? device.source_facts : fallbackFacts(device)).map((fact) => (
          <article className="source-fact" key={`${fact.layer}-${fact.state}-${fact.operation_id || ''}`}>
            <div>
              <strong>{fact.layer}</strong>
              <span>{fact.detail}</span>
              {fact.error_code ? <small>{fact.error_code}</small> : null}
              {fact.operation_id ? <small>{fact.operation_id}</small> : null}
            </div>
            <StatusBadge value={fact.state || 'missing'} />
          </article>
        ))}
      </div>
      <div className="detail-actions">
        <button onClick={() => onAction(device.id, 'provision')}>Provision device</button>
        <button onClick={() => onAction(device.id, 'deactivate')}>Deactivate device</button>
      </div>
    </aside>
  );
}

function Operations({ operations }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Lifecycle operations</h2>
          <p>Provisioning and deactivation commands projected from account/video contracts.</p>
        </div>
      </div>
      <OperationList operations={operations} detailed />
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

function PlatformAdmin({ summary, health, devices, customers, audit, me, onLogin }) {
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
      <Customers customers={customers} />
      <AuditLog audit={audit.slice(0, 5)} compact />
    </>
  );
}

function AuditLog({ audit, compact = false }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{compact ? 'Recent audit' : 'Audit log'}</h2>
          <p>Local operator actions captured by the Go BFF.</p>
        </div>
      </div>
      {audit.length ? (
        <div className="audit-list">
          {audit.map((event) => (
            <article className="audit-event" key={event.id}>
              <div>
                <strong>{event.action}</strong>
                <span>{event.actor} / {event.target}</span>
              </div>
              <time>{event.created_at}</time>
            </article>
          ))}
        </div>
      ) : (
        <p>No audit events yet.</p>
      )}
    </section>
  );
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

function StatusBadge({ value }) {
  return <span className={`status status-${String(value).replaceAll('_', '-')}`}>{value}</span>;
}

function titleFor(active) {
  return {
    console: 'Customer Fleet',
    customers: 'Customers',
    devices: 'Devices',
    operations: 'Provisioning',
    admin: 'Platform Operations',
    audit: 'Audit',
  }[active];
}

function routeFromLocation() {
  const path = window.location.pathname;
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  if (path === '/console/customers') return 'customers';
  if (path === '/console/devices') return 'devices';
  if (path === '/console/operations') return 'operations';
  if (path === '/console/audit') return 'audit';
  return 'console';
}

function fallbackFacts(device) {
  return [
    {
      layer: 'account_registry',
      state: device.id ? 'present' : 'missing',
      detail: device.id ? 'Registry device exists in current projection.' : 'Missing registry device id.',
    },
    {
      layer: 'cloud_activation',
      state: device.video_cloud_devid ? 'present' : 'missing',
      detail: device.video_cloud_devid ? 'Video Cloud device identity is present.' : 'Missing video_cloud_devid.',
    },
    {
      layer: 'transport_online',
      state: device.last_seen_at ? device.status : 'stale',
      detail: device.last_seen_at ? `Last transport evidence at ${device.last_seen_at}.` : 'No recent transport evidence.',
    },
  ];
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} failed with ${response.status}`);
  return response.json();
}

function runRowAction(event, onAction, deviceId, action) {
  event.stopPropagation();
  onAction(deviceId, action);
}

createRoot(document.getElementById('root')).render(<App />);
