import source from './legal/sdk_terms.en.md?raw';
import traditional from './legal/sdk_terms.zh-TW.md?raw';
import simplified from './legal/sdk_terms.zh-CN.md?raw';

// The release manifest owns the legal text. Show a translation only when its
// English source is exactly the reviewed draft bundled with that translation.
export function pro2Terms(terms, locale) {
  if (terms !== source) return { markdown: terms, reviewed: false };
  return { markdown: locale === 'zh-TW' ? traditional : locale === 'zh-CN' ? simplified : source, reviewed: true };
}
