---
title: 疑难排解与兼容性
description: 依协议层定位问题，了解 RTK 设备影子的兼容范围。

category: Operate and troubleshoot
keywords:
- 故障排查
- 兼容性
- 超时
- 身份验证
- 版本冲突
- '401'
- '403'
- '409'
- timeout
- AWS
- SigV4
- SUBACK
language: zh-CN
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 已完成来源审查与本地测试；尚待实际环境验证
---

# 疑难排解与兼容性

从第一个失败的环节开始检查：TLS、令牌签发、MQTT 连接、订阅、发布、影子响应，再到设备操作。某一层成功，不代表下一层也成功。

[开启时序图](assets/authentication-failures.zh-CN.html)

## 症状检查表

| 症状 | 检查项目与下一步 |
| --- | --- |
| TLS 握手失败 | 检查端点主机名称、CA 证书组、时钟、证书有效期限，以及私钥是否匹配 |
| 令牌请求被拒绝 | 检查请求 scope、证书对应的设备 ID、设备是否启用、应用程序授权及服务功能 |
| MQTT CONNECT 被拒绝 | 使用返回的 username 与 Client ID 基底、允许的角色后缀、有效访问令牌，并确认已启用 `mqtt` |
| 某个连接反复断开 | 可能有另一个程序使用相同 Client ID |
| SUBSCRIBE 被拒绝 | 使用明确获授权的完整主题；广泛的 Shadow 通配符或其他设备的保留主题不具相同权限 |
| 一般主题可用，影子操作失败 | 另外检查 `iot_shadow`，并确认目标与调用者权限 |
| 发布成功，没有影子响应 | 确认请求前已收到 SUBACK、完整响应主题正确，并检查等待中的请求令牌及应用程序超时 |
| 影子 GET 返回 404 | 启用设备不会创建状态；第一次有效 UPDATE 才会创建 |
| 更新 desired 后没有 delta | GET 当前状态；要求的属性可能已与 reported 一致 |
| 设备状态始终未改变 | 影子接受部分更新不会直接操作硬件；请检查固件处理流程 |
| HTTP 签名被拒绝 | 使用返回的 endpoint／region、服务名称 `iotdevicegateway`、会话令牌、有效凭证及正确时钟 |
| 409 | GET 当前版本后重新计算更新内容；不要原样重送过期版本 |
| 通知重复 | 至少一次传递允许重复；去重时不能漏掉同版本的不同事件类型 |
| 429 或响应缓慢 | 限制并发数、降低速率并延迟重试；向管理员确认部署限制 |

需要支持时，请记录 UTC 时间、操作、协议、状态／错误码、clientToken、允许提供的设备／影子识别值，以及 SDK／客户端版本。不要附上原始令牌、整组凭证、私钥或敏感的应用程序 payload。

## 兼容范围

RTK Shadow 采用 AWS 风格的文件、合并、delta、版本及 HTTP 数据接口模型。RTK MQTT 使用 `$vc/devices/{devid}/shadow/...`，`$aws/things/...` 不是别名。AWS Device SDK 的 MQTT 主题产生方式需要调整为 `$vc`；AWS 服务 SDK 则使用自定义 HTTP 端点与返回的 SigV4 凭证。

`thingName` 就是 RTK 的 `devid`。命名与未命名影子彼此独立。不要使用旧的 `/api/devices/{devid}/shadow` 路径、从主题字符串推导凭证，或自行插入内部租户前缀。文档模型本身不会限制设备只能写 reported、应用程序只能写 desired；权限由授权规则决定。

## 验证状态

本版对应各页元数据列出的源代码快照。本地协议测试与图表检查结果记录在维护者验证报告中。正式环境的连接限制、Broker 规则及服务授权限制，必须在目标环境验证；本版不代表任何部署已通过认证。不要为了让示例通过，就变更 API 行为、凭证或权限。

返回[概览](overview.zh-CN.md)、[MQTT 快速入门](mqtt-quickstart.zh-CN.md)或[设备状态同步快速入门](shadow-quickstart.zh-CN.md)。

延伸阅读：[逐步集成调试](debugging.zh-CN.md)。
