import { useEffect, useState } from 'react';

export async function sdkJSON(url, signal) {
  const response = await fetch(url, { signal, credentials:'same-origin', cache:'no-store' });
  if (!response.ok) { const error = new Error('SDK request failed'); error.status = response.status; throw error; }
  return response.json();
}

export function useSDKSection(url, enabled, onAuthError) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setData(null);
    if (!enabled) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    sdkJSON(url, controller.signal).then(setDataIfCurrent).catch(error => {
      if (controller.signal.aborted) return;
      if ([401,403].includes(error.status)) { onAuthError(error.status); return; }
      setData({ source_status:'unavailable', source_message: url.includes('sdk-releases')
        ? error.status===503 ? 'SDK downloads are not configured for this environment. Ask the platform administrator to complete the SDK deployment.' : 'The SDK catalog could not be loaded. Please try again or contact the platform administrator.'
        : 'ChipSet resources are unavailable.' });
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    function setDataIfCurrent(result) { if (!controller.signal.aborted) setData(result); }
    return () => controller.abort();
  }, [url, enabled, attempt, onAuthError]);
  return { data, loading, retry:() => setAttempt(n=>n+1) };
}

export function sdkNavigationTarget(source, target) {
  const sdk = path => path === '/console/chipset-sdk' || path.startsWith('/console/chipset-sdk/');
  const docsOrClouds = path => path === '/console/clouds' || path === '/console/developer-docs' || path.startsWith('/console/developer-docs/');
  const sensitive = path => /\/(test-lab|firmware-burner)(\/|$)/.test(path);
  if (source.origin!==target.origin || (!sdk(source.pathname) && !sdk(target.pathname) && !(docsOrClouds(source.pathname) && docsOrClouds(target.pathname)))) return false;
  if (sensitive(source.pathname) || sensitive(target.pathname)) return false;
  if (!source.pathname.startsWith('/console/') || !target.pathname.startsWith('/console/')) return false;
  if (/\/(billing|handoff)(\/|$)/.test(source.pathname+target.pathname)) return false;
  return source.pathname+source.search !== target.pathname+target.search;
}
