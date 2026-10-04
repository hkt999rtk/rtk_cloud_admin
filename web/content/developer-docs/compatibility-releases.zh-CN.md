---
title: 兼容性与版本说明
description: 查阅已完成的客户端验证、RTK 命名空间差异及文档变更记录。

category: Reference
keywords:
- 兼容性
- 迁移
- 版本
- 发布
- 验证
- AWS
- migration
- versions
- release
- qualification
language: zh-CN
applies_to: RTK contracts 9b1ed887912e; Account Manager 54b37b9c407d; Video Cloud
  30fbb9a26155; Admin bbaf62f7d6b5
last_verified: '2026-09-04'
verification: 已完成来源审查与本地检查；尚待实际环境验证
---

# 兼容性与版本说明

## 适用范围与验证层级

本页记录已审查的 RTK 规格与文档包，不代表所有 AWS 客户端或部署环境都已通过验证。各页元数据会列出适用的源代码快照。请区分来源审查、本地解析与规则测试、浏览器测试，以及对实际 Broker／服务执行的测试。

| 客户端或接口 | 本版已完成的验证 | 尚未确认的范围 |
| --- | --- | --- |
| Python 3.13 / paho-mqtt 2.1.0 | 示例逻辑测试与 callback API 构建 | 此新示例与实际 RTK MQTT 环境的互通性 |
| Python 3.10+ | 示例预定支持的语法与最低执行版本 | 每个支持的 Python 次版本及平台都能执行 |
| curl / Mosquitto 命令行示例 | 命令语法与来源审查 | 固定版本、跨平台的实际环境验证矩阵 |
| Admin 文档阅读页 | 桌面 Chromium 与 Pixel 7 窗口尺寸下的链接、搜索与下载检查 | 所有浏览器、实体手机或辅助技术 |
| RTK 客户端 SDK | 提供维护中的 ChipSet & SDK 软件包链接 | 软件包存在不代表各版本都兼容 |
| AWS 服务／Device SDK | 下方说明的规格对应 | 全面二进制／API 兼容性，或可使用 AWS 账户凭证 |

SDK 软件包版本及发布验证记录请查阅 [ChipSet & SDK](/console/chipset-sdk)。未执行的测试不可标为「通过」。目标环境配额、缺少功能授权时的拒绝行为、撤销生效时间，以及完整接入流程，仍需在实际环境中验证。

## RTK 与 AWS 风格接口的对应

| 项目 | RTK 集成方式 |
| --- | --- |
| 状态、递归合并、delta、版本 | 采用 AWS 风格的公开文档模型；限制与字段省略规则以本版为准 |
| Thing 识别值 | `thingName` 对应 RTK 运行时 `devid`，不是任意 AWS IoT Thing |
| MQTT 主题 | `$vc/devices/{devid}/shadow/...`；`$aws/things/...` 不是别名 |
| HTTP | 使用返回的自定义 `iotDataEndpoint`、SigV4 服务名称 `iotdevicegateway`、region 与会话凭证 |
| 租户路由 | 由授权结果决定；不要自行加入内部命名空间前缀 |
| 命名影子列表 | 使用 HTTP 列表路径；没有 MQTT 列表操作 |
| 旧版 RTK Shadow 路径 | `/api/devices/{devid}/shadow` 与 `/shadows` 不属于公开支持的兼容路径 |

## 迁移示例

以名为 `tutorial` 的影子为例，请在组合协议主题的位置修改：

```text
AWS-style: $aws/things/device-1/shadow/name/tutorial/update
RTK:       $vc/devices/device-1/shadow/name/tutorial/update
```

对 get/delete 及所有完整的 accepted/rejected/delta/documents 订阅，都应用相同的根路径对应。不要替换 JSON 状态内的任意字符串，也不要假设 SDK 的自动主题产生器一定能调整。若无法调整，请使用支持的转接层或客户端。MQTT 验证也必须改用 RTK 响应中的数据，只改主题并不足够。

HTTP 客户端应使用 RTK 返回的 endpoint、region 与会话凭证，并保留签名所用的标准 HTTP method、path、query 及 HTTP 头。可用 `GET /things/device-1/shadow?name=tutorial` 验证目标。不要将这些凭证送到默认 AWS 端点，也不要当成 AWS 账户密钥使用。

切换前，请依 [API 示例](api-examples.zh-CN.md)比对 GET 字段省略、null 删除、accepted 部分更新结构、通知快照、请求对应、冲突、删除重建与重连行为。在获授权的目标环境测试通过前，保留可恢复旧集成的方式。

## 文档版本记录

| 日期／版本 | 变更 | 发布状态 |
| --- | --- | --- |
| 2026-09-04 / Core | 十二篇 MQTT／Shadow 章节、Mermaid 图表与本地全文搜索 | 已交付的核心版本 |
| 2026-09-04 / P0 | 接入流程、证书配置、独立 App／Device 示例、后端指南及观测到的开发环境配置 | 工作区新增内容；不是服务发布 |
| 2026-09-04 / P1 | 消息示例、凭证恢复程序、状态建模、调试与兼容性；分组导航及依角色安排的阅读路线 | 工作区新增内容；不代表已部署 |

这些文档版本未变更任何服务 API、主题、凭证政策或权限。P0／P1 是文档编写里程碑，不是服务的语义化版本。

## 新增生命周期与测试工具包 — 2026-09-04

新增「设备所有权与分享」、「设备连接状态与生命周期」及「集成测试工具包」。软件包新增只读检查，以及必须明确启用的模拟器操作测试。这是文档与软件包更新，不是服务发布或实际环境验证结果，部署仍待完成。

## 架构图审查 — 2026-09-04

新增八张框图，说明凭证用途、后端责任、MQTT 主题分类、影子状态与接口、状态拆分、恢复组件及分层诊断。九篇指南嵌入这些图表，快速入门则连到对应的架构指南。既有协议行为与页面网址保持不变。

## 维护本记录

未来每次变更，请记录日期、规格／服务／客户端版本、行为差异、受影响的页面与示例、迁移步骤、验证记录及实际部署状态。文档修正不应默默变成新的服务能力承诺。请保留既有页面网址；停用页面时，明确安排重定向。[文档导航](documentation-map.zh-CN.md)说明各章用途与阅读顺序。
