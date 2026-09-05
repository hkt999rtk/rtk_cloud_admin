// Rebuild the original GLB and its poster with the repository's pinned Three.js
// and Playwright. Requires `npx playwright install chromium` on a fresh machine.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = path.join(root, 'public/assets/boards/amb82-mini/v1');
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') {res.setHeader('Content-Type','text/html');res.end(`<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>`);return;}
    const file=path.resolve(root, '.'+decodeURIComponent(req.url));
    if (!file.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
    res.setHeader('Content-Type',file.endsWith('.js')||file.endsWith('.mjs')?'text/javascript':file.endsWith('.woff2')?'font/woff2':'application/octet-stream');res.end(await readFile(file));
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1000,height:1000}});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const assets=await page.evaluate(async()=>{
    const T=await import('three'); const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
    const {RoomEnvironment}=await import('three/addons/environments/RoomEnvironment.js');
    const font=new FontFace('BoardFont','url(/node_modules/@fontsource-variable/noto-sans-tc/files/noto-sans-tc-latin-wght-normal.woff2)');document.fonts.add(await font.load());
    const {createAMB82Mini}=await import('/scripts/boards/amb82-mini.mjs'); const model=createAMB82Mini();
    const buffer=await new GLTFExporter().parseAsync(model,{binary:true,maxTextureSize:1024});
    const blob=new Blob([buffer]);const glb=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(blob);});
    const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(960,960);renderer.setPixelRatio(1);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    const scene=new T.Scene();scene.background=new T.Color('#edf2f4');scene.add(model);
    const room=new RoomEnvironment();const pmrem=new T.PMREMGenerator(renderer);const env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.45;room.dispose();pmrem.dispose();
    scene.add(new T.HemisphereLight(0xffffff,0x7e919c,.7)); const light=new T.DirectionalLight(0xffffff,1.8);light.position.set(-.06,.1,.18);scene.add(light);
    const rearLight=new T.DirectionalLight(0xffffff,1.4);rearLight.position.set(.08,.05,-.15);scene.add(rearLight);
    const center=new T.Box3().setFromObject(model).getCenter(new T.Vector3());
    const camera=new T.PerspectiveCamera(32,1,.001,2);camera.up.set(0,1,0);
    const render=(position)=>{camera.position.copy(center).add(new T.Vector3(...position));camera.lookAt(center);renderer.render(scene,camera);return renderer.domElement.toDataURL('image/webp',.88).split(',')[1];};
    const poster=render([.065,-.080,.162]);const front=render([0,0,.187]);const back=render([0,0,-.187]);
    const stats={triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls};
    renderer.dispose();env.dispose();return {glb,poster,front,back,stats};
  });
  await mkdir(out,{recursive:true});
  const glb=Buffer.from(assets.glb,'base64'),poster=Buffer.from(assets.poster,'base64');
  if(glb.length>5*1024*1024||poster.length>200*1024)throw new Error('Model asset budget exceeded');
  await writeFile(path.join(out,'model.glb'),glb);await writeFile(path.join(out,'poster.webp'),poster);
  const evidence=process.env.BOARD_MODEL_EVIDENCE_DIR;
  if(evidence){await mkdir(evidence,{recursive:true});for(const name of ['front','back'])await writeFile(path.join(evidence,`${name}.webp`),Buffer.from(assets[name],'base64'));}
  console.log(JSON.stringify({glbBytes:glb.length,posterBytes:poster.length,...assets.stats}));
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
