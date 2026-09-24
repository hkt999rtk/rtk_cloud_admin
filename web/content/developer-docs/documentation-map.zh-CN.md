---
title: 文件导览
description: 选择一个韧体、应用程式或后端学习路线，然后浏览完整的档案集合。
category: Start here
keywords:
- 开始
- 学习途径
- 韧体中的程式）
- 应用程式
- 后端
- 内容
- start
- learning path
- firmware
- App
- Backend
- contents
language: zh-CN
applies_to: Developer Docs Core + P0 + P1 source edition
last_verified: '2026-09-04'
verification: 导航和本地搜寻检查；服务资格因页面而异
---


# 文件导览

## 选择你的道路

|开发人员|建议的顺序|
| --- | --- |
|装置韧体|先决条件→云/装置设定→凭据设定→MQTT快速入门→影子快速入门→两个主机元例→状态模型→凭据恢复|
|应用程式|先决条件→凭证设定→身份验证→双主机示例→API示例→状态模型→除错|
|后端|先决条件→云/装置设定→后端指南→HTTP介面→API示例→冲突食谱→连线限制|

先阅读[开始之前](before-you-start.zh-CN.md)。这两个快速入门教导了单个协议的互动；[应用程式和装置示例](app-device-example.zh-CN.md)将它们连线起来。只有当您的授权测试身份/装置尚未准备好时，才需要注册。

## 按任务浏览

### 入门

- [云端服务概览](overview.zh-CN.md)— 了解MQTT讯息传递、影子状态以及装置和应用程式的角色。
- [开始之前](before-you-start.zh-CN.md)— 准备一个测试装置、授权身份、端点和命令列工具。
- [建立第一个云端与装置](setup-cloud-device.zh-CN.md)— 在请求执行时凭据之前，建立产品、解决装置索赔并验证启动。
- [设定装置与应用程式凭证](credential-setup.zh-CN.md)— 生成本地应用程式金钥和CSR，获取证书，并区分工厂装置身份与执行时令牌。

### 教学

- [快速入门：连线与交换讯息](mqtt-quickstart.zh-CN.md)— 释出JSON讯息，并透过第二个已验证的MQTT连线接收讯息。
- [快速入门：同步装置状态](shadow-quickstart.zh-CN.md)—从应用程式请求开机，并确认装置报告了所应用状态。
- [端到端应用程式与装置范例](app-device-example.zh-CN.md)—执行独立的应用程式和装置客户端，并验证所需到报告的收敛。

### 概念

- [装置影子概念](shadow-concepts.zh-CN.md)— 了解所需和报告的状态、差异、名称、合并规则和版本。
- [设计装置状态模型](state-model.zh-CN.md)—设计相容的所需和报告状态、名为Shadows的状态、故障报告和并行写入器。
- [装置在线状态与生命周期](device-presence.zh-CN.md)—区分帐户就绪性、MQTT连线性、所有者运输和应用程式健康状况。


### 构建整合

- [身分验证与存取控制](authentication.zh-CN.md)—获取执行时令牌，并将其元资料对映到MQTT和Shadow HTTP凭据中。
- [MQTT 连线指南](mqtt-connection.zh-CN.md)—在不假设持久离线交付的情况下配置客户端身份和恢复。
- [后端整合指南](backend-integration.zh-CN.md)— 选择一个授权的后端身份，并在不借用装置凭据的情况下执行已签名的影子操作。
- [透过 MQTT 与 HTTP 使用装置影子](shadow-interfaces.zh-CN.md)—使用精确的MQTT主题或已签名的HTTP请求执行影子操作。
- [整合实作范例](integration-recipes.zh-CN.md)—从离线期间恢复，解决冲突，并保持报告的状态真实。
- [装置所有权与分享](ownership-sharing.zh-CN.md)— 了解帐户系结、授权共享和转售，而不会将它们与装置身份混淆。


### 操作和故障排除

- [凭证更新与连线复原](credential-recovery.zh-CN.md)— 更新执行时凭据，并在到期或网路丢失后恢复订阅和状态。
- [整合除错](debugging.zh-CN.md)— 找到第一个故障的协议层，并准备一份有用的消毒支援报告。
- [疑难排解与相容性](troubleshooting.zh-CN.md)—按协议层诊断故障，并了解RTK Shadow相容性边界。
- [整合测试工具组](integration-test-kit.zh-CN.md)—执行只读MQTT影子探测器和自愿模拟控制演习，然后评估生命周期和故障案例。


### 参考

- [MQTT 主题与讯息参考](mqtt-topics.zh-CN.md)— 单独定义的应用程式讯息、装置传输信封和保留的影子主题。
- [装置影子 API 与讯息参考](shadow-reference.zh-CN.md)—查询影子路径、主题字尾、档案栏位、限制和错误。
- [API 与讯息范例](api-examples.zh-CN.md)—检查完整的说明符号和影子讯息，包括栏位省略和相关性规则。
- [连线设定与服务限制](connection-settings.zh-CN.md)—区分契约限制、观察到的dev经纪商设定以及需要环境资格的特征。
- [相容性与版本说明](compatibility-releases.zh-CN.md)— 跟踪合格客户的证据、RTK名称空间差异和档案更改。

## 如何使用此集合

教学包含目标、先决条件、顺序、可执行步骤和预期结果。概念解释设计选择。整合指南解释机制。参考资料拥有自己的确切协议栏位和限制；示例在不重新定义它们的情况下说明它们。操作章节解释恢复和诊断。

在桌面上使用章节组，或在手机上使用分组章节选择器。搜寻覆盖了本地发布的所有页面。来源设计档案、维护者备注和执行时凭据不包括在网站索引中。页面URL在导航组更改时保持稳定。

## 版本和资格

每页都列出了适用的快照和执行的验证型别。本地样本测试不是即时环境资格。 阅读[相容性与版本说明](compatibility-releases.zh-CN.md)在依赖客户端/版本组合之前。流媒体/WebRTC、OTA和遥测汇入仍然是未来的批次；SDK下载仍然在[晶片组和SDK](/console/chipset-sdk).
