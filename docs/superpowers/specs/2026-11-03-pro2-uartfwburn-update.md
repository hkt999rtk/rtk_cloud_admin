# PRO2 Web Serial burner integration proposal

## Context
The Developer Console embeds the uartfwburn JavaScript implementation at 81f808f, with English/i18n UI and a Console-specific firmware source. The newer uartfwburn HEAD 8608cad contains NOR protocol fixes and ownership/workflow fixes. Preserve the Console's existing routes, firmware selection, visual style and translations.

## Proposed changes
1. Port the compatible changes in web/static/{burner,serial,xmodem}.js to repos/rtk_cloud_admin/web/src/pro2-firmware-burner/, preserving Console-facing English messages. Carry across address/length and erase-mask boundary validation before UART effects; reject PRO2 nonzero offset with device verify until ROM semantics are confirmed. Match sector erase command start+length, response handling, hash terminator and delay, checksum-mode frame size, cancellation and stream cleanup.
2. Port the successful-burn workflow and serialized connection actions from web/frontend/burn-workflow.js and app.js into the Console runtime. Validate before terminal ownership changes; run reset/terminal actions only after successful burn, report post-action warnings separately, and do not claim device verification when it was disabled. Preserve the existing remote/local firmware source, i18n and UI interaction.
3. Port upstream regression cases for the changed protocol and workflow, update obsolete Console assertions, and test both the Console's existing unit and targeted browser flows. Verify cancellation at each stage, fragmented UART data, invalid ranges, device disconnection, four reset/console combinations, and resource ownership. Confirm the physical UART path is unverified unless hardware is available; do not burn real hardware during automated checks.

## Evidence and boundary
- Source: /Users/kevinhuang/work/uartfwburn at 8608cad, compared against 81f808f.
- Destination: /Volumes/RTKCloudWorkspace/rtk_cloud_workspace/repos/rtk_cloud_admin (detached pinned checkout; currently clean). The parent workspace has unrelated modifications that must be preserved.
- Baseline: upstream npm test 84/84 pass; Console node --test src/pro2-firmware-burner.test.mjs 20/20 pass.
- NOR only; do not import NAND/native executables or change actual firmware contents. Keep verification failure explicit rather than silently disabling it.
