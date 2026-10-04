---
title: 快速入门：连接与交换消息
description: 发布一条 JSON 消息，再通过另一条已验证的 MQTT
  连接接收。
category: Tutorials
keywords:
- 发布
- 订阅
- 消息交换
- publish
- subscribe
- SUBACK
- PUBACK
- mosquitto
language: zh-CN
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 来源审查与本地测试；实际环境验证仍待完成
---

# 快速入门：连接与交换消息

目标：在应用自定义的主题收到 `{"temperature_c":23}`。请先完成[身份验证](authentication.zh-CN.md)。以下两条连接都使用测试设备令牌，但使用不同的角色后缀。先以同一身份确认 MQTT 运行，再在 Shadow 教程中加入第二个身份主体。

[打开 MQTT 消息交换时序图](assets/mqtt-exchange.zh-CN.html)

## 1. 启动订阅端

在已配置必要变量的终端 A 中执行：

```bash
mosquitto_sub -h "$MQTT_HOST" -p "$MQTT_PORT" --cafile "$CA_FILE" \
  -u "$(jq -er '.mqtt.username' "$TUTORIAL_DIR/device-token.json")" \
  -P "$(jq -er '.access_token' "$TUTORIAL_DIR/device-token.json")" \
  -i "$(jq -er '.mqtt.client_id' "$TUTORIAL_DIR/device-token.json")-watch" \
  -V mqttv311 -k 60 -q 1 -d -v \
  -t "tutorials/$DEVICE_ID/temperature"
```

请等待调试输出显示 SUBACK 成功后再发布消息。进程正在运行，不代表订阅成功。这些本地测试命令会通过进程参数传入凭证；请使用隔离的开发机器，避免将命令调用内容记录在共享日志中。

## 2. 发布消息

在终端 B 使用相同环境与 `TUTORIAL_DIR` 执行：

```bash
mosquitto_pub -h "$MQTT_HOST" -p "$MQTT_PORT" --cafile "$CA_FILE" \
  -u "$(jq -er '.mqtt.username' "$TUTORIAL_DIR/device-token.json")" \
  -P "$(jq -er '.access_token' "$TUTORIAL_DIR/device-token.json")" \
  -i "$(jq -er '.mqtt.client_id' "$TUTORIAL_DIR/device-token.json")-send" \
  -V mqttv311 -k 60 -q 1 \
  -t "tutorials/$DEVICE_ID/temperature" -m '{"temperature_c":23}'
```

## 3. 验证消息传递

终端 A 应显示：

```text
tutorials/device-1/temperature {"temperature_c":23}
```

这份 JSON 是应用自定义的示例数据格式；Broker 不会将其转成 Shadow 状态。QoS 1 发布命令完成，仅确认传输层已收到消息，不代表订阅端的业务逻辑已完成。消息仍可能重复传递。完成后，使用 Ctrl-C 停止订阅端。

## 未收到消息时

确认 SUBACK 成功、主题拼写一致、Brand Cloud 身份一致，且 Client ID 不同。较晚才订阅时，不会重放此前未保留的消息。普通主题操作成功，不代表已具备 Shadow 权限。

下一步：[连接行为](mqtt-connection.zh-CN.md)、[主题参考](mqtt-topics.zh-CN.md)或 [Shadow 快速入门](shadow-quickstart.zh-CN.md)。

架构说明：[MQTT 主题架构](mqtt-topics.zh-CN.md)。
