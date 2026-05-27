export function isReadOnlyRole(role) {
  const normalized = String(role || '').toLowerCase().replaceAll('-', '_');
  return ['viewer', 'observer', 'read_only', 'readonly', 'read_only_observer'].includes(normalized);
}

export function canUseCapability(subject, capability) {
  const values = [
    ...(Array.isArray(subject?.capabilities) ? subject.capabilities : []),
    ...(Array.isArray(subject?.permissions) ? subject.permissions : []),
    ...(Array.isArray(subject?.memberships) ? subject.memberships.flatMap((membership) => membership?.capabilities || []) : []),
  ];
  return values.includes(capability);
}

function requiredLifecycleCapability(action) {
  return action === 'deactivate' ? 'customer.devices.deactivate' : 'customer.devices.provision';
}

export function deviceActionState(device, action, { readOnly = false, telemetryStatus = '', capabilities } = {}) {
  if (!device) return { enabled: false, reason: 'No device selected.' };
  if (Array.isArray(capabilities) && !capabilities.includes(requiredLifecycleCapability(action))) {
    return { enabled: false, reason: 'Your session does not have permission for this lifecycle action.' };
  }
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
