import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const navItems = [
  { id: 'console', label: 'Customer Fleet' },
  { id: 'devices', label: 'Devices' },
  { id: 'operations', label: 'Provisioning' },
  { id: 'admin', label: 'Platform Admin' },
];

function App() {
  const [active, setActive] = useState('console');
  const [summary, setSummary] = useState(null);
  const [devices, setDevices] = useState([]);
  const [operations, setOperations] = useState([]);
  const [health, setHealth] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const loadData = () => {
    let alive = true;
    Promise.all([
      fetchJSON('/api/summary'),
      fetchJSON('/api/devices'),
      fetchJSON('/api/operations'),
      fetchJSON('/api/service-health'),
    ])
      .then(([nextSummary, nextDevices, nextOperations, nextHealth]) => {
        if (!alive) return;
        setSummary(nextSummary);
        setDevices(nextDevices);
        setOperations(nextOperations);
        setHealth(nextHealth);
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

  async function runDeviceAction(deviceId, action) {
    setError('');
    const response = await fetch(`/api/devices/${deviceId}/${action}`, { method: 'POST' });
    if (!response.ok) {
      setError(`${action} failed with ${response.status}`);
      return;
    }
    loadData();
    setActive('operations');
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">R</span>
          <div>
            <strong>RTK Cloud</strong>
            <small>Admin Console</small>
          </div>
        </div>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={active === item.id ? 'active' : ''}
              onClick={() => setActive(item.id)}
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
          <div className="env-pill">Demo data via Go + SQLite</div>
        </header>

        {error ? <div className="error">{error}</div> : null}

        {active === 'console' ? <Dashboard summary={summary} health={health} operations={operations} /> : null}
        {active === 'devices' ? (
          <Devices devices={filteredDevices} query={query} setQuery={setQuery} onAction={runDeviceAction} />
        ) : null}
        {active === 'operations' ? <Operations operations={operations} /> : null}
        {active === 'admin' ? <PlatformAdmin summary={summary} health={health} devices={devices} /> : null}
      </main>
    </div>
  );
}

function Dashboard({ summary, health, operations }) {
  return (
    <>
      <MetricGrid summary={summary} />
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

function Devices({ devices, query, setQuery, onAction }) {
  return (
    <section className="panel">
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
            <tr key={device.id}>
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
                  <button onClick={() => onAction(device.id, 'provision')}>Provision</button>
                  <button onClick={() => onAction(device.id, 'deactivate')}>Deactivate</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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

function PlatformAdmin({ summary, health, devices }) {
  const customers = summary?.customers ?? '-';
  return (
    <>
      <section className="panel split-panel">
        <div>
          <h2>Platform Operations</h2>
          <p>Cross-customer view for support and service operators.</p>
          <div className="admin-kpis">
            <div><strong>{customers}</strong><span>Customers</span></div>
            <div><strong>{devices.length}</strong><span>Devices cached</span></div>
          </div>
        </div>
        <ServiceHealth health={health} compact />
      </section>
    </>
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
        </div>
      ))}
    </section>
  );
}

function StatusBadge({ value }) {
  return <span className={`status status-${String(value).replaceAll('_', '-')}`}>{value}</span>;
}

function titleFor(active) {
  return {
    console: 'Customer Fleet',
    devices: 'Devices',
    operations: 'Provisioning',
    admin: 'Platform Operations',
  }[active];
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} failed with ${response.status}`);
  return response.json();
}

createRoot(document.getElementById('root')).render(<App />);
