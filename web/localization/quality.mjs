// Product terminology and executable identifiers must survive localization.
// These checks complement a developer's review of meaning and readability.
export const languageNeutralCopy = new Set([
  'CSV', 'Connect+', 'Grafana', 'HTTP', 'HTTP / SigV4', 'JSON', 'MQTT', 'Realtek',
  'SDK', 'WebRTC', 'YouTube', 'mm', '· NT$', 'CR', 'LF', 'CRLF', 'IC', 'FPS',
  'SHA-256', 'UART', 'USB', 'GPIO', 'I2C', 'SPI', 'PWM', 'ADC', 'DAC', 'TCP',
  'TLS', 'JWT', 'CSR', 'CA', 'PEM', 'PKI', 'ACL', 'QoS', 'SigV4', 'Web Serial',
  'Webhook', 'MQTT Broker', 'Account Manager', 'Video Cloud', 'Brand Cloud',
  'AMEBA PRO2 · WEB SERIAL', 'Acme Cloud', 'CPU', 'FPS ·', 'IC ·', 'UTC',
  'example.com, example.co.jp', 'https://hooks.example.com/events',
  'https://idp.example.com', 'kbps', 'ms', 'name@company.com', 'oidc-client-id',
  'Shadow', 'ETag {{value0}}', 'Last-Modified {{value0}}', 'IoT Shadow',
]);

const technicalNames = /\b(?:Account Manager|Video Cloud|MQTT|JWT|mTLS|TLS|HTTPS?|SigV4|WebSocket|WebRTC|Web Serial|Python|SDK|CSR|PKI|PEM|PUBACK|SUBACK|CONNACK|CRLF|CR|LF|SHA-256|UART|GPIO|I2C|SPI|FPS|IC)\b/g;
const identifiers = /(?:\b[\w-]+\.py\b|--[a-z][\w-]*|\b(?:state|desired|reported)\.[a-z][\w]*(?:\.[a-z][\w]*)*(?:=[a-z][\w-]*)?|\bR\/[a-z]+(?:\/[a-z]+)*|\b(?:clientToken|devid|thingName|iotDataEndpoint|aws_iot_data|request_token|refresh_token)\b)/g;
const units = /\b\d[\d,.]*\s*(?:baud|KiB|MiB|GiB|TiB)\b/g;
const normalizeUnit = value => value.replace(/[\s,]/g, '');
const badTranslations = [
  /索賠|索赔/, /十字韌帶|十字韧带/, /影子國家服務|影子国家服务|州政府訪問|州政府访问/,
  /伺服器無效性|服务器无效性|遷移無效|迁移无效/, /殘疾的|残疾的/,
  /燒掉這個例子|烧掉这个例子|取消燒燬|取消烧毁|重試燒燬|重试烧毁/,
  /消毒(?:結果|结果|支援|支持)/, /Wi-Fi\s*交換機|Wi-Fi\s*交换机/,
];

export function isLanguageNeutral(source) {
  return languageNeutralCopy.has(source) || /^\d[\d,]*\s+baud$/.test(source);
}

export function translationQualityErrors(source, translated) {
  const errors = [];
  const translatedNames = new Set(translated.match(technicalNames) || []);
  for (const term of new Set(source.match(technicalNames) || [])) {
    if (!translatedNames.has(term)) errors.push(`missing technical name ${term}`);
  }
  const translatedIdentifiers = new Set(translated.match(identifiers) || []);
  for (const identifier of new Set(source.match(identifiers) || [])) {
    if (!translatedIdentifiers.has(identifier)) errors.push(`missing executable identifier ${identifier}`);
  }
  const translatedUnits = new Set((translated.match(units) || []).map(normalizeUnit));
  for (const unit of new Set(source.match(units) || [])) {
    if (!translatedUnits.has(normalizeUnit(unit))) errors.push(`changed technical quantity ${unit}`);
  }
  for (const bad of badTranslations) {
    if (bad.test(translated)) errors.push(`known mistranslation ${translated.match(bad)[0]}`);
  }
  if (/\bbroker\b/i.test(source) && /經紀人|经纪人/.test(translated)) errors.push('MQTT broker translated as a person');
  if (/\bboards?\b/i.test(source) && /董事會|董事会/.test(translated)) errors.push('development board translated as a committee');
  return errors;
}

export function markdownCodeSpans(markdown) {
  const prose = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
  return [...prose.matchAll(/(`+)([^`\n]+)\1/g)].map(match => match[2]).sort();
}

export function documentationQualityErrors(source, translated) {
  const errors = translationQualityErrors(source, translated);
  if (JSON.stringify(markdownCodeSpans(source)) !== JSON.stringify(markdownCodeSpans(translated))) {
    errors.push('inline code differs from English');
  }
  return errors;
}
