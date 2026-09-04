---
title: "Before You Start"
description: "Prepare a test device, authorized identities, endpoints, and command-line tools."
category: "Start here"
keywords: ["prerequisites", "endpoint", "TLS", "certificate", "setup"]
language: "en"
applies_to: "RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155"
last_verified: "2026-09-04"
verification: "Source review and local tests; live environment qualification pending"
---

# Before You Start

## What you need

Use a dedicated test device and an authorized app identity for the same device and Brand Cloud. Ask your project administrator to complete device registration/activation and grant the required capabilities before starting.

| Input | How to obtain it |
| --- | --- |
| Device ID | Your registered test device; replace `device-1` consistently |
| Device/app token endpoints | The environment's verified mTLS origins; these may differ from the ordinary API origin |
| MQTT hostname and TLS port | Your environment's connection settings; not inferred from token metadata |
| Server CA trust bundle | Environment-provided trust chain |
| Device certificate and private key | Device enrollment; certificate identity must match `devid` |
| App certificate and private key access | Account login and app-local CSR enrollment |
| `mqtt`, `iot_shadow` | Product/device service configuration |

An Account Manager login token is not the Video Cloud runtime token used as the MQTT password. Production applications retain their locally generated private key in platform secure storage. Exportable Developer Console bundles are for local/staging tests only. These command-line tutorials assume an authorized test PEM bundle; a production app performs the same token exchange using its platform key provider.

## Local tools and settings

Install `curl` with `--aws-sigv4` support, `jq`, and the Mosquitto `mosquitto_pub` and `mosquitto_sub` clients. Use Bash for the examples. All examples use TLS verification; no insecure mode is required.

Set these values in each terminal used by a tutorial:

```bash
export API_BASE='https://api.example.test'
export DEVICE_TOKEN_BASE='https://device.example.test'
export APP_TOKEN_BASE='https://app-mtls.example.test'
export MQTT_HOST='mqtt.example.test'
export MQTT_PORT='8883'
export CA_FILE='/path/to/server-ca.pem'
export DEVICE_CERT='/path/to/device-cert.pem'
export DEVICE_KEY='/path/to/device-key.pem'
export APP_CERT='/path/to/app-cert.pem'
export APP_KEY='/path/to/app-key.pem'
export DEVICE_ID='device-1'
export SHADOW_NAME='tutorial'
```

Use the actual mTLS origin supplied for each certificate role. An ordinary HTTP API or plain HTTP port-forward cannot establish client-certificate identity.

The example hostnames do not resolve to your service. Replace them and the certificate paths with your environment's values. Port 8883 is an example, not a universal service guarantee.

Keep credentials in a private temporary working directory, outside a repository:

```bash
umask 077
export TUTORIAL_DIR="$(mktemp -d)"
```

Copy the same `TUTORIAL_DIR` value into the other terminals. Do not enable shell tracing or include token files in reports. Use an otherwise idle test device; its general MQTT tutorial messages and named Shadow updates are real writes.

## Ready check

Confirm the device is active, the app is authorized for that device, and both capabilities are enabled. Obtain separate device and app runtime token files using [Authentication and Access Control](authentication.en.md). A successful token response is the first milestone; successful MQTT connection and subscription are separate checks.

Next: [exchange an MQTT message](mqtt-quickstart.en.md).
