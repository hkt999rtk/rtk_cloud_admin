import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../content/developer-docs');

test('formal factory sequence is linked in every language and separates Test Lab',async()=>{
  for(const [locale,term] of [['en','mass production'],['zh-TW','量產'],['zh-CN','量产']]){
    const suffix=locale==='en'?'':`.${locale}`;
    const page=await readFile(resolve(root,`credential-setup.${locale}.md`),'utf8');
    const diagram=await readFile(resolve(root,`assets/factory-enrollment-formal${suffix}.html`),'utf8');
    const svg=await readFile(resolve(root,`assets/factory-enrollment-formal${suffix}.svg`),'utf8');
    assert.match(page,new RegExp(`assets/factory-enrollment-formal${suffix.replaceAll('.','\\.')}\\.html`));
    assert.ok(page.includes(`assets/factory-enrollment-formal${suffix}.svg`));
    assert.ok(page.includes(term));
    assert.ok(diagram.includes(term));
    assert.ok(diagram.includes('mTLS'));
    assert.ok(diagram.includes('JWT'));
    assert.ok(diagram.includes('CSR'));
    assert.ok(svg.includes('CSR'));
  }
});
