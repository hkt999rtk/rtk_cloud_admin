---
title: 'Quickstart: Synchronize Device State'
description: Request power on from an app and confirm the device reports the applied
  state.
category: Tutorials
keywords:
- desired
- reported
- delta
- power
- quickstart
language: en
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: Source review and local tests; live environment qualification pending
---

# Quickstart: Synchronize Device State

Goal: complete a real desired → device action → reported cycle using a dedicated named Shadow. Complete [setup](before-you-start.en.md) and [authentication](authentication.en.md), including separate app and device token files. Both principals must target the same device and Brand Cloud with `mqtt` and `iot_shadow` enabled.

![The application requests a state change; the device reports the state only after applying it.](assets/shadow-sync.svg)

[Open full-size diagram](assets/shadow-sync.svg) · [Mermaid source](assets/shadow-sync.mmd)

## 1. Subscribe before sending

In terminal A, set the root and start the device observer. Reuse this `ROOT` value in terminal B.

```bash
export ROOT="\$vc/devices/$DEVICE_ID/shadow/name/$SHADOW_NAME"
mosquitto_sub -h "$MQTT_HOST" -p "$MQTT_PORT" --cafile "$CA_FILE" \
  -u "$(jq -er '.mqtt.username' "$TUTORIAL_DIR/device-token.json")" \
  -P "$(jq -er '.access_token' "$TUTORIAL_DIR/device-token.json")" \
  -i "$(jq -er '.mqtt.client_id' "$TUTORIAL_DIR/device-token.json")-watch" \
  -V mqttv311 -k 60 -q 1 -d -v \
  -t "$ROOT/get/accepted" -t "$ROOT/get/rejected" \
  -t "$ROOT/update/accepted" -t "$ROOT/update/rejected" \
  -t "$ROOT/update/delta" -t "$ROOT/update/documents"
```

Wait for all requested subscriptions to succeed. The observer displays the exchange for this tutorial; a real application and firmware each maintain their own subscriptions and pending-request state.

In terminal B define a small publishing helper:

```bash
export ROOT="\$vc/devices/$DEVICE_ID/shadow/name/$SHADOW_NAME"
shadow_publish() {
  local token_file="$1" operation="$2" payload="$3"
  mosquitto_pub -h "$MQTT_HOST" -p "$MQTT_PORT" --cafile "$CA_FILE" \
    -u "$(jq -er '.mqtt.username' "$token_file")" \
    -P "$(jq -er '.access_token' "$token_file")" \
    -i "$(jq -er '.mqtt.client_id' "$token_file")-send" \
    -V mqttv311 -k 60 -q 1 -t "$ROOT/$operation" -m "$payload"
}
```

## 2. Read first and establish a baseline

```bash
shadow_publish "$TUTORIAL_DIR/device-token.json" get '{"clientToken":"tutorial-get-1"}'
```

A new tutorial Shadow returns `get/rejected` with code 404. An existing one returns `get/accepted`; verify it is safe to use before proceeding. In this simulator exercise, establish power off as both desired and actual state. On hardware, report only a state you have actually verified.

```bash
shadow_publish "$TUTORIAL_DIR/app-token.json" update \
  '{"state":{"desired":{"power":"off"}},"clientToken":"tutorial-baseline-app"}'
# Wait for update/accepted with the matching clientToken.
shadow_publish "$TUTORIAL_DIR/device-token.json" update \
  '{"state":{"reported":{"power":"off"}},"clientToken":"tutorial-baseline-device"}'
```

Wait for the second accepted response. First UPDATE creates a missing Shadow; no explicit create API is needed.

## 3. Request the change from the app

```bash
shadow_publish "$TUTORIAL_DIR/app-token.json" update \
  '{"state":{"desired":{"power":"on"}},"clientToken":"tutorial-app-on"}'
```

Expect `update/accepted` with `clientToken:"tutorial-app-on"` and `update/delta` whose top-level `state.power` is `"on"`. The delta event is not shaped as `state.delta.power`; a GET response uses that nesting. Version and timestamps are server values and need not match a fixed example.

## 4. Apply and report actual state

Simulate applying power on, or have firmware apply and verify the hardware operation. Only then send:

```bash
shadow_publish "$TUTORIAL_DIR/device-token.json" update \
  '{"state":{"reported":{"power":"on"}},"clientToken":"tutorial-device-on"}'
```

Wait for its accepted response. If hardware failed, leave reported state accurate and surface the failure through application diagnostics; never report success just because desired was received.

## 5. Verify convergence

```bash
shadow_publish "$TUTORIAL_DIR/app-token.json" get '{"clientToken":"tutorial-get-2"}'
```

In `get/accepted`, check `state.desired.power` and `state.reported.power` are both `"on"` and `state.delta.power` is absent. Other properties in an existing named Shadow may still have differences. On a fresh tutorial Shadow with only `power`, the delta section is omitted entirely.

If no delta arrives, GET current state: desired may already equal reported, a subscription may have failed, or the device may lack permission. Do not use a fixed sleep as proof of successful mutation.

Next: [MQTT and HTTP operations](shadow-interfaces.en.md) and [offline recovery](integration-recipes.en.md). To remove tutorial state, use the explicit delete steps in the interface guide after stopping the observer.

Architecture: [Shadow document architecture](shadow-concepts.en.md).
