import { translate } from './i18n/index.mjs';
import React from 'react';

export function PKIStatus({ value }) {
  const labels = { pending: translate('Creating certificate authority…'), ready: translate('Certificate authority ready'), failed: translate('Certificate authority needs attention'), cancelled: translate('Certificate authority setup cancelled') };
  return <small role="status" data-testid="pki-status">{labels[value] || translate("Certificate authority status unavailable")}</small>;
}
