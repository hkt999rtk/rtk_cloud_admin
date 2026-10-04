---
title: API 与消息示例
description: 查看完整令牌与影子消息示例，了解字段省略及请求与响应的对应规则。

category: Reference
keywords:
- 消息示例
- 字段省略
- 请求关联
- 单位
- JSON
- accepted
- delta
- documents
- units
language: zh-CN
applies_to: RTK contracts 9b1ed887912e; Account Manager 54b37b9c407d; Video Cloud
  30fbb9a26155; Admin bbaf62f7d6b5
last_verified: '2026-09-04'
verification: 已完成来源审查与本地检查；尚待实际环境验证
---

# API 与消息示例

## 用途与前置条件

完成 [令牌配置](authentication.zh-CN.md)与[影子接口教学](shadow-interfaces.zh-CN.md)后，可用本页示例开发解析器。下列识别值、令牌字符串与时间戳全是示意数据，不是实际撷取的凭证。示例使用设备 `device-1`、命名影子 `tutorial`，以及电源 `off` → `on` 的变化。路径、验证规则与大小限制以[参考文档](shadow-reference.zh-CN.md)为准。

[开启时序图](assets/message-shapes.zh-CN.html)

## 令牌签发成功与失败

以 `scope:app`、`devid:device-1` 与 `aws_iot_data:true` 调用 `POST /request_token`，HTTP 200 响应示例如下：

```json
{
  "token_type": "Bearer",
  "access_token": "REPLACE_WITH_ISSUED_JWT",
  "scope": "app",
  "mqtt": {
    "username": "RETURNED_BRAND_ID",
    "client_id": "RETURNED_CLIENT_ID"
  },
  "aws_credentials": {
    "accessKeyId": "EXAMPLE_ONLY",
    "secretAccessKey": "EXAMPLE_ONLY",
    "sessionToken": "REPLACE_WITH_ISSUED_JWT",
    "expiration": "2026-09-04T09:00:00Z",
    "region": "RETURNED_REGION",
    "iotDataEndpoint": "https://api.example.test",
    "allowedThings": [
      "device-1"
    ],
    "allowedActions": [
      "iot:GetThingShadow",
      "iot:UpdateThingShadow",
      "iot:DeleteThingShadow",
      "iot:ListNamedShadowsForThing"
    ],
    "tenantId": "RETURNED_BRAND_ID"
  }
}
```

不要直接把这些示意值复制到客户端。`mqtt` 是有条件返回的连接数据，尝试 MQTT 前必须先确认它存在。在已审查的实现中，提出要求时会返回 `aws_credentials`，但其令牌结构尚未完整反映在标准 OpenAPI 中。`tenantId` 可以省略。`refresh_token` 可能不存在，也不代表独立的 OAuth 授权流程。已检查的令牌响应没有公开的 `expires_in` 或序列化 `expiry` 字段。JWT 更新时间应依 `exp`（Unix 秒数）安排；SigV4 的 `expiration` 则是 RFC 3339 格式的 UTC 字符串。

令牌签发失败的 HTTP 401 响应示例：

```json
{
  "status": "fail",
  "reason": "token issuance not allowed"
}
```

令牌失败使用 `status`／`reason`，不是影子的错误结构。TLS 失败不会产生 HTTP JSON。请先依状态码与操作分类，不要依 `reason` 的自然语言文字判断程序分支。Account Manager 登录响应使用另一种结构，包含 `user`、`tokens` 与 `app_certificate`，详见[证书配置](credential-setup.zh-CN.md)。

## 读取当前文档

将 `{"clientToken":"read-7"}` 发布到 `$vc/devices/device-1/shadow/name/tutorial/get`，或执行已签名的 HTTP GET。要求变更电源前，MQTT accepted 响应示例如下：

```json
{
  "state": {
    "desired": {
      "power": "off"
    },
    "reported": {
      "power": "off"
    }
  },
  "metadata": {
    "desired": {
      "power": {
        "timestamp": 1788480000
      }
    },
    "reported": {
      "power": {
        "timestamp": 1788480000
      }
    }
  },
  "version": 7,
  "timestamp": 1788480000,
  "clientToken": "read-7"
}
```

GET 返回当前完整状态，空的 delta 会省略。HTTP GET 没有可带回的 MQTT 请求令牌。状态／属性元数据与消息外层的时间戳，单位都是 Unix 秒数，不是毫秒。`version` 是服务器为各影子生命周期管理的整数，不是时钟，也不是跨设备共用的版本。

## 更新并观察三种不同消息

将下列部分更新发布到相同根路径的 `/update`，或使用已签名的 HTTP POST：

```json
{
  "state": {
    "desired": {
      "power": "on"
    }
  },
  "version": 7,
  "clientToken": "power-on-8"
}
```

`/update/accepted` 消息（或 HTTP 更新成功的响应正文）包含接受的部分更新，不是完整状态：

```json
{
  "state": {
    "desired": {
      "power": "on"
    }
  },
  "metadata": {
    "desired": {
      "power": {
        "timestamp": 1788480001
      }
    }
  },
  "version": 8,
  "timestamp": 1788480001,
  "clientToken": "power-on-8"
}
```

