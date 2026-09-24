---
title: 快速入门：连线与交换讯息
description: 释出一个JSON讯息，并透过第二个已验证的MQTT连线接收它。
category: Tutorials
keywords:
- 发布
- 订阅
- SUBACK
- PUBACK
- mosquitto
- publish
- subscribe
language: zh-CN
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 来源审查和本地测试；现场环境资格待定
---


# 快速入门：连线与交换讯息

目标：接收`{"temperature_c":23}`，透过应用程式定义的主题传送。请先完成[身分验证](authentication.zh-CN.md)。下方两个连线都使用测试装置权杖，但采用不同的角色字尾。这样可先验证 MQTT 机制，再于装置影子教学加入第二个主体。

[开启重新设计的序列图](assets/mqtt-exchange.zh-CN.html)

## 1. 开始订阅者

在设定了先决变数的A终端执行：

```bash
mosquitto_sub -h "$MQTT_HOST" -p "$MQTT_PORT" --cafile "$CA_FILE" \
  -u "$(jq -er '.mqtt.username' "$TUTORIAL_DIR/device-token.json")" \
  -P "$(jq -er '.access_token' "$TUTORIAL_DIR/device-token.json")" \
  -i "$(jq -er '.mqtt.client_id' "$TUTORIAL_DIR/device-token.json")-watch" \
  -V mqttv311 -k 60 -q 1 -d -v \
  -t "tutorials/$DEVICE_ID/temperature"
```

在释出之前，请等待除错输出显示成功SUBACK。仅仅执行一个执行中的过程并不能证明订阅成功。这些本地测试命令将凭据作为过程引数传递；使用孤立的开发机器，并避免在共享日志中捕获命令呼叫。

## 2. 释出讯息

在B埠，使用相同的环境和`TUTORIAL_DIR`:

```bash
mosquitto_pub -h "$MQTT_HOST" -p "$MQTT_PORT" --cafile "$CA_FILE" \
  -u "$(jq -er '.mqtt.username' "$TUTORIAL_DIR/device-token.json")" \
  -P "$(jq -er '.access_token' "$TUTORIAL_DIR/device-token.json")" \
  -i "$(jq -er '.mqtt.client_id' "$TUTORIAL_DIR/device-token.json")-send" \
  -V mqttv311 -k 60 -q 1 \
  -t "tutorials/$DEVICE_ID/temperature" -m '{"temperature_c":23}'
```

## 3. 验证交付

终端A应该列印：

```text
tutorials/device-1/temperature {"temperature_c":23}
```

JSON是您的应用程式的示例模式；代理服务不会将其转换为影子状态。在QoS 1结束时发布命令确认传输接收，而不是订阅者业务逻辑。重复传送仍然是可能的。完成后，请使用Ctrl-C停止订阅者。

## 如果没有收到讯息

检查SUBACK是否成功，匹配主题拼写，匹配品牌云身份，以及不同的客户端ID。不要指望您稍后订阅时会重播较早的未保留讯息。成功的通用主题并不能表明影子许可权。

下一个：[连线行为](mqtt-connection.zh-CN.md), [主题参考](mqtt-topics.zh-CN.md)，或者[影子快速入门](shadow-quickstart.zh-CN.md).

建筑：[MQTT主题架构](mqtt-topics.zh-CN.md).
