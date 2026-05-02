import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const DEFAULT_PAGE_SIZE = 8;

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
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let alive = true;
    async function loadData() {
      setError('');
      try {
        const nextMe = await fetchJSON('/api/me');
        if (!alive) return;
        setMe(nextMe);

        const useAdminApi = active === 'admin' && nextMe.kind === 'platform_admin';
        if (active === 'admin' && nextMe.kind !== 'platform_admin') {
          setSummary(null);
          setCustomers([]);
          setDevices([]);
          setOperations([]);
          setHealth([]);
          setAudit([]);
          return;
        }

        const prefix = useAdminApi ? '/api/admin' : '/api';
        const [nextSummary, nextCustomers, nextDevices, nextOperations, nextHealth, nextAudit] = await Promise.all([
          fetchJSON(`${prefix}/summary`),
          fetchJSON(`${prefix}/customers`),
          fetchJSON(`${prefix}/devices`),
          fetchJSON(`${prefix}/operations`),
          fetchJSON(`${prefix}/service-health`),
          fetchJSON(`${prefix}/audit`),
        ]);
        if (!alive) return;
        setSummary(nextSummary);
        setCustomers(nextCustomers);
        setDevices(nextDevices);
        setOperations(nextOperations);
        setHealth(nextHealth);
        setAudit(nextAudit);
      } catch (err) {
        if (alive) setError(err.message);
      }
    }
    loadData();
    return () => {
      alive = false;
    };
  }, [active, refreshTick]);

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
            {me?.authenticated ? <button onClick={handleLogout}>Logout</button> : null}
          </div>
        </header>

        {error ? <div className="error">{error}</div> : null}

        {active === 'console' ? <Dashboard summary={summary} health={health} operations={operations} me={me} onLogin={handleLogin} /> : null}
        {active === 'customers' ? <Customers customers={customers} /> : null}
        {active === 'devices' ? (
          <Devices
            devices={devices}
            selectedDevice={selectedDevice}
            setSelectedDeviceId={selectDevice}
            onAction={runDeviceAction}
          />
        ) : null}
        {active === 'operations' ? <Operations operations={operations} /> : null}
        {active === 'admin' ? <PlatformAdmin summary={summary} health={health} devices={devices} customers={customers} operations={operations} audit={audit} me={me} onLogin={handleLogin} /> : null}
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

function Devices({ devices, selectedDevice, setSelectedDeviceId, onAction }) {
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
    { key: 'video_cloud_devid', label: 'Video ID', value: (device) => device.video_cloud_devid },
    {
      key: 'readiness',
      label: 'Readiness',
      value: (device) => device.readiness,
      render: (device) => <StatusBadge value={device.readiness} />,
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
        <DataTable
          columns={columns}
          rows={devices}
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
  const columns = useMemo(() => [
    { key: 'type', label: 'Type', value: (operation) => operation.type },
    { key: 'organization', label: 'Customer', value: (operation) => operation.organization },
    { key: 'device_name', label: 'Device', value: (operation) => operation.device_name },
    {
      key: 'state',
      label: 'State',
      value: (operation) => operation.state,
      render: (operation) => <StatusBadge value={operation.state} />,
    },
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
      </div>
      <DataTable
        columns={columns}
        rows={operations}
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
