// Original, photo-referenced appearance model. Dimensions are millimetres here;
// glTF is exported in metres. See docs/amb82-mini-model.md for source/estimates.
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const boardComponentKeys = ['pcb', 'camera', 'camera-ribbon', 'usb-soc', 'usb-uart', 'download-button', 'reset-button', 'leds', 'headers', 'microsd', 'microphone', 'module', 'antenna'];

export function createAMB82Mini() {
  const root = new T.Group(); root.name = 'amb82-mini'; root.scale.setScalar(0.001);
  root.userData = { units: 'metres', source: 'Original procedural appearance model; hardware guide v0.3 and ICShop photos', pcb_mm: [37.4, 60, 1.6], estimated: 'All dimensions except PCB length/width and 2.54 mm header pitch' };
  const groups = Object.fromEntries(boardComponentKeys.map(key => { const g = new T.Group(); g.name = key; root.add(g); return [key, g]; }));
  const mat = (color, metalness = 0, roughness = 0.55, extra = {}) => new T.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  const pcb = mat('#060a0b', .02, .78), edge = mat('#30302b', .1, .78), black = mat('#17191b', .12, .4), plastic = mat('#111214', 0, .72);
  const silver = mat('#aeb6bb', .9, .32), gold = mat('#cba753', .78, .34), ceramic = mat('#9c896b', .1, .64), white = mat('#eee9d8', .05, .55);
  const unitBox = new T.BoxGeometry(1, 1, 1);
  function mesh(g, geometry, material, x = 0, y = 0, z = 0) { const m = new T.Mesh(geometry, material); m.position.set(x,y,z); g.add(m); return m; }
  function box(g, x,y,z,w,h,d,m) { const b = mesh(g, unitBox,m,x,y,z); b.scale.set(w,h,d); return b; }
  function cylinder(g,x,y,z,r,h,m,segments=32,r2=r) { const b=mesh(g,new T.CylinderGeometry(r,r2,h,segments),m,x,y,z); b.rotation.x=Math.PI/2; return b; }
  function ring(g,x,y,z,r,t,m) { return mesh(g,new T.TorusGeometry(r,t,6,24),m,x,y,z); }
  function wire(g,points,r,m) { return mesh(g,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),48,r,8,false),m); }
  function label(g,text,x,y,z,w,h,{back=false,color='#e2e3d9',background=null}={}) {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=Math.max(48,Math.round(512*h/w));
    const ctx=canvas.getContext('2d'); if(background){ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);}
    ctx.fillStyle=color;ctx.font=`500 ${canvas.height*.72}px BoardFont, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,canvas.height/2,500);
    const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;
    const m=new T.MeshStandardMaterial({map:tex,transparent:!background,roughness:.8,depthWrite:!!background,side:T.FrontSide});
    const p=mesh(g,new T.PlaneGeometry(w,h),m,x,y,z);if(back)p.rotation.y=Math.PI;
    return p;
  }
  // Rounded PCB with real through-holes for both 15-pin header rows.
  const shape=new T.Shape();const w=18.7,h=30,r=.7;
  shape.moveTo(-w+r,-h);shape.lineTo(w-r,-h);shape.quadraticCurveTo(w,-h,w,-h+r);shape.lineTo(w,h-r);shape.quadraticCurveTo(w,h,w-r,h);shape.lineTo(-w+r,h);shape.quadraticCurveTo(-w,h,-w,h-r);shape.lineTo(-w,-h+r);shape.quadraticCurveTo(-w,-h,-w+r,-h);
  const pinYs=Array.from({length:15},(_,i)=>27.5-i*2.54);
  for(const x of [-16.6,16.6]) for(const y of pinYs){const hole=new T.Path();hole.absarc(x,y,.52,0,Math.PI*2,true);shape.holes.push(hole);}
  const geo=new T.ExtrudeGeometry(shape,{depth:1.6,bevelEnabled:false,curveSegments:5});
  mesh(groups.pcb,geo,[pcb,edge],0,0,-.8);
  // Solder annuli on both faces and square posts extending from the reverse.
  for(const x of [-16.6,16.6]) {
    box(groups.headers,x,9.72,-2.05,2.5,38.1,2.5,plastic);
    for(const y of pinYs) {
      ring(groups.headers,x,y,.85,.79,.18,gold); ring(groups.headers,x,y,-.85,.79,.18,gold);
      box(groups.headers,x,y,-3.65,.64,.64,7.8,gold);
      cylinder(groups.headers,x,y,.9,.46,.16,silver,12);
    }
  }
  // MicroSD cage: open card mouth faces the top board edge.
  const sd=groups.microsd;
  box(sd,-.2,21.3,1.12,15.2,15,.6,plastic);
  box(sd,-.2,21.1,2.62,15.5,15,.3,silver);
  for(const x of [-7.9,7.5]) box(sd,x,21.1,1.85,.3,15,1.6,silver);
  box(sd,-.2,13.65,1.85,15.5,.25,1.6,silver);
  for(let i=0;i<8;i++)box(sd,-5.7+i*1.5,27.7,1.42,.6,1.8,.12,gold);
  for(const x of [-7.9,7.5])for(const y of [16,25])box(sd,x,y,1.0,1.2,1.5,.3,silver);
  label(sd,'microSD',0,21,2.81,8,1.4,{color:'#666c70'});
  box(sd,-6.7,24.5,2.8,.35,4,.05,black);
  // Two open, shaped Micro-B receptacles at the bottom edge.
  for(const [key,x] of [['usb-soc',-8],['usb-uart',8]]) {
    const g=groups[key];
    box(g,x,-27.2,1.15,8,5.7,.6,black);
    box(g,x,-27.9,3.32,7.9,5.6,.25,silver);box(g,x,-27.9,1.22,6.5,5.6,.25,silver);
    for(const sign of [-1,1]) {box(g,x+sign*3.82,-27.9,2.5,.25,5.6,1.5,silver);const bevel=box(g,x+sign*3.5,-27.9,1.58,.23,5.6,.9,silver);bevel.rotation.y=sign*.7;box(g,x+sign*4.25,-26.1,1.02,1.1,1.6,.35,silver);}
    box(g,x,-25.14,2.2,7.7,.25,2.1,silver);
    box(g,x,-28.5,1.85,4.6,3.7,.5,plastic);
    for(let i=0;i<5;i++){box(g,x+(i-2)*.65,-28.7,2.14,.23,3,.1,gold);box(g,x+(i-2)*.65,-24.6,1,.32,1.1,.2,silver);}
    for(const dx of [-2.2,2.2])box(g,x+dx,-28.2,3.46,1,1.35,.04,black);
    label(groups.pcb,key==='usb-soc'?'8735':'CH340',x,-23.3,.84,6.8,1.5);
  }
  // Tactile switches with solder lugs and small black actuators.
  for(const [key,x] of [['download-button',-16.5],['reset-button',16.5]]) {
    const g=groups[key];box(g,x,-27.3,1.8,3.1,4.4,1.8,plastic);box(g,x,-27.3,2.78,2.9,4.1,.2,silver);box(g,x,-27.3,3.25,1.7,2.2,.85,black);
    for(const y of [-29,-25.6])for(const dx of [-1.65,1.65])box(g,x+dx,y,1,.65,.65,.4,silver);
  }
  label(groups.pcb,'DL',-16.4,-23.6,.84,2.2,1.2); label(groups.pcb,'RST',16.2,-23.6,.84,2.6,1.2);
  // Camera FPC socket and the short, flat flexible ribbon.
  const flex=groups['camera-ribbon'];
  box(flex,0,-6,1.65,17.8,4.5,1.6,white);box(flex,0,-4.7,2.55,17.1,1.2,.65,black);
  for(let i=0;i<24;i++)box(flex,(i-11.5)*.65,-7.7,2.48,.27,1.2,.15,gold);
  const ribbon=mat('#684c24',.27,.52); const ribbonEdge=mat('#d5a248',.5,.5);
  // Constant-width ribbon follows a slight fold, leaving surrounding PCB visible.
  const ribbonPoints=[[-4.5,2.55],[-1,3.6],[4,5.3],[10,4.1],[15,3.45]];
  const pos=[],uv=[];
  for(let i=0;i<ribbonPoints.length;i++){const[y,z]=ribbonPoints[i];pos.push(-5.7,y,z,5.7,y,z);uv.push(0,i/4,1,i/4);}
  const inds=[];for(let i=0;i<4;i++){const n=i*2;inds.push(n,n+1,n+2,n+1,n+3,n+2);}
  const ribbonGeo=new T.BufferGeometry();ribbonGeo.setAttribute('position',new T.Float32BufferAttribute(pos,3));ribbonGeo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));ribbonGeo.setIndex(inds);ribbonGeo.computeVertexNormals();ribbon.side=T.DoubleSide;mesh(flex,ribbonGeo,ribbon);
  for(const x of [-5.55,5.55])wire(flex,ribbonPoints.map(([y,z])=>[x,y,z+.03]),.09,ribbonEdge);
  for(let i=0;i<14;i++)wire(flex,ribbonPoints.map(([y,z])=>[-4.8+i*.73,y,z+.045]),.035,ribbonEdge);
  // F37 sensor carrier and turned lens barrel with threaded rings, aperture and glass.
  const cam=groups.camera;
  box(cam,0,16,3.65,17,17,.7,mat('#203836',.15,.6));
  for(const x of [-7.5,7.5])for(const y of [8.5,23.5])ring(cam,x,y,4.03,.65,.18,gold);
  box(cam,0,16,5,13,13,2,plastic);
  cylinder(cam,0,16,8,5.8,4,black,48);cylinder(cam,0,16,12,5.25,5,black,48);
  for(let i=0;i<10;i++)ring(cam,0,16,8.1+i*.58,5.22,.15,black);
  cylinder(cam,0,16,15,5.8,1.4,black,64);ring(cam,0,16,15.75,5.3,.35,black);
  cylinder(cam,0,16,15.72,4.64,.16,mat('#05070a',.1,.18),64);
  cylinder(cam,0,16,15.83,3.85,.08,mat('#152b36',.75,.1),64);
  ring(cam,0,16,15.92,3.95,.14,mat('#565051',.7,.22));
  cylinder(cam,0,16,15.94,2.05,.025,mat('#0b1021',.45,.07),64);
  label(cam,'F37',0,9.9,6.02,5,1.2,{color:'#868c89'});
  // Microphone and three indicator packages (no fictional illuminated status).
  cylinder(groups.microphone,11,-12,1.6,2.05,1.6,silver);cylinder(groups.microphone,11,-12,2.45,1.72,.08,mat('#717573',.45,.8));
  for(let i=0;i<14;i++){const a=i*2.4,rr=.4+(i%3)*.38;cylinder(groups.microphone,11+Math.cos(a)*rr,-12+Math.sin(a)*rr,2.51,.06,.03,black,6);}
  for(const[x,y,c]of [[13.2,-7.7,'#c5cb92'],[-12,-19,'#a68171'],[3,-23,'#96afa0']]){box(groups.leds,x,y,1.25,1.9,1,.7,white);box(groups.leds,x,y,1.66,1.1,.8,.25,mat(c,.05,.35));for(const dx of [-1.1,1.1])box(groups.leds,x+dx,y,1.02,.4,1,.25,silver);}
  // Small packages: deliberately simplified, photo-guided clusters and solder pads.
  function smd(g,x,y,z,kind=0){const m=kind?black:ceramic;box(g,x,y,z,1.15,.6,.45,m);for(const dx of [-.7,.7])box(g,x+dx,y,z-.04,.32,.65,.4,silver);}
  for(const [baseX,baseY,cols,rows] of [[-12,-10,3,3],[-4,-11,3,2],[4,-16,4,2],[-11,-20,2,2],[13,-19,1,4]]) for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){const x=baseX+col*2.35,y=baseY-row*1.65;smd(groups.pcb,x,y,1.1,(row+col)%3===0);}
  for(let i=0;i<11;i++)smd(groups.pcb,-13+(i%3)*2.5,27-Math.floor(i/3)*2.8,1.1,i%2);
  for(let i=0;i<18;i++)smd(groups.pcb,-3+(i%6)*1.9,11-Math.floor(i/6)*1.3,1.1,i%4===0);
  function ic(g,x,y,z,w,h,back=false){box(g,x,y,z,w,h,1,black);for(const side of [-1,1])for(let i=0;i<8;i++)box(g,x+side*(w/2+.4),y+(i-3.5)*h/9,z-(back?-.4:.4),.75,.32,.22,silver);}
  ic(groups.pcb,-12,-3,1.5,4,5);ic(groups.pcb,-5,-19.7,1.5,3.4,3.7);
  label(groups.pcb,'AMB82-MINI',0,5.7,.84,14,2.0);
  label(groups.pcb,'AMB82 MINI',0,-21.6,.84,8.5,1.2);
  label(groups.pcb,'REALTEK',-9.3,9.5,.84,8,1.4);
  // Fine solder-mask traces catch grazing light without implying a circuit netlist.
  const trace=mat('#1c292b',.23,.5);
  for(let i=0;i<10;i++){box(groups.pcb,-14+i*.42,-16,.824,.1,15-i*.5,.015,trace);box(groups.pcb,14-i*.42,-17,.824,.1,11-i*.5,.015,trace);}
  // Reverse module with a removable-looking metal shield typical of retail photos.
  const module=groups.module;box(module,0,15.2,-1.3,20.8,26,.85,mat('#174c40',.1,.6));
  for(const x of [-10.5,10.5])for(let i=0;i<18;i++)box(module,x,3.1+i*1.39,-1.28,.85,.65,.55,gold);
  for(const y of [2.1,28.3])for(let i=0;i<14;i++)box(module,-9.1+i*1.4,y,-1.28,.7,.85,.55,gold);
  box(module,0,15.2,-2.5,19.5,24.8,1.75,silver);
  // Subtle stamped outline and engraved identification on the shield.
  for(const x of [-9.1,9.1])box(module,x,15.2,-3.41,.16,23.3,.05,mat('#889497',.85,.4));
  for(const y of [3.55,26.85])box(module,0,y,-3.41,18.3,.16,.05,silver);
  label(module,'RTL8735B',0,17,-3.41,13,2,{back:true,color:'#555f62'});
  label(module,'AMEBA PRO2',0,13.7,-3.41,12,1.5,{back:true,color:'#657174'});
  label(groups.pcb,'AMB82 MINI',-1,-21.8,-.84,14,2,{back:true});
  ic(groups.pcb,-6,-14,-1.5,7,4,true);
  for(let i=0;i<30;i++)smd(groups.pcb,-11+(i%8)*3.1,-2-Math.floor(i/8)*2.6,-1.2,i%3===0);
  for(const x of [-14,-7,0,7,14])for(const y of [-25.5,-28])cylinder(groups.pcb,x,y,-.91,.5,.15,gold,16);
  // U.FL connector, flexible black coax and flat external antenna with gold trace.
  const ant=groups.antenna;cylinder(ant,-8.4,26,-3.8,.9,.75,gold);cylinder(ant,-8.4,26,-4.23,.65,.2,silver);
  wire(ant,[[-8.4,26,-4.2],[-14,32,-3],[-4,37,0],[19,35,2],[35,27,2],[34,16,2]],.5,black);
  const antenna=new T.Group();ant.add(antenna);antenna.position.set(36,5,2);antenna.rotation.z=-.16;
  box(antenna,0,0,0,8,26,.8,pcb);
  const antennaTrace=mat('#8b773f',.55,.5);box(antenna,0,0,.42,6,23,.04,antennaTrace);box(antenna,0,0,.45,5.2,22,.04,black);
  for(let i=0;i<6;i++){box(antenna,i%2?1.1:-1.1,8-i*3.1,.5,3.5,.4,.08,antennaTrace);box(antenna,i%2?-2.4:2.4,6.6-i*3.1,.5,.4,3,.08,antennaTrace);}
  label(antenna,'Wi-Fi',0,-9,.53,5,1.4,{color:'#c5c2a9'});
  // Batch repeated passives and pins by material within each selectable part.
  root.updateMatrixWorld(true);
  const retired = new Set();
  for (const group of Object.values(groups)) {
    const batches = new Map(); const inverse = group.matrixWorld.clone().invert();
    group.traverse(node => {
      if (!node.isMesh || Array.isArray(node.material)) return;
      if (!batches.has(node.material)) batches.set(node.material, []);
      batches.get(node.material).push(node);
    });
    for (const [material, nodes] of batches) {
      if (nodes.length < 2) continue;
      const geometries = nodes.map(node => node.geometry.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inverse, node.matrixWorld)));
      const merged = mergeGeometries(geometries);
      geometries.forEach(geometry => geometry.dispose());
      if (!merged) throw new Error('Cannot batch board geometry');
      for (const node of nodes) { retired.add(node.geometry); node.removeFromParent(); }
      mesh(group, merged, material);
    }
  }
  for (const geometry of retired) geometry.dispose();
  root.updateMatrixWorld(true);
  return root;
}
