export function sourceAvailable(source) {
  return source?.source_status === 'available';
}

export function sourceMessage(source, fallback) {
  if (!source) return fallback;
  if (source.source_message) return source.source_message;
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
