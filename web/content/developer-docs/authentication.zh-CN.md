---
title: 身份验证与访问控制
description: 获取运行时令牌，并将返回信息用于 MQTT 与 Shadow HTTP
  的身份验证。
category: Build integrations
keywords:
- 身份验证
- 访问控制
- 签名
- 令牌刷新
- request_token
- refresh_token
- mTLS
- SigV4
- client_id
- aws_credentials
language: zh-CN
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 来源审查与本地测试；实际环境验证仍待完成
---

# 身份验证与访问控制

设备证书通过验证后，用于识别设备；App 证书则用于识别应用用户。App 的运行时令牌还会绑定请求中指定的设备。测试时，请分别使用这两种身份。

[打开验证流程时序图](assets/authentication.zh-CN.html)

## 各类凭证的适用范围

各类凭证都有各自的用途。Account Manager 的 Bearer 令牌不能作为 MQTT 密码；运行时 JWT 也不是 AWS 账号凭证。下图整理了各种凭证的用途，可结合令牌交换时序图与证书配置指南阅读。

![各类凭证的适用范围](assets/credential-uses.zh-CN.svg)

[查看完整架构图](assets/credential-uses.zh-CN.svg) · [Mermaid 源码](assets/credential-uses.zh-CN.mmd)

## 获取运行时凭证

完成[准备工作](before-you-start.zh-CN.md)后，在私有工作目录中执行以下命令。`aws_iot_data` 用于请求 HTTP 示例所需的短期凭证包。

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

如果收到 HTTP 错误，请先停止。确认每个文件都包含非空的 `access_token`、`mqtt.username` 和 `mqtt.client_id`，但不要输出这些值。HTTP Shadow 示例还需要 `aws_credentials` 对象。如果缺少字段，请检查服务功能是否已启用、端点版本和签发策略，不要自行填入值。

## 将凭证填入协议字段

| 连接字段 | 填入的值 |
| --- | --- |
| MQTT 用户名 | 响应中的 `mqtt.username` |
| MQTT 密码 | 响应中的 `access_token` |
| MQTT Client ID | 响应中的 `mqtt.client_id`，可加上允许的角色后缀 |
| HTTP Shadow 访问密钥 | `aws_credentials.accessKeyId` |
| HTTP Shadow 私有访问密钥 | `aws_credentials.secretAccessKey` |
| HTTP Shadow 会话令牌 | `aws_credentials.sessionToken` |
| HTTP Shadow 区域与端点 | `aws_credentials.region`, `aws_credentials.iotDataEndpoint` |

MQTT 用户名必须与已签名的 Brand Cloud 身份一致。不要在主题前加上 Brand Cloud ID。并发 MQTT 连接必须使用不同的 Client ID；本教程会在返回的基础 ID 后加上 `-watch` 或 `-send`。经检查的实现允许后缀使用 1–64 个 ASCII 字母、数字、下划线或连字符；建议使用简短且固定的角色名称。

普通受保护的服务 HTTP API 通常使用 Bearer 验证。公开的 Shadow HTTP 接口规范则要求使用 SigV4，服务名称为 `iotdevicegateway`。请使用返回的凭证包，不要直接套用 Bearer 示例。

## 在到期前更新令牌

请根据已签名 JWT 中的 `exp` 安排令牌更新时间，不要根据请求中的 `expiry` 时长推算。解码后的 JWT 声明仅用于调度，不代表已在本地验证授权。`/refresh_token` 的 `refresh_token` 字段沿用历史命名，实际接收的是仍有效的已签名令牌，并非独立的不透明刷新授权。

```bash
jq '{refresh_token:.access_token}' "$TUTORIAL_DIR/device-token.json" \
  > "$TUTORIAL_DIR/reissue-request.json"
curl --fail-with-body --silent --show-error --cacert "$CA_FILE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TUTORIAL_DIR/reissue-request.json" \
  "$API_BASE/refresh_token" > "$TUTORIAL_DIR/device-token-next.json"
```

先验证响应，再替换当前的令牌文件。使用新密码与返回信息重新建立 MQTT 连接。如果旧令牌已过期或重新签发失败，请通过证书验证流程获取新令牌。要更新 HTTP Shadow 凭证，请再次调用 `/request_token` 并传入 `aws_iot_data:true`；不要假设重新签发令牌时也会返回该凭证包。

## 失败时的检查项

TLS 错误发生在收到 HTTP 响应之前。请检查服务器信任链、证书有效期、私钥和端点。HTTP 令牌请求被拒绝可能是设备身份不符、设备尚未激活、权限不足，或设备数据投影不可用。如果令牌已成功签发，但 MQTT 连接被拒绝，请检查用户名、Client ID、令牌过期时间和 `mqtt` 功能。

下一步：[MQTT 快速入门](mqtt-quickstart.zh-CN.md)或[使用签名的 HTTP Shadow 请求](shadow-interfaces.zh-CN.md)。

延伸阅读：[凭证更新与连接恢复](credential-recovery.zh-CN.md)。
