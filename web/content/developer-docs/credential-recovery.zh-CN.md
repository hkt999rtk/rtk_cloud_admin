---
title: 凭证更新与连线复原
description: 更新执行时凭据，并在到期或网路丢失后恢复订阅和状态。
category: Operate and troubleshoot
keywords:
- 更新
- 满期
- 重新连线
- 撤回
- 电视网
- renewal
- expiry
- reconnect
- revocation
- network
language: zh-CN
applies_to: RTK contracts 9b1ed887912e; Account Manager 54b37b9c407d; Video Cloud
  30fbb9a26155; Admin bbaf62f7d6b5
last_verified: '2026-09-04'
verification: 来源审查和本地检查；现场环境资格待定
---


# 凭证更新与连线复原

## 恢复示例元件

主管拥有凭证的终身许可权、重试预算和工人的清理工作。工人在MQTT订阅和影子对账方面拥有主权。私人临时令牌档案连线这些本地流程，并在退出时删除；没有云讯息历史记录储存在那里。这些是示例元件，不是额外的伺服器服务。

![恢复示例元件](assets/recovery-components.zh-CN.svg)

[全尺寸方块图](assets/recovery-components.zh-CN.svg) · [Mermaid 原始档](assets/recovery-components.zh-CN.mmd)

## 目标和先决条件

使装置整合在一个令牌寿命之外继续工作。准备证书、私钥、伺服器CA和特定于角色的mTLS端点透过[凭证设定](credential-setup.zh-CN.md)。使用[可下载模拟器](app-device-example.zh-CN.md)作为工作人员；下面的恢复执行者监督模拟装置。生产韧体必须保留其真实的硬体状态，而不是在处理器启动时重置模拟电源。

[开启重新设计的序列图](assets/credential-renewal.zh-CN.html)

## 凭证寿命规则

|凭证|续订行动|
| --- | --- |
|客户经理登入令牌|使用其自己的帐户身份验证流程；切勿将其传递给影片云重新整理|
|执行时MQTT JWT|在签署之前重新发行`exp`，用返回的元资料/密码重新连线|
|过期的执行时间 JWT|重复验证证书引导程式`/request_token` |
|HTTP SigV4捆绑包|请求一个新的捆绑包，包含`aws_iot_data:true`；重新整理不是套餐续订契约|
|到期/撤销的证书|使用授权证书注册/轮换；令牌重新整理无法修复它|

解码`exp`仅用于安排工作，而不是在本地授权。请求的TTL不是发行的终身有效期。重新整理会使用历史名称中的仍然有效的访问令牌`refresh_token`栏位。在更换本地档案之前，请验证替换。避免同时为相同的身份进行重新整理工作。

## 执行受限恢复主管

[下载Python示例](assets/shadow-demo.zip)，安装其固定依赖项，并使用Bash与设定一起使用[开始之前](before-you-start.zh-CN.md)。该档案包括`recover.py`与`demo.py`.

```bash
python recover.py --duration 3600 --attempts 6
```

主管使用`DEVICE_TOKEN_BASE`, `API_BASE`, `DEVICE_CERT`, `DEVICE_KEY`, `CA_FILE`, `DEVICE_ID`, `MQTT_HOST`和可选的`MQTT_PORT`/`SHADOW_NAME`。它建立一个私人临时令牌档案，并在退出时删除它。每个工作者的连线在GET之前订阅。它提前续订，在启动下一个工作者之前停止旧工作者，并在临时错误的情况下在固定尝试预算内退缩。这是一个可配置的教学策略，而不是服务SLA。Ctrl-C停止两个过程。

预期进度讯息包括：

```text
RECOVERY bootstrap succeeded
DEVICE ready: simulated power=off
RECOVERY reissue succeeded
DEVICE ready: simulated power=off
```

在短时间内，可能不会发生续订。让它超过退回的有效期才能获得续订资格；不要重写JWT索赔或停用过期检查。演示不声称在重新连线时提供不间断的MQTT传输。

## 网路更改和重新连线对账

[开启重新设计的序列图](assets/network-recovery.zh-CN.html)

DNS更改、Wi-Fi交换机或插座关闭需要重新建立传输连线。使用当前端点设定和TLS验证，允许DNS再次解析，并避免同时使用一个客户端ID的客户端。在CONNACK后，等待SUBACK、GET并建立一个新的状态基线，然后消耗差分。不要假设清洁会话离线传输或重播每次错过的差分。

在专用的测试环境中暂时停止网路，在装置缺席时更改所需值，然后在主管截止日期前恢复连线。预期结果：重新连线，获取当前所需值，应用/读取回，报告实际状态。如果工作人员反复退出或收到无效的应用状态，受限的故障预算将终止诊断执行，而不是无限期地隐藏故障。

## 到期和撤销分支

重新整理401会在每次尝试后恢复到证书引导；过期的证书或失败的引导会停止进度。在本例中，403是终止状态：检查范围、装置启动、会员资格、证书状态和权利。不要增加许可权、反复轮换证书或继续使用被拒绝的快取凭据。

撤销传播和强制断开连线的时间不是作为通用部署保证的。资格验证已连线的客户端和新的令牌/连线尝试。如果撤销后现有流量仍然可能，请报告观察到的边界，而不是声称立即执行。证书轮换可能会影响同一全球使用者的其他安装。

## 失败和资格清单

测试有效重新发行、过期令牌引导、错误的CA、撤销身份、拒绝目标、临时HTTP 503、网路丢失和用尽重试预算。发生变异后的超时导致结果未知：替换前GET。执行者的策略测试没有建立即时执行或持续的服务可用性。下一个：[整合除错](debugging.zh-CN.md), [连线设定](connection-settings.zh-CN.md).
