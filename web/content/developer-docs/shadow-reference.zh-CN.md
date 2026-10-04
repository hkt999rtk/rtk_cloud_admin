---
title: 设备影子 API 与消息参考
description: 查询影子 API 路径、主题后缀、文档字段、限制与错误码。
category: Reference
keywords:
- 版本冲突
- 大小限制
- 速率限制
- 影子名称
- 请求关联
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
verification: 已完成来源审查与本地测试；尚待实际环境验证
---

# 设备影子 API 与消息参考

## 识别值与 API 路径

| 项目 | 规格 |
| --- | --- |
| `devid` / `thingName` | 1–128 个字符，符合 `[A-Za-z0-9:_-]+` |
| 命名影子名称 | 1–64 个字符，符合 `[$A-Za-z0-9:_-]+` |
| 未命名影子的 MQTT 根路径 | `$vc/devices/{devid}/shadow` |
| 命名影子的 MQTT 根路径 | `$vc/devices/{devid}/shadow/name/{shadowName}` |
| 读取 | `GET /things/{thingName}/shadow?name={shadowName}` |
| 更新／创建 | `POST /things/{thingName}/shadow?name={shadowName}` |
| 删除 | `DELETE /things/{thingName}/shadow?name={shadowName}` |
| 列出命名影子 | `GET /api/things/shadow/ListNamedShadowsForThing/{thingName}` |

省略 `name` 即选择未命名影子。名称与 ID 都必须做 URL 编码。列表 API 接受 1 到 100 的 `pageSize`，以及不应解读内容的 `nextToken`。旧的 `/api/devices/{devid}/shadow` 与 `/api/devices/{devid}/shadows` 路径不属于公开支持的兼容路径。

## MQTT 主题后缀

将下列后缀接在所选的根路径后。客户端发布请求，并订阅由服务传送的响应与通知。

| 请求后缀 | 响应后缀 | 其他通知 |
| --- | --- | --- |
| `/get` | `/get/accepted`, `/get/rejected` | — |
| `/update` | `/update/accepted`, `/update/rejected` | `/update/delta`, `/update/documents` |
| `/delete` | `/delete/accepted`, `/delete/rejected` | — |

传送请求前，先订阅完整且明确的主题。DELETE 会忽略 MQTT payload。本规格没有定义 MQTT 列表操作；要列出命名影子，请使用 HTTP。

## 更新请求

```json
{
  "state": {"desired": {"power": "on"}},
  "version": 7,
  "clientToken": "tutorial-app-on"
}
```

更新内容放在 `state` 中。若要变更状态，请提供 `desired`、`reported` 或两者；空的 state 对象也会被接受。`version` 与 `clientToken` 都是可选。示例中的版本 7 仅供示意，请改用 GET 取得的当前版本；若省略版本，就会无条件应用部分更新。客户端不能写入 delta、元数据或时间戳。

| 字段或规则 | 说明 |
| --- | --- |
| 对象的部分更新 | 递归合并；未提供的属性保留原值 |
| 属性值为 `null` | 删除该属性 |
| `desired:null` / `reported:null` | 删除整个区段 |
| 数组 | 以原子方式整体替换；不得包含 null 元素 |
| `version` | 更新前比对版本；不符时返回 409 |
| `clientToken` | 对应请求与响应的字符串，最多 64 个 UTF-8 字节；不提供请求去重 |

## 响应文档

| 响应 | 内容 |
| --- | --- |
| GET accepted | 当前状态、元数据、版本与 Unix 时间戳；空区段会省略 |
| UPDATE accepted | 接受的 desired/reported 部分更新与相关元数据；不是完整文档 |
| UPDATE delta | 最上层 `state` 包含当前完整的状态差异，另有 desired 元数据、版本及时间戳 |
| UPDATE documents | `previous` 与 `current` 快照，各含 state/metadata/version；外层另有时间戳 |
| DELETE accepted | `{}` |
| Rejected | `code`、`message`、Unix `timestamp`，以及适用时带回的有效请求 `clientToken` |

例如，delta 事件使用 `state.power`，完整 GET 响应则使用 `state.delta.power`。元数据的结构对应各属性，不会多包一层 `children`。公开的状态文档没有 `updated_at`。是否带回 `clientToken` 取决于响应类型，不要假设每则消息都会附带它。

rejected 响应示例：

```json
{"code":409,"message":"Version conflict","timestamp":1788480000,"clientToken":"tutorial-app-on"}
```

## 限制与错误

| 限制 | 数值或规则 |
| --- | --- |
| desired/reported 状态大小 | 8 KiB，不计入服务产生的元数据；合并后的存储状态会再次验证 |
| 状态嵌套层数 | 最多八层 |
| 编码 | 有效的 UTF-8 JSON |
| `clientToken` | 最多 64 个 UTF-8 字节 |
| 命名影子列表的每页条数 | 1–100 |
| 删除后的版本延续 | 删除记录保留 48 小时 |
| 请求速率与同时处理容量 | 由部署环境决定；不可将未记载的数字当作所有环境通用的限制 |

| 错误码 | 开发者处理方式 |
| --- | --- |
| 400 | 修正 JSON、名称、状态结构，或无效的数组／null 用法 |
| 401 | 重新验证身份，或修正 SigV4 签名与有效期限 |
| 403 | 检查身份、目标设备、启用功能及授权规则 |
| 404 | 读取的目标不存在；第一次 UPDATE 会创建影子 |
| 409 | GET 最新状态，重新计算更新内容；确认仍有必要后才重试 |
| 413 | 缩小状态或请求内容，并检查合并后的状态大小 |
| 415 | 修正内容类型或不支持的编码 |
| 429 | 降低并发数或请求速率，并延迟重试 |
| 500 / 503 | 视为暂时性服务故障；若不确定更新是否完成，重试前先读取状态 |

MQTT 应用层错误会在 rejected 主题中带有 `code`；MQTT Broker 的错误属于另一层。HTTP 错误包含状态码、JSON 与兼容性HTTP 头。详见[接口时序](shadow-interfaces.zh-CN.md)与[失败处理时序](troubleshooting.zh-CN.md)。

## 消息传递与并发更新

每个影子的更新版本会持续递增。标准通知规范采用至少一次投递，同一影子依版本排序，允许重复消息；这不代表恰好一次传递，也不保证离线订阅者能收到每个事件。不同影子的顺序互不相关。HTTP 更新成功不会等待通知送达。同版本事件的类型与请求对应关系应分别跟踪。

延伸阅读：[完整 API 与消息示例](api-examples.zh-CN.md)。
