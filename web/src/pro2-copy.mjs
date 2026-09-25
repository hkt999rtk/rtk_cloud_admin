import { translate } from './i18n/index.mjs';

// The release manifest is deliberately language-neutral. Its current three
// examples have stable source copy; leave unknown future copy visible as sent.
export function pro2Copy(value) {
  switch (value) {
    case 'MQTT': return translate('MQTT');
    case 'H.264 test video': return translate('H.264 test video');
    case 'Live camera': return translate('Live camera');
    case 'Cloud Token, MQTTS commands, presence and reconnect.': return translate('Cloud Token, MQTTS commands, presence and reconnect.');
    case 'Looping synthetic H.264 over WebRTC, direct or TURN.': return translate('Looping synthetic H.264 over WebRTC, direct or TURN.');
    case 'MMFv2 camera encoding and H.264 WebRTC streaming.': return translate('MMFv2 camera encoding and H.264 WebRTC streaming.');
    case 'AmebaPro2 SDK 9.6e compatible board; physical validation pending': return translate('AmebaPro2 SDK 9.6e compatible board; physical validation pending');
    case 'Not required': return translate('Not required');
    case 'PASS': return translate('Passed');
    case 'PASS (protocol baseline; see report)': return translate('Passed (protocol baseline; see report)');
    case 'NOT_RUN': return translate('Not yet tested');
    default: return translate(value);
  }
}

export function pro2Error(value) {
  if (value === 'PRO2 examples are unavailable. Retry later.') return translate('PRO2 examples are unavailable. Retry later.');
  return translate(value);
}
