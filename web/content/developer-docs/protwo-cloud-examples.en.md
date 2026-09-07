---
title: PRO2 Cloud Examples
description: Build, burn and test the independent MQTT and H.264 examples.
category: Firmware
keywords: [PRO2, MQTT, H264, camera, firmware, UART]
language: en
applies_to: AmebaPro2 SDK 9.6e
last_verified: 2026-09-07
verification: Source and host validation; physical board acceptance pending.
---
# PRO2 Cloud Examples

## Choose your test path

Open [PRO2 Cloud Examples](/console/chipset-sdk/pro2/cloud-examples) to select a release. Each release has source with this offline guide, three full non-TrustZone flash images and SHA-256 sidecars. The release manifest identifies the exact source and SDK revisions.

**Website binaries are isolated test builds.** Their Wi-Fi placeholders, self-signed identity and reserved `.test` services cannot connect to your Cloud. Use them to check download, image transfer and board startup only. They may repeatedly report network errors; this is expected with test settings. A successful image transfer is not proof of cloud connectivity or camera operation.

For real Cloud tests, download your own device certificate from Developer UI and rebuild locally. Device certificates are different from viewer/user credentials. No certificate issuance, online compilation, audio or post-flash credential configuration is implemented by these examples.

## Prepare hardware and dependencies

Use an AmebaPro2 board compatible with SDK 9.6e, stable board power, and a USB UART at the board's documented voltage. Connect adapter TX to board RX, adapter RX to board TX, and common GND. Do not connect RS-232 voltage or assume the UART adapter can power the board. Confirm UART/download pins using your board's manual. Camera defaults to GC2053; a different sensor must be selected explicitly.

Obtain the original AmebaPro2 SDK 9.6e and RTK Ameba WebRTC SDK through your authorized SDK distribution channel. The original SDK is not included in this source archive. Select the RTK revision in `dependencies.json`. Install GCC 10.3.1/newlib 4.1.0 (gcc-arm-none-eabi-10.3-2021.10), Python 3, CMake, Ninja and OpenSSL. The build checks these versions and hashes the vendor SDK before and after building.

Keep the repositories separate and configure their absolute paths:

```sh
export RTK_AMEBA_SDK_ROOT=/absolute/path/to/sdk-ameba-v9.6e
export RTK_AMEBA_WEBRTC_ROOT=/absolute/path/to/rtk_ameba_webrtc
export RTK_ARM_TOOLCHAIN_BIN=/absolute/path/to/gcc-arm-none-eabi-10.3-2021.10/bin
mkdir -p local
cp config/device.example.json local/device.local.json
```

## Configure your own Cloud

Set `wifi_ssid`, `wifi_password` and `wifi_security` (`wpa2-aes`, `open` or `provisioned`). Provisioned mode waits for an externally managed Wi-Fi association; this application does not provision or reconnect that association itself.

Set `device_id`, `token_url`, `cloud_base_url`, `mqtt_broker_host` and `mqtt_broker_port` from your selected Cloud. Use its device mTLS Token endpoint, not a plain HTTP API port. Set `mqtt_command_topic`, `mqtt_presence_topic` and `mqtt_tenant_topic_prefix` to the device's authorized topics. Do not mix environments or device IDs.

Set `device_certificate_chain_pem`, `device_private_key_pem`, `https_server_ca_pem` and `mqtt_server_ca_pem` to your local PEM files. The build checks format, validity dates, identity and matching keys; runtime verifies server CA and hostname. Working SNTP time is required before TLS.

**Plaintext private-key/certificate files and embedded key arrays are development shortcuts only.** Production private keys must be provisioned into the **PRO2 protected zone**. Replace the development credential integration with protected-zone signing/access before production. This release does not implement that integration. Never commit these local files or publish a firmware image containing your real private key.

## Source walkthrough

`common/app.c` starts a FreeRTOS worker, joins/waits for Wi-Fi, synchronizes time, runs the selected example, then cleans up and retries after five seconds. `common/network.c` owns the explicitly configured Wi-Fi connection but preserves externally managed provisioned Wi-Fi during application retries.

`common/mqtt_identity.c` refreshes cloud credentials before MQTT CONNECT and extracts broker identity without logging Tokens. `common/video.c` configures and polls the external RTK device/media service. The RTK SDK supplies the existing protocol implementation; these examples do not fork it.

`tools/build.py` injects an external CMake hook into the original SDK. `assets/test_video.c` contains the synthetic video. No SD card is required. Modify each example's `main.c` for application behavior, and change local configuration for device identity and endpoints.

## MQTT

Build from the extracted source root:

```sh
python3 tools/build.py mqtt --config local/device.local.json
```

`examples/mqtt/main.c` creates the mTLS Token provider and MQTTS transport, subscribes to commands and publishes presence after subscription. It does not link the WebRTC media engine. Use an authorized Cloud application to subscribe to the device's presence topic and publish a command to its command topic. Verify receipt on both sides using the UART byte-count log and the application payload. Disconnect/reconnect the broker and verify resubscription and fresh presence. Do not use device credentials as viewer credentials.

