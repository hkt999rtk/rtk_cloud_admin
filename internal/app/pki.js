'use strict';
const $ = id => document.getElementById(id);
let operation, issuer, next = '';
const message = text => { $('message').textContent = text; };
// Reuse the same key after an uncertain network response to the same payload.
// Keys contain no credential material and survive accidental page reloads.
async function request(path, body, method = 'POST', prefix = '/api/platform/pki') {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prefix + path + '\0' + payload)))).map(x => x.toString(16).padStart(2, '0')).join('');
  const storage = 'pki-request-' + digest;
  let key = sessionStorage.getItem(storage);
  if (!key) { key = crypto.randomUUID(); sessionStorage.setItem(storage, key); }
  const response = await fetch(prefix + path, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: method === 'GET' ? undefined : payload });
  if (!response.ok) throw new Error(response.status === 403 ? 'Request denied. Check recent MFA, exact roles, independent approvals and issuer state.' : 'Request failed (' + response.status + '). Reload the operation before retrying.');
  if (response.status === 204) return null;
  return response.json();
}
function bind(id, fn) {
  $(id).addEventListener('submit', async event => {
    event.preventDefault(); const buttons = [...event.target.querySelectorAll('button')]; buttons.forEach(x => x.disabled = true);
    try { await fn(Object.fromEntries(new FormData(event.target))); } catch (error) { message(error.message); }
    finally { buttons.forEach(x => x.disabled = false); }
  });
}
async function loadOperation(id) {
  operation = null; issuer = null; $('download').disabled = true; $('operationDetail').textContent = ''; $('issuerDetail').textContent = '';
  const value = await request('/operations/' + encodeURIComponent(id), undefined, 'GET');
  const authority = await request('/issuers/' + value.issuer_id, undefined, 'GET');
  operation = value; issuer = authority; $('operation').value = id;
  $('operationDetail').textContent = JSON.stringify(value, null, 2); $('issuerDetail').textContent = JSON.stringify(authority, null, 2); $('download').disabled = false;
  message('Loaded operation ' + value.operation_id + ' (' + value.status + ').');
}
async function list(append = false) {
  const collection = $('collection').value;
  const page = await request('/' + collection + '/search', { limit: 25, before: append ? next : '' });
  if (!append) $('records').replaceChildren();
  for (const item of page.items) {
    const row = document.createElement('tr');
    const values = [item.operation_id || item.issuer_id, item.action || item.kind, item.status, item.device_item_profile_id || item.brand_cloud_id || item.issuer_id];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      if (index === 0 && item.operation_id) { const button = document.createElement('button'); button.textContent = value; button.onclick = () => loadOperation(value).catch(e => message(e.message)); cell.append(button); }
      else cell.textContent = value || ''; row.append(cell);
    }); $('records').append(row);
  }
  next = page.next || ''; $('more').hidden = !next;
}
$('refresh').onclick = () => list().catch(e => message(e.message));
$('more').onclick = () => list(true).catch(e => message(e.message));
$('collection').onchange = () => list().catch(e => message(e.message));
bind('login', async body => {
  const response = await fetch('/api/pki/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('MFA login unavailable. Verify the configured OIDC provider and console session.');
  const result = await response.json(); window.location.assign(result.redirect_url);
});
bind('create', async body => { for (const key of Object.keys(body)) if (!body[key]) delete body[key]; const result = await request('/operations', body); await loadOperation(result.operation_id); });
bind('lookup', body => loadOperation(body.operation.trim()));
bind('approve', async body => {
  if (!operation) throw new Error('Load and review an operation first.');
  await request('/operations/' + operation.operation_id + '/approvals', { role: body.role, request_sha256: operation.request_sha256 }); await loadOperation(operation.operation_id);
});
bind('action', async body => {
  if (!operation) throw new Error('Load and review an operation first.');
  if (/PRIVATE KEY/.test(body.pem)) throw new Error('Private key material must stay in offline custody or OpenBao.');
  let input = {};
  if (body.action === 'provision') input = { csr_pem: body.pem.trim() };
  if (body.action === 'import') { if (!body.pem.trim()) throw new Error('Paste the public CA certificate.'); input = { certificate_pem: body.pem.trim() }; }
  await request('/operations/' + operation.operation_id + '/' + body.action, input); await loadOperation(operation.operation_id);
});
bind('lifecycle', async body => { const result = await request('/issuers/' + encodeURIComponent(body.issuer_id) + '/operations', body); await loadOperation(result.operation_id); });
$('download').onclick = () => {
  if (!issuer) return; const url = URL.createObjectURL(new Blob([JSON.stringify(issuer, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'issuer-' + issuer.issuer_id + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};

bind('crl', async body => {
  if (/PRIVATE KEY/.test(body.crl_pem)) throw new Error('Only a public CRL is accepted.');
  const result = await request('/issuers/' + encodeURIComponent(body.issuer) + '/crl', {crl_pem: body.crl_pem.trim()});
  message('Published CRL ' + result.crl_number + '. Awaiting consumer acknowledgments for ' + result.crl_sha256 + '.');
});

let recovery;
async function loadRecovery(id) {
  recovery = null; $('recoveryDetail').textContent = '';
  const result = await request('/' + encodeURIComponent(id), undefined, 'GET', '/api/platform/admin-recovery');
  recovery = result; $('recoveryID').value = result.request_id;
  $('recoveryDetail').textContent = JSON.stringify(result, null, 2);
  message('Recovery request ' + result.request_id + ': ' + result.status + '.');
}
bind('recover', async body => { const result = await request('', body, 'POST', '/api/platform/admin-recovery'); await loadRecovery(result.request_id); });
bind('recoveryLookup', body => loadRecovery(body.request_id.trim()));
bind('recoveryApprove', async body => {
  if (!recovery) throw new Error('Review a recovery request first.');
  await request('/' + recovery.request_id + '/approve', {role: body.role, request_sha256: recovery.request_sha256}, 'POST', '/api/platform/admin-recovery');
  await loadRecovery(recovery.request_id);
});
bind('recoveryAction', async body => {
  if (!recovery) throw new Error('Review a recovery request first.');
  await request('/' + recovery.request_id + '/' + body.action, {}, 'POST', '/api/platform/admin-recovery');
  await loadRecovery(recovery.request_id);
});

$('downloadDistrust').onclick = async () => {
  try {
    if (!issuer || issuer.kind !== 'root' || !['revoked', 'compromised'].includes(issuer.status)) throw new Error('Load an executed Root CA revocation first.');
    const policy = await request('/issuers/' + encodeURIComponent(issuer.issuer_id) + '/distrust', undefined, 'GET');
    const url = URL.createObjectURL(new Blob([JSON.stringify(policy, null, 2)], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'root-distrust-' + policy.version + '.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message('Downloaded policy ' + policy.policy_sha256 + '. Consumers must remove the roots, reload their runtime trust pool, and acknowledge the exact policy.');
  } catch (error) { message(error.message); }
};


bind('replacementReconcile', async body => {
  const result = await request('/issuers/' + encodeURIComponent(body.issuer.trim()) + '/reconcile-replacement', {request_id: body.request_id.trim(), serial_number: body.serial_number.trim()});
  $('replacementResult').textContent = JSON.stringify(result, null, 2);
  message('Existing renewal certificate recovered. The device can retry its original renewal request, install the successor and acknowledge using successor mTLS.');
});
