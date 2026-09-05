# AMB82 MINI board explorer

AmebaPRO2 is the platform; RTL8735B is the IC; AMB82 MINI is the board.
The developer route is `/console/chipset-sdk/:chipsetId/boards/:boardKey`.
Both identifiers come from the published Provider snapshot. Board information
is global to authenticated developers and follows the existing publication,
preview, stale-snapshot and access rules.

## Original model and provenance

This is an original, code-built appearance model, not manufacturing CAD or an
exact reconstruction of one hardware revision. The GLB and poster contain no
third-party photographs, meshes or textures. Silkscreen textures are rendered
from text with the bundled Noto Sans font. The preview and model carry an
approximation note. Source references were inspected on 2026-09-05.

| Reference | What it supports |
| --- | --- |
| [Realtek hardware guide v0.3, public mirror](https://www.electropi.in/image/catalog/Realtek-AMB82-Mini-USER-MANUAL.pdf), PDF pages 7–9 | PCB 60 × 37.4 mm, DIP-30 / 2.54 mm pitch; front/back arrangement; two USB connectors, download/reset buttons and three LEDs |
| [ICShop product listing and photographs](https://www.icshop.com.tw/products/368030501864) | Black PCB and white marking, camera/lens assembly, cable and external antenna; overall retail appearance |
| [Official AMB82 MINI documentation](https://ameba-doc-arduino-sdk.readthedocs-hosted.com/en/latest/ameba_pro2/amb82-mini/index.html) | Board identity and development-resource relationships |
| [Official hardware and camera download index](https://www.amebaiot.com/en/datasheet-download-amb82-mini/) | F37 camera option and hardware documents; camera FPC variants exist |

The v0.3 guide's unshielded reverse photograph and retail shielded variants
must not be represented as identical revisions. This appearance assembly uses
a simplified reverse shield and explicitly discloses revision variation.
The newer v0.4 guide / 2V2 HDK downloads were not available for inspection;
no measurements are attributed to those files.

The [community STL repository](https://github.com/joehou45/Amb82-Mini) describes
personal/noncommercial usage restrictions. None of its files were used.

## Measurement and estimation ledger

Model source coordinates are millimetres, with PCB width on X, length on Y,
front on +Z, USB mouths at -Y. The exported root scales by 0.001 so the GLB
uses metres. Back views reverse the visible left/right orientation naturally.

| Element | Model basis |
| --- | --- |
| PCB width / length | 37.4 / 60 mm, documented values |
| Header pitch | 2.54 mm, documented; 15 pins per side |
| PCB thickness, rounded corners | Estimated 1.6 / 0.7 mm |
| Header centres / post length | Estimated X ±16.6; Y 27.5 decreasing by 2.54; reverse-facing posts |
| Camera carrier | Estimated 17 × 17 mm; lens barrel ~11.6 mm outer diameter and ~16 mm frontmost Z |
| Camera flex and FPC socket | Estimated 11.4 mm flex width and folded placement; socket centre Y -6 |
| USB receptacles | Estimated 7.9 mm wide, with open mouths, inner tongues and five contacts; X ±8 near bottom |
| Buttons, LEDs, microphone, microSD | Photo-guided dimensions and placement; microphone diameter ~4.1 mm |
| Reverse module/shield | Estimated 20.8 × 26 mm footprint; generic shield, not a certified revision marking |
| External antenna/coax | Estimated 8 × 26 mm antenna; illustrative flexible cable routing |
| Passives, traces, white marking | Simplified visual detail, not a schematic or electrical pinout |

Do not use this asset to design an enclosure, infer component clearance, wire
pins, or identify an exact manufacturing revision. Use the hardware documents.

## Rebuild and serve

From `web/`:

```sh
npm ci
npx playwright install chromium
npm run build:board-model
npm run build
```

`web/scripts/boards/amb82-mini.mjs` is the editable model source.
`web/scripts/build-amb82-model.mjs` exports the GLB and renders the poster from
that same assembly using pinned Three.js, the repository's Playwright and
bundled font. Set `BOARD_MODEL_EVIDENCE_DIR` to retain front/back review images.
The builder uses only a loopback server and writes the versioned local assets.
It fails if the GLB exceeds 5 MiB or the poster exceeds 200 KiB. GPU/OS
rasterization can produce small poster differences on other platforms.

Assets: `web/public/assets/boards/amb82-mini/v1/model.glb` and `poster.webp`.
Use a new version directory for future geometry changes after publication.
No remote model, external texture, CDN or additional renderer dependency is
loaded by the viewer. The standard build copies these assets into `web/dist`.

## Interaction and resource lifecycle

`BoardExplorer.jsx` provides the English page, poster fallback, accessible
native buttons and component description. `boards.mjs` owns route and SDK
association helpers. `board-viewer.mjs` is dynamically imported only when a
board detail page needs a model; the general SDK list loads only posters.

Each manifest component key must name a GLB group. Repeated meshes are batched
by material inside each selectable group. GLTFLoader, OrbitControls and
raycasting provide rotation, zoom, front/back/reset and component selection.
The model has no autoplay or explosion animation. Button selection describes
hardware; programming links to the existing PRO2 Firmware Burner.

Rendering is requested only on load, resize or interaction. Pixel ratio is
capped at 1.5; panning is disabled to keep the board recoverable. Failure,
unmount and retry abort outstanding loads and release observers, controls,
geometry, materials, textures, environment maps and the WebGL context.
A late GLTF parse is disposed even after navigation. Posters, parts, specs and
links remain available without WebGL or when the model request fails.

## Isolated local preview

After building, run from `web/`:

```sh
E2E_BOARD_PREVIEW=true E2E_APP_PORT=18382 node scripts/e2e-server.mjs
```

Open `http://127.0.0.1:18382/console/chipset-sdk/preview-amebapro2/boards/amb82-mini`.
Use the repository's synthetic `developer@example.com` / `e2e-developer-password`
fixture account. This opt-in fixture serves the bundled package through the
normal Account Manager client and BFF; it does not publish a real Provider.

## Validation and rollout

- Go tests cover old manifests, shared SDK references, invalid/duplicate keys,
  invalid resources and model paths, package governance, snapshot round-trips,
  and BFF list/detail forwarding of every nested Board field.
- Node tests cover route isolation, safe paths, board-aware search, legacy SDK
  behavior, asset sizes, GLB version, embedded resources and named parts.
- `e2e/boards.spec.mjs` covers list/detail navigation, search, existing SDK/burner
  links, view controls, pointer/keyboard selection, model 404/retry, missing
  WebGL, unpublished/stale providers, idle rendering and repeated GPU cleanup.
- Desktop and mobile browser screenshots are emitted as test evidence; inspect
  front, reverse, oblique and lens-focused views against the references above.

Deployment order: compatible Account Manager backend, Cloud Admin/frontend and
versioned assets, then Provider content. Refresh a draft Provider to inspect the
complete Board payload before publishing. Existing manifests need no changes
or database migration. Never publish the content first against an older backend
that discards unknown Board fields. Verify the full flow in staging before
production promotion. Rollback can unpublish the Provider or restore its previous
manifest without changing the data schema.
