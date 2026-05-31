const sourceLabels = {
  telemetry: 'Telemetry',
  firmware: 'Firmware',
  stream: 'Stream',
  source: 'Source',
};

const sensitiveSourcePatterns = [
  /video_cloud_devid/i,
  /operation_id/i,
  /upstream_operation_id/i,
  /raw_payload/i,
  /dead_lettered/i,
  /\{.*\}/,
];

export function sourceAvailable(source) {
  return source?.source_status === 'available';
}

export function sourceMessage(source, fallback) {
  if (!source) return fallback;
  if (source.source_message) return sanitizeSourceMessage(source.source_message, fallback);
  switch (source.source_status) {
    case 'not_configured':
      return fallback;
    case 'no_data':
      return 'No data in selected window.';
    case 'unavailable':
      return 'Source is unavailable.';
    case 'unauthorized':
      return 'Session expired; please sign in again.';
    default:
      return fallback;
  }
}

export function sourceUnavailableFromError(category = 'source', error) {
  const label = sourceLabel(category);
  return {
    source_status: 'unavailable',
    source_kind: category,
    source_error: 'gateway',
    source_message: `${label} source could not be reached.`,
  };
}

export function sourceStateForPanel({
  loading = false,
  source = null,
  hasData = false,
  filtered = false,
  error = '',
  category = 'source',
  emptyMessage,
  filteredEmptyMessage,
  fallbackMessage,
} = {}) {
  const label = sourceLabel(category);
  const fallback = fallbackMessage || `${label} source is unavailable.`;
  if (loading && !source && !error) {
    return {
      kind: 'loading',
      title: `Loading ${label.toLowerCase()} data`,
      message: `Loading ${label.toLowerCase()} data.`,
    };
  }
  if (error) {
    return {
      kind: 'gateway-error',
      title: `${label} gateway error`,
      message: sanitizeSourceMessage(error, `${label} source could not be reached.`),
    };
  }
  if (source?.source_error === 'gateway') {
    return {
      kind: 'gateway-error',
      title: `${label} gateway error`,
      message: sourceMessage(source, `${label} source could not be reached.`),
    };
  }
  if (sourceAvailable(source)) {
    if (hasData) {
      return { kind: 'ready', title: `${label} source available`, message: sourceMessage(source, `${label} source available.`) };
    }
    if (filtered) {
      return { kind: 'filtered-empty', title: 'No matching data', message: filteredEmptyMessage || 'No records match the current filters.' };
    }
    return { kind: 'empty', title: 'No data available', message: emptyMessage || 'No data is available for the selected window.' };
  }
  if (source?.source_status === 'no_data') {
    return { kind: 'empty', title: 'No data available', message: sourceMessage(source, emptyMessage || 'No data is available for the selected window.') };
  }
  return {
    kind: 'source-unavailable',
    title: `${label} source unavailable`,
    message: sourceMessage(source, fallback),
  };
}

export function telemetrySourceState({ telemetry = null, loading = false, error = '' } = {}) {
  const source = telemetry
    ? {
        source_status: telemetry.telemetry_status,
        source_message: telemetry.unavailable_reason,
      }
    : null;
  return sourceStateForPanel({
    loading,
    source,
    hasData: telemetry?.telemetry_status === 'available',
    error,
    category: 'telemetry',
    fallbackMessage: 'Telemetry source is unavailable for this device.',
    emptyMessage: 'No telemetry samples are available for this device.',
  });
}

function sourceLabel(category) {
  return sourceLabels[category] || sourceLabels.source;
}

function sanitizeSourceMessage(message, fallback) {
  const text = String(message || '').trim();
  if (!text) return fallback;
  if (sensitiveSourcePatterns.some((pattern) => pattern.test(text))) return fallback;
  return text;
}
