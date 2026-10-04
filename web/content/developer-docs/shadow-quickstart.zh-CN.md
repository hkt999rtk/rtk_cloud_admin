---
title: 设备状态同步快速入门
description: 从应用程序要求开启电源，并确认设备上报操作完成后的实际状态。

category: Tutorials
keywords:
- 期望状态
- 上报状态
- 状态差异
- 电源
- 快速入门
- desired
- reported
- delta
- power
- quickstart
language: zh-CN
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 已完成来源审查与本地测试；尚待实际环境验证
---

# 设备状态同步快速入门

目标：使用专用的命名影子，完成 desired → 设备操作 → reported 的完整流程。请先完成[事前准备](before-you-start.zh-CN.md)与[身份验证](authentication.zh-CN.md)，并分别备妥应用程序及设备的令牌文件。两个身份必须指向同一设备与品牌云端，且已启用 `mqtt` 和 `iot_shadow`。

[开启时序图](assets/shadow-sync.zh-CN.html)

## 1. 先订阅，再传送

在终端 A 配置主题根路径，并启动设备端监听程序。终端 B 也要使用相同的 `ROOT` 值。

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

等所有订阅都成功后再继续。这个监听程序用来显示教学中的消息往返；实际应用程序与固件应各自维护订阅，以及尚待响应的请求状态。

在终端 B 定义发布消息的辅助函数：

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

## 2. 先读取，再创建初始状态

```bash
shadow_publish "$TUTORIAL_DIR/device-token.json" get '{"clientToken":"tutorial-get-1"}'
```

若教学影子尚不存在，会收到带有 404 错误码的 `get/rejected`；若已存在，会收到 `get/accepted`，请先确认可以安全使用这份状态。本模拟器练习将期望状态与实际状态都设为电源关闭。若使用真实硬件，只能上报实际确认过的状态。

```bash
shadow_publish "$TUTORIAL_DIR/app-token.json" update \
  '{"state":{"desired":{"power":"off"}},"clientToken":"tutorial-baseline-app"}'
# Wait for update/accepted with the matching clientToken.
shadow_publish "$TUTORIAL_DIR/device-token.json" update \
  '{"state":{"reported":{"power":"off"}},"clientToken":"tutorial-baseline-device"}'
```

等待第二个 accepted 响应。影子不存在时，第一次 UPDATE 就会创建它，不需要额外调用创建 API。

## 3. 从应用程序要求变更

```bash
shadow_publish "$TUTORIAL_DIR/app-token.json" update \
  '{"state":{"desired":{"power":"on"}},"clientToken":"tutorial-app-on"}'
```

预期会收到包含 `clientToken:"tutorial-app-on"` 的 `update/accepted`，以及最上层 `state.power` 为 `"on"` 的 `update/delta`。delta 事件不使用 `state.delta.power` 结构；那是 GET 响应的结构。版本与时间戳由服务器产生，不需要与固定示例数值相同。

## 4. 执行操作，上报实际状态

先模拟开启电源，或由固件执行操作并确认硬件结果，之后才传送：

```bash
shadow_publish "$TUTORIAL_DIR/device-token.json" update \
  '{"state":{"reported":{"power":"on"}},"clientToken":"tutorial-device-on"}'
```

等待此请求的 accepted 响应。如果硬件操作失败，reported 仍须反映真实状态，并通过应用程序的诊断机制显示错误；不可只因收到 desired 就上报成功。

## 5. 确认状态一致

```bash
shadow_publish "$TUTORIAL_DIR/app-token.json" get '{"clientToken":"tutorial-get-2"}'
```

在 `get/accepted` 中，确认 `state.desired.power` 与 `state.reported.power` 都是 `"on"`，且没有 `state.delta.power`。若使用既有命名影子，其他属性仍可能存在差异。若是只含 `power` 的新教学影子，整个 delta 区段会被省略。

若未收到 delta，请 GET 当前状态：desired 可能原本就等于 reported，也可能是订阅失败，或设备缺少权限。等待固定秒数并不能证明更新成功。

下一步：[MQTT 与 HTTP 操作](shadow-interfaces.zh-CN.md)及[离线恢复](integration-recipes.zh-CN.md)。若要删除教学状态，请先停止监听程序，再依接口指南中的删除步骤操作。

架构说明：[影子文档的组成](shadow-concepts.zh-CN.md)。
