---
title: 文档导航
description: 依固件、应用程序或后端开发角色选择阅读路线，浏览完整文档。

category: Start here
keywords:
- 开始
- 阅读路线
- 固件
- 应用程序
- 后端
- 目录
- start
- learning path
- firmware
- App
- Backend
- contents
language: zh-CN
applies_to: Developer Docs Core + P0 + P1 source edition
last_verified: '2026-09-04'
verification: 已检查导航与本地搜索；服务验证状态以各页说明为准。
---

# 文档导航

## 选择阅读路线

| 开发角色 | 建议顺序 |
| --- | --- |
| 设备固件 | 事前准备 → 云端与设备配置 → 证书配置 → MQTT 快速入门 → 影子快速入门 → 应用程序与设备示例 → 状态模型 → 凭证恢复 |
| 应用程序 | 事前准备 → 证书配置 → 身份验证 → 应用程序与设备示例 → API 示例 → 状态模型 → 调试 |
| 后端 | 事前准备 → 云端与设备配置 → 后端指南 → HTTP 接口 → API 示例 → 冲突处理 → 连接限制 |

先从[事前准备](before-you-start.zh-CN.md)开始。两篇快速入门分别介绍单一协议的互动，再由[应用程序与设备示例](app-device-example.zh-CN.md)串起完整流程。只有尚未备妥获授权的测试身份或设备时，才需要进行注册。

## 依任务浏览

### 从这里开始

- [云端服务概览](overview.zh-CN.md)：了解 MQTT 消息传递、影子状态，以及设备与应用程序的分工。
- [事前准备](before-you-start.zh-CN.md)：备妥测试设备、获授权的身份、端点与命令行工具。
- [配置第一个云端与设备](setup-cloud-device.zh-CN.md)：创建 Product、完成设备认领，并在申请运行时凭证前确认设备已启用。
- [设备与应用程序证书配置](credential-setup.zh-CN.md)：在本地产生应用程序密钥与 CSR、取得证书，并区分设备出厂身份与运行时令牌。

### 教学

- [连接与消息交换快速入门](mqtt-quickstart.zh-CN.md)：发布 JSON 消息，并由另一个已验证的 MQTT 连接接收。
- [设备状态同步快速入门](shadow-quickstart.zh-CN.md)：从应用程序要求开启电源，确认设备上报操作后的状态。
- [应用程序与设备端对端示例](app-device-example.zh-CN.md)：分别执行两个客户端，确认 desired 与 reported 最后一致。

### 概念

- [设备影子概念](shadow-concepts.zh-CN.md)：了解 desired、reported、delta、影子名称、合并规则及版本。
- [设计设备状态模型](state-model.zh-CN.md)：设计兼容的 desired/reported 结构、命名影子、错误上报及并发写入。
- [设备连接状态与生命周期](device-presence.zh-CN.md)：区分账户就绪状态、MQTT 连接、owner 传输连接与应用程序健康状态。


### 集成开发

- [身份验证与访问控制](authentication.zh-CN.md)：取得运行时令牌，并将返回数据用于 MQTT 与影子 HTTP 验证。
- [MQTT 连接指南](mqtt-connection.zh-CN.md)：配置客户端身份与恢复流程，不依赖离线消息的持久传递。
- [后端集成指南](backend-integration.zh-CN.md)：选择获授权的后端身份，不借用设备凭证，完成已签名的影子操作。
- [通过 MQTT 与 HTTP 操作设备影子](shadow-interfaces.zh-CN.md)：使用完整 MQTT 主题或已签名 HTTP 请求进行操作。
- [集成实现示例](integration-recipes.zh-CN.md)：处理离线恢复与版本冲突，并如实上报设备状态。
- [设备所有权与分享](ownership-sharing.zh-CN.md)：了解账户绑定、授权分享与转售，并区分这些操作与设备身份。


### 维运与疑难排解

- [凭证更新与连接恢复](credential-recovery.zh-CN.md)：在凭证过期或网络中断后，更新运行时凭证并恢复订阅与状态。
- [集成调试指南](debugging.zh-CN.md)：定位第一个失败的协议层，整理不含敏感信息的支持报告。
- [疑难排解与兼容性](troubleshooting.zh-CN.md)：依协议层诊断失败原因，了解 RTK Shadow 的兼容范围。
- [集成测试工具包](integration-test-kit.zh-CN.md)：执行 MQTT Shadow 只读检查与明确启用的模拟控制，再验证生命周期及失败情况。


### 参考文档

- [MQTT 主题与消息参考](mqtt-topics.zh-CN.md)：区分应用程序自定义消息、设备传输封装与影子保留主题。
- [设备影子 API 与消息参考](shadow-reference.zh-CN.md)：查询影子路径、主题后缀、文档字段、限制与错误。
- [API 与消息示例](api-examples.zh-CN.md)：查看完整令牌与影子消息，理解字段省略及请求与响应对应规则。
- [连接配置与服务限制](connection-settings.zh-CN.md)：区分规格限制、观测到的开发环境 Broker 配置，以及仍需实际环境验证的功能。
- [兼容性与版本说明](compatibility-releases.zh-CN.md)：查阅客户端验证记录、RTK 命名空间差异及文档更新。

## 如何使用这组文档

教学提供目标、前置条件、时序、可执行步骤与预期结果；概念章节说明设计选择；集成指南解释运作机制。精确的协议字段与限制以参考文档为准，示例只作说明，不会重新定义规格。维运章节则介绍恢复与诊断。

桌面版可使用章节分组，移动版可使用分组章节菜单。搜索在本地涵盖所有已发布页面。网站索引不包含原始设计文档、维护者笔记或运行时凭证。即使导航分组调整，页面网址仍保持不变。

## 版本与验证

每页都会标示适用的源代码快照，以及已执行的验证类型。本地示例测试不等于实际环境验证。使用特定客户端与版本组合前，请先读[兼容性与版本说明](compatibility-releases.zh-CN.md)。Streaming／WebRTC、OTA 与 Telemetry 数据接收仍属后续批次；SDK 下载仍在 [ChipSet & SDK](/console/chipset-sdk)。