## Webrtc-test-video

```sh
python3 tools/build.py webrtc_test_video --config local/device.local.json
```

`examples/webrtc_test_video/main.c` sends the built-in 320×240, 15 FPS, two-second synthetic H.264 clip. Frames are paced and timestamps remain continuous across loops; every frame is IDR with SPS/PPS, satisfying the next keyframe request. `common/playback.h` handles pacing/timestamp calculations.

Open an authorized RTK Cloud viewer for the same device/environment. Confirm the clip repeats across multiple loops, close the viewer, reconnect and confirm video resumes. Test direct mode first. Set `force_relay` to true and rebuild for forced relay; verify relay candidate evidence. TURN credentials/URLs come from Cloud ICE configuration. Test TURN/UDP and TURN/TCP with corresponding server configuration; TURN/TLS is not supported.

## Webrtc-camera

```sh
python3 tools/build.py webrtc_camera --config local/device.local.json --sensor SENSOR_GC2053
```

`examples/webrtc_camera/main.c` uses the external MMFv2 camera/H.264 bridge and bounded frame pool. Default video is 1080p, 15 FPS, 2,097,152 bps. Choose the sensor defined in the SDK's sensor header for your board; unsupported selections or capacity report an error.

Confirm the viewer shows a changing live scene. Request a keyframe, close and reopen the session, and verify streaming resumes. Cleanup stops the camera producer before destroying the device queue and frame pool. Check memory over repeated sessions and an extended run on hardware; host/QEMU tests do not emulate MMF, sensor DMA or physical Wi-Fi.

## Burn from a URL or local file

Use desktop Chrome or Edge with Web Serial on HTTPS. Close other programs holding the USB UART.

For a website image, select **Burn this example**, read and accept the release terms, then download the firmware. The browser checks its size and SHA-256 before enabling burning. Retry obtains a fresh URL if the previous one expired. A CORS/network error or hash mismatch must be resolved before burning.

For your own build, open the [PRO2 Firmware Burner](/console/chipset-sdk/pro2/firmware-burner), connect UART, open the firmware panel and select the matching file from `output/`:

```text
amebapro2_mqtt_flash_ntz.bin
amebapro2_webrtc_test_video_flash_ntz.bin
amebapro2_webrtc_camera_flash_ntz.bin
```

These are full non-TrustZone flash images, written at **0x0**. Do not select the application-only `firmware_ntz.bin` for this full-image flow. The manifest identifies image layout; filename alone does not establish compatibility. Compare the displayed SHA-256 with the sidecar before writing.

For boards with BOOT and RESET controls: hold BOOT, press RESET once, release BOOT, then start the burn. Follow your board's download-mode instructions if controls differ. Keep verification enabled. Whole-chip erase also removes other flash contents; use it only when intentionally required. After successful verification, reset into normal boot and observe UART at 115200 baud. DTR/RTS reset requires those pins to be wired correctly; otherwise reset manually.

## Results and recovery

Real configured builds should reach `EXAMPLE_NETWORK_READY` and `EXAMPLE_READY kind=...`. These markers alone do not prove MQTT reception or video playback: also check the receiving application. Network/time failures cause bounded retries; check Wi-Fi mode, DHCP, DNS and SNTP. TLS failures require matching identity, CA, time and endpoint checks. Never paste private keys or Tokens into diagnostic logs.

If UART is busy, close the other terminal. If download mode times out, repeat the BOOT/RESET sequence. After interrupted flashing or verification failure, keep the board in download mode and retry at a lower speed; do not treat a partial image as bootable. Download fresh bytes after URL expiry or a checksum mismatch.

The release validation report distinguishes compiler, host, QEMU and physical-board evidence. Known limitation: a two-session QEMU stress run with 31-second Tokens failed during resubscription; examples use the existing 300-second Token request. Physical flash/boot, camera, Wi-Fi recovery and real user Cloud access remain pending until separately tested.

## Reproduce local validation

```sh
python3 tools/test_local.py
cmake -S tests -B build/example-tests -G Ninja -DRTK_AMEBA_WEBRTC_ROOT="$RTK_AMEBA_WEBRTC_ROOT"
cmake --build build/example-tests --parallel 4
ctest --test-dir build/example-tests --output-on-failure
python3 tools/test_qemu.py direct
python3 tools/test_qemu.py udp
python3 tools/test_turn_tcp.py
```

Local tests additionally require FFmpeg, ffprobe, a host C/C++ compiler and libcjson. QEMU/TURN tests require the external RTK SDK's host/QEMU prerequisites; the TCP harness uses Docker Coturn. Record expected and observed results using `docs/hardware-checklist.md`, and retain `docs/validation.md` with your release evidence.
