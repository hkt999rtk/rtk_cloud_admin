import { cloudAPI } from './managed-clouds.mjs';

export function sharingPath(cloudId, collection, id = '', action = '') {
  if (!['members', 'members/invitations'].includes(collection)) throw new Error('Invalid collection');
  if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid target');
  if (action && (!id || !(collection === 'members' ? ['enable', 'disable'] : ['resend', 'cancel']).includes(action))) throw new Error('Invalid action');
  return `${cloudAPI(cloudId)}/${collection}${id ? `/${id}` : ''}${action ? `/${action}` : ''}`;
}

export function sharingBody(form) {
  if (!['viewer', 'admin', 'member'].includes(form.role)) throw new Error('Ownership changes require a transfer.');
  const body = { role: form.role };
  if (!form.userId) {
    if (!form.email?.trim()) throw new Error('Enter the verified developer’s email.');
    body.email = form.email.trim();
  }
  if (form.role === 'viewer') {
    if (form.kind === 'all_products') {
      if (!form.confirmAll) throw new Error('Confirm access to all current and future Products.');
      body.access_scope = { kind: 'all_products' };
    } else {
      const ids = [...new Set(form.productIds || [])].sort();
      if (!ids.length || ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))) throw new Error('Select at least one Product.');
      body.access_scope = { kind: 'selected_products', product_ids: ids };
    }
  }
  return body;
}

export function sharingScopeLabel(record) {
  if (record.role !== 'viewer') return `${record.role}: existing cloud-role permissions (not read-only)`;
  if (record.access_scope?.kind === 'all_products') return 'Read-only: all current and future Products';
  if (record.access_scope?.kind === 'selected_products') return `Read-only: ${record.access_scope.product_ids.join(', ')}`;
  return 'Scope unavailable — refresh before changing access';
}

export function sharingError(error) {
  if (error?.status === 409) return 'The invitation or membership conflicts with current state. Existing scope has NOT changed. Refresh; cancel the pending invitation before creating a different scope.';
  if (error?.status === 401) return 'Session expired. Sign in again before continuing.';
  if ([403, 404].includes(error?.status)) return 'Owner authority, invitation, or selected Product access is no longer available.';
  if ([400, 422].includes(error?.status)) return 'Check the email, role and Product scope. The invitee must already be registered and verified.';
  return 'Sharing is temporarily unavailable. Retry the same request.';
}
