import { translate } from './i18n/index.mjs';
import React from 'react';

export function PKIStatus({ value }) {
  const labels = { pending: 'Creating certificate authority…', ready: 'Certificate authority ready', failed: 'Certificate authority needs attention', cancelled: 'Certificate authority setup cancelled' };
  return <small role="status" data-testid="pki-status">{labels[value] || translate("Certificate authority status unavailable")}</small>;
}
