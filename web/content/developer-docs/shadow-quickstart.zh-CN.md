---
title: 快速入门：同步装置状态
description: 从应用程式请求开机，并确认装置报告了所应用状态。
category: Tutorials
keywords:
- 渴望的
- 报告的
- 三角洲
- 力量
- 快速启动
- desired
- reported
- delta
- power
- quickstart
language: zh-CN
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 来源审查和本地测试；现场环境资格待定
---


# 快速入门：同步装置状态

目标：使用专用的名为Shadow的装置完成一个真实的理想→装置操作→报告的周期。 完整的[设定](before-you-start.zh-CN.md)与[身分验证](authentication.zh-CN.md)，包括单独的应用程式和装置令牌档案。两个主机都必须针对相同的装置和品牌云`mqtt`与`iot_shadow`启用。

[开启重新设计的序列图](assets/shadow-sync.zh-CN.html)

## 1. 传送前订阅

在终端A中，设定根并启动装置观察器。重复使用这个`ROOT`终端B中的值。

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

等待所有请求的订阅成功。观察者会显示本教学的交换；一个真正的应用程式和韧体都保持自己的订阅和待处理请求状态。

在终端B中定义一个小型发布助手：

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

## 2.先阅读，然后建立基线

```bash
shadow_publish "$TUTORIAL_DIR/device-token.json" get '{"clientToken":"tutorial-get-1"}'
```

新的教学《Shadow》回归`get/rejected`带有程式404。现有的程式会返回`get/accepted`；在继续之前，请验证使用是否安全。在本模拟器练习中，将关机设定为所需和实际状态。在硬体上，仅报告您实际验证过的状态。

```bash
shadow_publish "$TUTORIAL_DIR/app-token.json" update \
  '{"state":{"desired":{"power":"off"}},"clientToken":"tutorial-baseline-app"}'
# Wait for update/accepted with the matching clientToken.
shadow_publish "$TUTORIAL_DIR/device-token.json" update \
  '{"state":{"reported":{"power":"off"}},"clientToken":"tutorial-baseline-device"}'
```

等待第二个接受的响应。第一次更新会建立一个丢失的影子；不需要明确建立API。

## 3.从应用程式中请求更改

```bash
shadow_publish "$TUTORIAL_DIR/app-token.json" update \
  '{"state":{"desired":{"power":"on"}},"clientToken":"tutorial-app-on"}'
```

预期`update/accepted`与`clientToken:"tutorial-app-on"`与`update/delta`谁的顶级层`state.power`是`"on"`。三角洲事件的形状不是`state.delta.power`；GET响应使用这种层次结构。版本和时间戳是伺服器值，不需要与固定示例匹配。

## 4. 申请并报告实际状态

模拟开机，或让韧体应用并验证硬体操作。只有这样才能传送：

```bash
shadow_publish "$TUTORIAL_DIR/device-token.json" update \
  '{"state":{"reported":{"power":"on"}},"clientToken":"tutorial-device-on"}'
```

等待其接受的响应。如果硬体失败，请保持报告的状态准确，并透过应用程式诊断揭示故障；切勿仅仅因为收到所需内容就报告成功。

## 5. 验证收敛性

```bash
shadow_publish "$TUTORIAL_DIR/app-token.json" get '{"clientToken":"tutorial-get-2"}'
```

在`get/accepted`，检查`state.desired.power`与`state.reported.power`都是`"on"`与`state.delta.power`缺失。现有名称的Shadow中的其他属性可能仍然存在差异。在全新的教学中，Shadow只有`power`，三角洲部分被完全省略了。

如果没有达尔塔到达，请获取当前状态：所需值可能已经等于报告值，订阅可能失败，或者装置可能缺少许可权。不要使用固定睡眠作为成功突变的证据。

下一个：[MQTT和HTTP操作](shadow-interfaces.zh-CN.md)与[离线恢复](integration-recipes.zh-CN.md).要删除教学状态，请在停止观察者后使用介面指南中的明确删除步骤。

建筑：[影子档案体系结构](shadow-concepts.zh-CN.md).
