export function isReadOnlyRole(role) {
  const normalized = String(role || '').toLowerCase().replaceAll('-', '_');
  return ['viewer', 'observer', 'read_only', 'readonly', 'read_only_observer'].includes(normalized);
}

export function deviceActionState(device, action, { readOnly = false, telemetryStatus = '' } = {}) {
  if (!device) return { enabled: false, reason: 'No device selected.' };
  if (readOnly) {
    return { enabled: false, reason: 'Read-only Observer cannot change device lifecycle.' };
  }
  if (telemetryStatus === 'unavailable') {
    return { enabled: false, reason: 'Device telemetry source is unavailable.' };
  }
  const readiness = String(device?.readiness || '').toLowerCase();
  if (action === 'deactivate') {
    if (readiness === 'deactivated') return { enabled: false, reason: 'Device is already deactivated.' };
    if (readiness === 'deactivation_pending') return { enabled: false, reason: 'Deactivation is already pending.' };
    return { enabled: true, reason: '' };
  }
  if (readiness === 'online' || readiness === 'activated') {
    return { enabled: false, reason: 'Device is already activated.' };
  }
  if (readiness === 'deactivation_pending') {
    return { enabled: false, reason: 'Device is waiting for deactivation.' };
  }
  return { enabled: true, reason: '' };
}
