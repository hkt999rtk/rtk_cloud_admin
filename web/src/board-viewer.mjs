// This module (including Three.js) is imported only by the board detail view.
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createBoardViewer(host, assetPath, componentKeys, { onReady, onError, onSelect }) {
  const abort = new AbortController();
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', 'Rotate board with pointer or touch. Use the view buttons and component list for keyboard controls.');
  canvas.setAttribute('role', 'img');
  host.append(canvas);
  const scene = new T.Scene();
  scene.background = new T.Color('#edf2f4');
  const camera = new T.PerspectiveCamera(32, 1, .001, 3);
  camera.up.set(0, 1, 0);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.minDistance = .025;
  controls.maxDistance = .5;
  controls.zoomSpeed = .8;
  const room = new RoomEnvironment();
  const pmrem = new T.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  scene.environmentIntensity = .45;
  room.dispose(); pmrem.dispose();
  scene.add(new T.HemisphereLight(0xffffff, 0x7e919c, .7));
  const light = new T.DirectionalLight(0xffffff, 1.8);
  light.position.set(-.06, .1, .18); scene.add(light);
  const rearLight = new T.DirectionalLight(0xffffff, 1.4);rearLight.position.set(.08, .05, -.15);scene.add(rearLight);
  let model, disposed = false, frame = 0, down, selected = [], currentView = 'reset';
  const parts = new Map();
  const raycaster = new T.Raycaster();
  const center = new T.Vector3();
  let radius = .05;
  function render() {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; if (!disposed) renderer.render(scene, camera); });
  }
  function resize() {
    // The host is hidden until loading completes; measure the stage throughout.
    const bounds = host.parentElement.getBoundingClientRect();
    const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (model && !selected.length) view(currentView); else render();
  }
  function clearSelection() {
    for (const [mesh, material] of selected) { mesh.material.dispose(); mesh.material = material; }
    selected = [];
  }
  function focus(target, size, direction) {
    const fov = Math.min(camera.fov * Math.PI / 180, 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
    const distance = T.MathUtils.clamp(size / Math.sin(fov / 2) * 1.08, controls.minDistance, controls.maxDistance);
    controls.target.copy(target);
    camera.position.copy(target).add(direction.normalize().multiplyScalar(distance));
    camera.lookAt(target); controls.update(); render();
  }
  function view(side = 'reset') {
    if (!model) return;
    currentView = side; clearSelection();
    focus(center, radius, new T.Vector3(...(side === 'front' ? [0,0,1] : side === 'back' ? [0,0,-1] : [.065,-.080,.162])));
  }
  function select(key) {
    const part = parts.get(key); if (!part) return;
    clearSelection();
    part.traverse(mesh => {
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const original = mesh.material;
      mesh.material = original.clone();
      mesh.material.emissive.set('#237b86'); mesh.material.emissiveIntensity = .22;
      selected.push([mesh, original]);
    });
    const bounds = new T.Box3().setFromObject(part);
    const target = bounds.getCenter(new T.Vector3());
    const direction = target.z < -.001 ? new T.Vector3(.3,-.25,-1) : new T.Vector3(.3,-.4,1);
    focus(target, Math.max(bounds.getBoundingSphere(new T.Sphere()).radius, .012), direction);
  }
  function zoom(factor) {
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(T.MathUtils.clamp(offset.length()*factor, controls.minDistance, controls.maxDistance));
    camera.position.copy(controls.target).add(offset);controls.update();render();
  }
  function pointerDown(event) { down = event.isPrimary ? [event.clientX, event.clientY] : null; }
  function pointerUp(event) {
    if (!model || !down || Math.hypot(event.clientX-down[0],event.clientY-down[1]) > 5) { down = null; return; }
    down = null;
    const bounds = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new T.Vector2((event.clientX-bounds.left)/bounds.width*2-1, -(event.clientY-bounds.top)/bounds.height*2+1), camera);
    const hit = raycaster.intersectObject(model, true)[0];
    let part = hit?.object;
    while (part && !parts.has(part.name)) part = part.parent;
    if (part) { select(part.name);onSelect(part.name); }
  }
  function contextLost(event) { event.preventDefault(); fail(); }
  function releaseModel(object) {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    object?.traverse(node => { if (!node.isMesh) return;geometries.add(node.geometry);for (const m of (Array.isArray(node.material) ? node.material : [node.material])) materials.add(m); });
    for (const material of materials) { for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);material.dispose(); }
    for (const texture of textures) { texture.source?.data?.close?.();texture.dispose(); }
    for (const geometry of geometries) geometry.dispose();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;abort.abort();cancelAnimationFrame(frame);observer.disconnect();
    controls.removeEventListener('change', render);controls.dispose();
    canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('webglcontextlost',contextLost);
    clearSelection();releaseModel(model);environment.dispose();scene.clear();renderer.dispose();renderer.forceContextLoss();canvas.remove();
  }
  function fail() { if (!disposed) { dispose();onError(); } }
  controls.addEventListener('change', render);
  canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('webglcontextlost',contextLost);
  const observer = new ResizeObserver(resize);observer.observe(host.parentElement);
  resize();
  (async () => {
    const response = await fetch(assetPath, { signal: abort.signal });
    if (!response.ok) throw new Error('Board asset is unavailable');
    const data = await response.arrayBuffer();
    // Curated GLBs must be self-contained, keeping all model requests same-origin.
    const manager = new T.LoadingManager();
    manager.setURLModifier(url => { if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('External model resource');return url; });
    const gltf = await new GLTFLoader(manager).parseAsync(data, '');
    if (disposed) { releaseModel(gltf.scene);return; }
    model = gltf.scene;scene.add(model);
    for (const key of componentKeys) { const part=model.getObjectByName(key);if(part)parts.set(key,part); }
    const sphere = new T.Box3().setFromObject(model).getBoundingSphere(new T.Sphere());
    center.copy(sphere.center);radius=sphere.radius;
    view();onReady();
  })().catch(fail);
  return { dispose, select, view, zoom };
}
