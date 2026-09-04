import React, { useEffect, useState } from 'react';

// Credential material stays in this mounted page only, never persistent storage.
export function TestLabDownload({ file, onSaved }) {
  const [url, setURL] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(file.blob);
    setURL(next);
    return () => URL.revokeObjectURL(next);
  }, [file.blob]);

  async function saveAs() {
    setMessage('');
    try {
      // Called directly by a user gesture; no asynchronous issuance before picker.
      const handle = await window.showSaveFilePicker({ suggestedName: file.name, types: [{ description: 'JSON credentials', accept: { 'application/json': ['.json'] } }] });
      const writer = await handle.createWritable();
      await writer.write(file.blob);
      await writer.close();
      onSaved();
      setMessage('File saved. You can download the same file again while this page stays open.');
    } catch (error) {
      setMessage(error.name === 'AbortError' ? 'Save cancelled. Your file is still available below.' : 'Could not save with the file picker. Use the download link below or try another browser.');
    }
  }

  return <section className="test-lab-binding-form" aria-label={file.label}>
    <h4><i className="fa-solid fa-file-arrow-down test-lab-icon" aria-hidden="true" />{file.label}</h4>
    <p><strong>{file.saved ? 'Saved — download remains available.' : 'Ready to download — not yet confirmed saved.'}</strong> {file.name}</p>
    <p>Contains a private key. Save it securely before refreshing, leaving this page or changing Product. The server does not retain the private key. Retrying this download uses the same file and does not create another device or key.</p>
    {typeof window.showSaveFilePicker === 'function' && <button type="button" onClick={saveAs}>Save file…</button>}
    {url && <a className="test-lab-download-link" href={url} download={file.name} onClick={() => setMessage('Download requested. Check your browser downloads; this page cannot confirm that the file was saved. You can retry this link.')}>Download {file.kind === 'device' ? 'device credentials' : 'provision key'}</a>}
    <p>If your browser shows only a blob: URL, the file has not necessarily been saved. Keep this page open and use Save file… if available. Do not create another device to retry a download.</p>
    <label><input type="checkbox" checked={file.saved} onChange={e => onSaved(e.target.checked)} /> I have saved this file securely</label>
    {message && <p role="status">{message}</p>}
  </section>;
}
