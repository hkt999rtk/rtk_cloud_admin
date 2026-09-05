import test from 'node:test';
import assert from 'node:assert/strict';
import { boardRoute, boardPath, boardSDKs, boardAssetPath } from './boards.mjs';
import { filterChipsets, providerEndpointCount } from './chipset-sdk.mjs';
test('Board routes preserve provider IDs and reject malformed routes',()=>{
  assert.deepEqual(boardRoute(boardPath('provider:chip','amb82-mini')),{chipsetId:'provider:chip',boardKey:'amb82-mini'});
  assert.deepEqual(boardRoute('/console/chipset-sdk/chip/boards/%bad'),{chipsetId:'',boardKey:''});
  assert.equal(boardRoute('/console/chipset-sdk/pro2/firmware-burner'),null);assert.equal(boardRoute('/console/chipset-sdk/chip/boards/amb82-mini/extra'),null);
});
test('Board model assets use versioned same-origin paths',()=>{
  assert.ok(boardAssetPath('/assets/boards/amb82-mini/v1/model.glb'));assert.ok(boardAssetPath('/assets/boards/amb82-mini/v2/poster.webp','poster'));
  for(const path of [null,'https://elsewhere/model.glb','//elsewhere/model.glb','/assets/boards/../model.glb','/assets/boards/amb82-mini/v1/model.glb?remote=1'])assert.equal(boardAssetPath(path),'');
});
test('Multiple boards share SDK releases without guessing legacy supported_models',()=>{
  const sdk={name:'SDK',supported_board_keys:['one','two']};const chipset={sdk_releases:[sdk,{name:'Legacy',supported_models:['one']}]};assert.deepEqual(boardSDKs(chipset,'one'),[sdk]);assert.deepEqual(boardSDKs(chipset,'two'),[sdk]);assert.deepEqual(boardSDKs(chipset,'unknown'),[]);assert.deepEqual(boardSDKs(null,'one'),[]);
});
test('Chipset search indexes IC and boards while legacy catalogs remain valid',()=>{
  const chipset={name:'AmebaPRO2',ic_model:'RTL8735B',boards:[{board_key:'amb82-mini',name:'AMB82 MINI',vendor:'Realtek',summary:'Camera board',resources:[{title:'Guide'}]}]};for(const query of ['AmebaPRO2','RTL8735B','AMB82','Camera board'])assert.deepEqual(filterChipsets([chipset],query),[chipset]);assert.deepEqual(filterChipsets([{name:'Legacy'}],'Legacy'),[{name:'Legacy'}]);assert.equal(providerEndpointCount([chipset]),1);
});

test('Published GLB is self-contained, within budget and includes every guided component',async()=>{
  const { readFile }=await import('node:fs/promises');
  const fixture=JSON.parse(await readFile(new URL('../public/assets/chipset-packages/realtek-amebapro2.json',import.meta.url),'utf8'));
  const board=fixture.chipsets[0].boards[0];
  const glb=await readFile(new URL(`../public${board.model.asset_path}`,import.meta.url));
  assert.ok(glb.length<=5*1024*1024);assert.equal(glb.toString('ascii',0,4),'glTF');assert.equal(glb.readUInt32LE(4),2);assert.equal(glb.readUInt32LE(8),glb.length);
  const model=JSON.parse(glb.toString('utf8',20,20+glb.readUInt32LE(12)));
  for(const part of board.components)assert.ok(model.nodes.some(node=>node.name===part.key),`Missing GLB part ${part.key}`);
  for(const resource of [...model.buffers,...model.images])assert.equal(resource.uri,undefined,'GLB must embed every resource');
  const root=model.nodes.find(node=>node.name==='amb82-mini');assert.deepEqual(root.extras.pcb_mm.slice(0,2),[board.dimensions.width_mm,board.dimensions.length_mm]);
  assert.ok((await readFile(new URL(`../public${board.model.poster_path}`,import.meta.url))).length<=200*1024);
});
