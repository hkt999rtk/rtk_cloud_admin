import React, { useEffect, useRef, useState } from 'react';
import { fetchCloudProducts, productError } from './cloud-products.mjs';

// This picker owns its cloud-scoped page; the overview's first page is not the
// complete authorization catalogue. Selection lives in the enclosing form.
export function SharingProducts({ cloudId, selectedIds, disabled, onChange, onAccessLost }) {
  const [page, setPage] = useState(null), [offset, setOffset] = useState(0);
  const [error, setError] = useState(''), [reload, setReload] = useState(0);
  const accessLost = useRef(onAccessLost); accessLost.current = onAccessLost;
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    setPage(null); setError('');
    const load = async () => {
      try {
        const result = await fetchCloudProducts(cloudId, '', { offset, signal: controller.signal });
        if (!controller.signal.aborted) { setPage(result); setError(''); }
      } catch (err) {
        if (!controller.signal.aborted) {
          setPage(null); setError(productError(err));
          if ([401, 403, 404].includes(err.status)) accessLost.current?.(err);
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 10000);
      }
    };
    load();
    const focus = () => { controller.abort(); clearTimeout(timer); setReload(v => v + 1); };
    window.addEventListener('focus', focus);
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('focus', focus); };
  }, [cloudId, offset, reload]);
  const changePage = value => { setPage(null); setOffset(value); };
  return <fieldset disabled={disabled} data-testid="sharing-products">
    <legend>Authorized Products</legend>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setReload(v => v + 1)}>Retry Product choices</button></p> : !page && <p role="status">Loading Product choices…</p>}
    {page?.pagination.total === 0 && <p>No Products available. Create a Product or explicitly choose entire-cloud sharing.</p>}
    {page && page.products.length === 0 && page.pagination.total > 0 && <p>No Products remain on this page. Return to the previous page.</p>}
    {page?.products.map(product => <label key={product.id}><input type="checkbox" checked={selectedIds.includes(product.id)} onChange={e => onChange(e.target.checked ? [...selectedIds, product.id] : selectedIds.filter(id => id !== product.id))} />{product.name}</label>)}
    <nav aria-label="Sharing Product pages">
      <button type="button" disabled={disabled || offset === 0} onClick={() => changePage(Math.max(0, offset - 25))}>Previous Product choices</button>
      <span>Page {Math.floor(offset / 25) + 1}{page ? ` · ${page.pagination.total} Products` : ''}</span>
      <button type="button" disabled={disabled || !page || offset + 25 >= page.pagination.total} onClick={() => changePage(offset + 25)}>Next Product choices</button>
    </nav>
    <p role="status">Selected Products: {selectedIds.length}. Selections are kept across pages and revalidated when saved.</p>
    {selectedIds.length > 0 && <details><summary>Review selected Product IDs</summary><ul>{selectedIds.map(id => <li key={id}><code>{id}</code> <button type="button" aria-label={`Remove ${id}`} onClick={() => onChange(selectedIds.filter(value => value !== id))}>Remove</button></li>)}</ul></details>}
  </fieldset>;
}
