---
title: 疑难排解与相容性
description: 按协议层诊断故障，并了解RTK Shadow相容性边界。
category: Operate and troubleshoot
keywords:
- '401'
- '403'
- '409'
- 暂停
- 伺服器
- 体4
- SUBACK
- '401'
- '403'
- '409'
- timeout
- AWS
- SigV4
language: zh-CN
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 来源审查和本地测试；现场环境资格待定
---


# 疑难排解与相容性

从第一个故障层开始：TLS、令牌发行、MQTT连线、订阅、释出、影子响应，然后是装置操作。一个层次的成功并不证明下一层。

[开启重新设计的序列图](assets/authentication-failures.zh-CN.html)

## 症状清单

|症状|检查并下一步操作|
| --- | --- |
|TLS握手失败|端点主机名称、CA捆绑包、时钟、证书有效期、匹配的私钥|
|令牌请求被拒绝|请求范围、证书衍生装置ID、活动装置、应用程式授权、功能|
|MQTT连线被拒绝|返回的使用者名称和基本客户端ID、允许的角色字尾、当前访问令牌，`mqtt`能力|
|一个连线反复断开|另一个过程可能使用相同的客户端ID|
|订阅被拒绝|使用确切授予的主题；广泛的影子万用字元和另一个装置保留的主题不等同|
|一般主题有效，影子失败|验证`iot_shadow`独立确认目标/主要许可权|
|释出成功，没有Shadow回复|在请求之前验证SUBACK，确切的响应主题、待处理的请求令牌和应用程式超时|
|Shadow GET返回404|启动不会建立状态；第一个有效的UPDATE会建立状态|
|在所需更新后没有差异|获取当前状态；请求的属性可能已经与报告的状态匹配|
|装置从未改变状态|已接受的Shadow补丁程式不会执行硬体；检查韧体处理|
|HTTP签名被拒绝|使用返回的端点/地区、服务`iotdevicegateway`，会话令牌，当前凭据和时钟|
| 409 |获取当前版本并进行对账；不要重新传送不变的过期版本|
|重复通知|至少一次交付允许重复；不丢失相同版本的事件型别的去重|
|429或缓慢的响应|限制并发执行，降低速度并退缩；请求部署限制|

如需支援，请记录UTC时间、操作、协议、状态/错误程式、clientToken、装置/影子识别符号（如果允许）以及SDK/客户端版本。请排除原始令牌、凭证捆绑包、私钥和敏感应用程式有效载荷。

## 相容性边界

RTK Shadow遵循AWS风格的档案、合并、差分、版本和HTTP资料平面模型。RTK MQTT使用`$vc/devices/{devid}/shadow/...`. `$aws/things/...`不是别名。AWS Device SDK MQTT主题构建器需要适应`$vc`；AWS服务SDK使用带有返回的SigV4凭据的自定义HTTP端点。

`thingName`是RTK吗`devid`。命名和未命名的影子是独立的。不要使用旧的`/api/devices/{devid}/shadow`路由，从主题字串中推断凭据，或插入内部租户字首。不要假设档案模型本身会限制装置仅报告和应用程式仅为所需；策略定义许可权。

## 资格状态

本版本与页面元资料中的源快照相关联。本地协议测试和图表检查记录在维护者验证报告中。生产连线限制、经纪商策略和权利执行必须根据您的目标环境进行验证；本版本不证实部署。API行为、凭据或许可权不得更改以使示例透过。

返回[概述](overview.zh-CN.md), [MQTT快速入门](mqtt-quickstart.zh-CN.md)，或者[影子快速入门](shadow-quickstart.zh-CN.md).

继续：[分步整合除错](debugging.zh-CN.md).
