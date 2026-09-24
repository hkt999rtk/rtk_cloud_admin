---
title: 装置影子 API 与讯息参考
description: 查询影子路径、主题字尾、档案栏位、限制和错误。
category: Reference
keywords:
- '409'
- '413'
- '429'
- 客户端令牌
- 版本
- 8千位元组
- 名称
- '409'
- '413'
- '429'
- clientToken
- version
- 8 KiB
- name
language: zh-CN
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 来源审查和本地测试；现场环境资格待定
---


# 装置影子 API 与讯息参考

## 身份和路线

|专案|契约|
| --- | --- |
| `devid` / `thingName` |1-128个字元，`[A-Za-z0-9:_-]+` |
|命名的影子|1-64个字元，`[$A-Za-z0-9:_-]+` |
|无名MQTT根| `$vc/devices/{devid}/shadow` |
|命名为MQTT根| `$vc/devices/{devid}/shadow/name/{shadowName}` |
|阅读| `GET /things/{thingName}/shadow?name={shadowName}` |
|更新/建立| `POST /things/{thingName}/shadow?name={shadowName}` |
|删除| `DELETE /things/{thingName}/shadow?name={shadowName}` |
|名称列表| `GET /api/things/shadow/ListNamedShadowsForThing/{thingName}` |

省略`name`选择无名影子。URL编码名称和ID。列表接受`pageSize`从1到100，以及不透明的`nextToken`。老的`/api/devices/{devid}/shadow`与`/api/devices/{devid}/shadows`路由不是公共相容路由。

## MQTT字尾

将这些字尾新增到所选根字元中。客户端释出请求并订阅响应/通知；服务端传送后者。

|请求字尾|响应字尾|其他通知|
| --- | --- | --- |
| `/get` | `/get/accepted`, `/get/rejected` | — |
| `/update` | `/update/accepted`, `/update/rejected` | `/update/delta`, `/update/documents` |
| `/delete` | `/delete/accepted`, `/delete/rejected` | — |

在请求之前订阅确切的主题。删除忽略MQTT有效负载。本契约中没有MQTT列表操作；请使用HTTP进行名称阴影列表。

## 更新请求

```json
{
  "state": {"desired": {"power": "on"}},
  "version": 7,
  "clientToken": "tutorial-app-on"
}
```

`state`是更新容器。 供应`desired`, `reported`，或两者都用于状态更改；空状态物件也被接受。`version`与`clientToken`是可选的。在本例中，版本7是示例：用当前的GET版本替换或省略它以获得无条件补丁。客户端不会写入差分、元资料或时间戳。

|栏位或规则|含义|
| --- | --- |
|物件补丁|递回合并；省略的属性仍然存在|
|财产`null` |移除该属性|
| `desired:null` / `reported:null` |移除该部分|
|阵列|原子替换；空元素无效|
| `version` |比较和更新保护器；不匹配返回409|
| `clientToken` |相关性字串，最多64个UTF-8位元组；不重复|

## 回复档案

|回应|内容|
| --- | --- |
|被接受|当前状态、元资料、版本、周期时间戳；省略了空部分|
|更新已接受|接受所需/报告的补丁程式和相关元资料；而不是整个档案|
|更新三角形|完成顶级层面的当前差异`state`，所需元资料、版本、时间戳|
|更新档案| `previous`与`current`快照，每个快照都包含状态/元资料/版本；信封时间戳|
|已接受删除| `{}` |
|被拒绝| `code`, `message`，时代`timestamp`，以及一个有效的请求`clientToken`在适用的情况下|

例如，三角事件使用`state.power`，而完整的GET使用`state.delta.power`.元资料映象属性结构，无需`children`封面。公共国家档案没有`updated_at`。 治疗`clientToken`作为特定于响应的响应，而不是假设每条讯息都会回应它。

示例被拒绝的回复：

```json
{"code":409,"message":"Version conflict","timestamp":1788480000,"clientToken":"tutorial-app-on"}
```

## 限制和错误

|限制|价值|
| --- | --- |
|所需/报告的状态大小|8 KiB，不包括生成的元资料；合并储存状态重新验证|
|状态巢状|最多八个级别|
|编码|有效的UTF-8 JSON|
| `clientToken` |最多64个UTF-8位元组|
|命名列表页面大小| 1–100 |
|删除版本连续性|48小时墓碑视窗|
|请求机票价格和机上容量|部署定义；不要硬编码未记录的通用数字|

|程式|开发者行动|
| --- | --- |
| 400 |正确的JSON、名称、状态形状或无效的阵列/空值使用|
| 401 |重新验证或更正SigV4签名/到期时间|
| 403 |正确的主旨、目标装置、功能或策略|
| 404 |读取目标缺失；第一次更新会建立一个影子|
| 409 |获取最新资讯，进行对账，然后只有在仍然合适的情况下才会重试|
| 413 |减少状态或请求大小；考虑合并状态大小|
| 415 |正确的内容型别或不受支援的编码|
| 429 |降低并发性/速度并缩小距离|
| 500 / 503 |将其视为临时服务故障；在重试不确定突变之前阅读|

MQTT应用程式错误出现在被拒绝的主题上，带有`code`；代理服务故障是一个独立的层。HTTP错误包括状态、JSON和相容性标头。 看到[介面序列](shadow-interfaces.zh-CN.md)与[故障序列](troubleshooting.zh-CN.md).

## 交付和并发

每个影子都有越来越多的变异版本。标准通知协议至少一次，按每个影子的版本顺序排列；允许重复。这不是一个精确一次的交付承诺或保证离线订阅者会收到每个事件。不同的影子具有独立的排序。HTTP变异成功不会等待通知交付。对于相同版本的事件，请独立跟踪事件型别并请求相关性。

继续：[完整的API和讯息示例](api-examples.zh-CN.md).
