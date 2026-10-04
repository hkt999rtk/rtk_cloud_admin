---
title: MQTT 连接指南
description: 配置客户端身份与恢复流程，不假设服务会持久保存
  并补发离线消息。
category: Build integrations
keywords:
- 客户端标识符
- 服务质量
- 保活
- 会话
- 重连
- 保留消息
- Client ID
- QoS
- Keep Alive
- session
- reconnect
- retain
language: zh-CN
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 来源审查与本地测试；实际环境验证仍待完成
---

# MQTT 连接指南

请使用环境提供的公开 MQTT TLS 监听端点。令牌响应包含用户名与 Client ID 信息，不包含主机、端口或 CA 信任证书包。请验证服务器证书与主机名。

[打开 MQTT 重连时序图](assets/mqtt-reconnect.zh-CN.html)

## 连接配置

| 配置 | 教程使用的值 | 说明 |
| --- | --- | --- |
| 协议 | MQTT 3.1.1（`-V mqttv311`） | 客户端明确选用此版本，不代表服务仅支持此版本 |
| Keep Alive | 60 秒（`-k 60`） | 示例客户端配置；请确认部署环境的限制 |
| 会话 | Mosquitto 默认的 Clean Session | 重新连接后要重新订阅，不假设会重放离线消息 |
| QoS | 1 | 至少一次传输，应用可能重复处理 |
| Retain | 关闭；不使用 `-r` | 教程发布的消息不会设为保留消息 |
| Client ID | 返回的基础 ID 加上 `-watch` 或 `-send` | 避免教程中的连接相互替换 |

已审查的公开传输规范未定义通用的 Keep Alive 上限、会话持久化策略、保留消息策略，或普通主题的 QoS 要求。设计离线队列前，请先获取部署环境的这些配置。运行时日志有自己的 QoS 1 规范，不可套用到所有主题。

## 恢复步骤

1. 断开连接时暂停依赖连接的操作；消息仅进入本地队列时，不可报告发布已完成。
2. 检查有效期，必要时更新凭证。凭证或权限无效时，停止反复重试，并提供可据以处理的错误信息。
3. 暂时性连接失败时，使用加入随机延迟且设有上限的指数退避重试。
4. 使用当前用户名、密码与 Client ID 信息重新连接。
5. 订阅必要主题，并等待成功的 SUBACK。
6. 使用 Shadow 时，先以 GET 获取当前状态并与设备实际状态同步，再处理队列中的通知。

凭证仍有效时，请保持该角色的连接身份稳定。并发连接不可使用相同 Client ID。教程中的短期发布进程，只有在前一个发布进程退出后，才能复用 `-send`。

## 三种不同的确认消息

**PUBACK** 确认 QoS 1 消息已在传输层收到。**Shadow `update/accepted`** 确认 Shadow 状态变更成功。**实际上报值**代表固件声明已应用的状态。只有固件验证或应用层执行结果，才能确认硬件操作成功。

不要仅因在收到结果前断开连接，就重试非幂等操作。应先读取当前状态，或使用应用的操作标识确认结果。Shadow 的 `clientToken` 用于关联请求，不保证服务器端会去除重复操作。

下一步：[离线与冲突处理示例](integration-recipes.zh-CN.md)。

延伸阅读：[运行凭证恢复监控进程](credential-recovery.zh-CN.md)。

延伸阅读：[设备在线状态与主连接](device-presence.zh-CN.md)。
