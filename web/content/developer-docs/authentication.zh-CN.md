---
title: 身分验证与存取控制
description: 获取执行时令牌，并将其元资料对映到MQTT和Shadow HTTP凭据中。
category: Build integrations
keywords:
- 请求_令牌
- 重新整理_令牌
- 其他
- 体4
- 客户端_id
- aws_凭据
- request_token
- refresh_token
- mTLS
- SigV4
- client_id
- aws_credentials
language: zh-CN
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 来源审查和本地测试；现场环境资格待定
---


# 身分验证与存取控制

经过验证的装置证书识别了装置。应用程式证书识别了应用程式使用者；应用程式执行时令牌还会与请求的装置系结。在测试时，请将这两个身份分开。

[开启重新设计的序列图](assets/authentication.zh-CN.html)

## 身份验证边界

在各自的边界上使用每个凭据。帐户经理持有人不是MQTT密码；执行时JWT不是AWS帐户凭据。下面的共享地图补充了令牌交换序列和详细的凭据设定指南。

![身份验证边界](assets/credential-uses.zh-CN.svg)

[全尺寸方块图](assets/credential-uses.zh-CN.svg) · [Mermaid 原始档](assets/credential-uses.zh-CN.mmd)

## 获取执行时凭据

完成后[先决条件](before-you-start.zh-CN.md)，在您的私人工作目录中执行以下操作。`aws_iot_data`请求HTTP示例使用的短暂的凭证捆绑包。

```bash
jq -n --arg devid "$DEVICE_ID" \
  '{scope:"device",devid:$devid,aws_iot_data:true}' > "$TUTORIAL_DIR/device-request.json"
curl --fail-with-body --silent --show-error \
  --cacert "$CA_FILE" --cert "$DEVICE_CERT" --key "$DEVICE_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TUTORIAL_DIR/device-request.json" \
  "$DEVICE_TOKEN_BASE/request_token" > "$TUTORIAL_DIR/device-token.json"

jq -n --arg devid "$DEVICE_ID" \
  '{scope:"app",devid:$devid,aws_iot_data:true}' > "$TUTORIAL_DIR/app-request.json"
curl --fail-with-body --silent --show-error \
  --cacert "$CA_FILE" --cert "$APP_CERT" --key "$APP_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TUTORIAL_DIR/app-request.json" \
  "$APP_TOKEN_BASE/request_token" > "$TUTORIAL_DIR/app-token.json"
```

发生HTTP错误后请勿继续。请确认每个档案都不是空的`access_token`, `mqtt.username`，和`mqtt.client_id`不列印他们的值。HTTP Shadow示例还需要`aws_credentials`物件。缺失的栏位不是需要编造的值：检查能力启用、端点版本和发行策略。

## 将凭据对映到协议

|连线栏位|价值|
| --- | --- |
|MQTT使用者名称|回应`mqtt.username` |
|MQTT密码|回应`access_token` |
|MQTT客户端ID|回应`mqtt.client_id`，可选后跟一个允许的角色字尾|
|HTTP 影子访问金钥| `aws_credentials.accessKeyId` |
|HTTP 影子金钥| `aws_credentials.secretAccessKey` |
|HTTP 影子会话令牌| `aws_credentials.sessionToken` |
|HTTP影子区域和端点| `aws_credentials.region`, `aws_credentials.iotDataEndpoint` |

MQTT使用者名必须与签名的Brand Cloud身份相匹配。不要在主题前加上Brand Cloud ID。同时的MQTT连线需要不同的客户端ID。这些教学附加`-watch`与`-send`到返回的基础。检查后的实现允许1-64个ASCII字母、数字、下划线或连字元字尾；使用简短的固定角色。

普通受保护的服务HTTP API通常使用承载人授权。公共Shadow HTTP契约使用带有服务名称的SigV4`iotdevicegateway`；使用返回的凭证捆绑包，而不是假设承运人示例适用。

## 在到期前续订

从已签署的JWT中安排令牌续订`exp`，不是要求的`expiry`持续时间。将解码的索赔视为排程资料，而不是本地验证的授权。`/refresh_token`使用历史上命名的仍然有效的签名令牌`refresh_token`栏位；这不是一个不透明的重新整理许可权。

```bash
jq '{refresh_token:.access_token}' "$TUTORIAL_DIR/device-token.json" \
  > "$TUTORIAL_DIR/reissue-request.json"
curl --fail-with-body --silent --show-error --cacert "$CA_FILE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TUTORIAL_DIR/reissue-request.json" \
  "$API_BASE/refresh_token" > "$TUTORIAL_DIR/device-token-next.json"
```

在更换当前令牌档案之前，请验证响应。使用其新密码和返回的元资料重新连线MQTT。如果旧令牌已过期或重新发行失败，请透过证书引导流程获取新令牌。要更新HTTP Shadow凭据，请重复`/request_token`与`aws_iot_data:true`；不要假设重新发行会重新发行该捆绑包。

## 故障检查

TLS故障发生在HTTP响应之前。检查伺服器信任链、证书有效性、私钥和端点。HTTP令牌拒绝可能表明装置身份不匹配、未活动装置、缺少许可权或不可用的装置投影。成功发行后的MQTT拒绝需要检查使用者名称、客户端ID、令牌到期日和`mqtt`能力。

下一个：[MQTT快速入门](mqtt-quickstart.zh-CN.md)或者[签名的HTTP影子请求](shadow-interfaces.zh-CN.md).

继续：[凭证更新和恢复](credential-recovery.zh-CN.md).