`/update/delta` 消息将差异直接放在 `state` 中：

```json
{
  "state": {
    "power": "on"
  },
  "metadata": {
    "power": {
      "timestamp": 1788480001
    }
  },
  "version": 8,
  "timestamp": 1788480001,
  "clientToken": "power-on-8"
}
```

`/update/documents` 包含快照及外层时间戳。快照对象本身不含 delta、timestamp 或 clientToken：

```json
{
  "previous": {
    "state": {
      "desired": {
        "power": "off"
      },
      "reported": {
        "power": "off"
      }
    },
    "metadata": {
      "desired": {
        "power": {
          "timestamp": 1788480000
        }
      },
      "reported": {
        "power": {
          "timestamp": 1788480000
        }
      }
    },
    "version": 7
  },
  "current": {
    "state": {
      "desired": {
        "power": "on"
      },
      "reported": {
        "power": "off"
      }
    },
    "metadata": {
      "desired": {
        "power": {
          "timestamp": 1788480001
        }
      },
      "reported": {
        "power": {
          "timestamp": 1788480000
        }
      }
    },
    "version": 8
  },
  "timestamp": 1788480001,
  "clientToken": "power-on-8"
}
```

已检查的序列化程序，可能在 delta/documents 附上非空的更新请求令牌；对主动推送的通知，不要要求一定有令牌。请以 accepted/rejected 对应请求是否完成，并独立处理通知中的状态。事件可能重复，也可能在不同时间抵达各客户端。先前状态不存在时，`previous` 不含 state/metadata；不要要求这些区段一定非空。

## 上报实际状态、移除字段与处理错误

完成电源操作后，设备提交：

```json
{
  "state": {
    "reported": {
      "power": "on"
    }
  },
  "clientToken": "device-on"
}
```

请求被接受后，新的 GET 会显示 desired 与 reported 电源皆为 `on`，并省略空的 delta。只有固件的实际操作与读回结果，才能确认设备已执行；PUBACK 与 desired accepted 都无法证明。

删除属性的部分更新必须明确使用 null；省略属性会保留原值：

```json
{
  "state": {
    "desired": {
      "power": null
    }
  },
  "clientToken": "remove-power"
}
```

对应的 accepted 部分更新会保留 `power:null`，但不包含已删除属性的元数据。数组以原子方式整体替换，null 数组元素无效。DELETE accepted 为 `{}`；MQTT DELETE 会忽略 payload，因此不要等待响应带回 clientToken。

版本过期的 MQTT 拒绝响应：

```json
{
  "code": 409,
  "message": "Version conflict",
  "timestamp": 1788480002,
  "clientToken": "power-on-8"
}
```

HTTP 使用状态码及影子错误正文，请参考[错误处理方式](shadow-reference.zh-CN.md)。格式错误或无效的请求对应值不一定会被带回。HTTP 命名影子列表响应示例如下：

```json
{
  "results": [
    "tutorial"
  ],
  "timestamp": 1788480002
}
```

`nextToken` 是可选且不应自行解读的游标，绝不能从影子名称推导。请持续使用实际返回的 nextToken，直到不再出现；若同时有创建或删除操作，不要假设分页结果来自固定不变的快照。

## 字段是否存在与单位

| 字段 | 出现条件／管理者 | 单位或省略规则 |
| --- | --- | --- |
| 更新 `state` | 请求内容容器 | desired/reported 部分更新；省略的属性保持原值 |
| 请求 `version` | 可选的更新前版本比对 | 使用当前 GET 返回的服务器整数版本，不是时间戳 |
| 请求 `clientToken` | 可选，由调用者对应请求与响应 | 最多 64 个 UTF-8 字节；不是重试去重密钥 |
| 响应 `version` | 状态响应中由服务器管理 | 各影子生命周期独立；DELETE accepted 不含此字段 |
| 响应 `timestamp` | 规格定义处由服务器产生 | Unix 秒数；documents 的内部快照不含此字段 |
| 属性元数据 `timestamp` | 服务器记录的属性更新时间 | Unix 秒数；嵌套结构对应状态，已删除属性的元数据会省略 |
| GET `state.delta` | 有差异时才出现 | delta 通知则使用最上层 `state` |
| `previous` / `current` | documents 通知中的快照 | 只含 state、metadata 与 version；空区段会省略 |
| 错误 `code` / `message` | 影子拒绝响应 | 类似状态码的数字及诊断文字；令牌错误使用另一种结构 |
| 列表 `nextToken` | 有下一页时才出现 | 不应解读其内容；没有此字段表示没有下一页 |

## 解析器验收列表

应能接受省略的空状态区段、可选的请求对应值及额外字段；对应用程序依赖的数据结构，则应拒绝无效格式。区分 Unix 秒数与 RFC 3339 格式的有效期限。不可把部分更新当成完整状态快照。请测试影子不存在、删除、null 移除、重复事件与版本冲突。下一步：[状态设计](state-model.zh-CN.md)及[集成调试](debugging.zh-CN.md)。
