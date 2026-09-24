---
title: API 与讯息范例
description: 检查完整的说明符号和影子讯息，包括栏位省略和相关规则。
category: Reference
keywords:
- JSON
- 公认的
- 三角洲
- 档案
- 单位
- accepted
- delta
- documents
- units
language: zh-CN
applies_to: RTK contracts 9b1ed887912e; Account Manager 54b37b9c407d; Video Cloud
  30fbb9a26155; Admin bbaf62f7d6b5
last_verified: '2026-09-04'
verification: 来源审查和本地检查；现场环境资格待定
---


# API 与讯息范例

## 目的和先决条件

完成后，使用这些固定装置构建解析器[令牌设定](authentication.zh-CN.md)与[Shadow介面教学](shadow-interfaces.zh-CN.md).以下的所有识别符号、令牌字串和时间戳仅供说明，不是捕获的凭据。使用装置`device-1`，名叫Shadow`tutorial`，和力量`off` → `on`。 这[参考](shadow-reference.zh-CN.md)拥有路线、验证和尺寸限制。

[开启重新设计的序列图](assets/message-shapes.zh-CN.html)

## 令牌的成功和失败

一个说明性的HTTP 200响应`POST /request_token`与`scope:app`, `devid:device-1`与`aws_iot_data:true`:

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

请勿将这些占位符复制到客户端中。`mqtt`是条件元资料；在尝试MQTT之前需要它。`aws_credentials`在审查的实现中按要求返回；其令牌模式尚未完全反映在标准OpenAPI中。`tenantId`可以省略。`refresh_token`可以缺席，不是单独的OAuth授予。没有公共的`expires_in`或序列化`expiry`检查令牌响应中的栏位。从以下时间开始安排JWT续订`exp`（Unix秒）；SigV4`expiration`是一个RFC 3339 UTC字串。

一个说明性的HTTP 401令牌发行失败示例：

```json
{
  "status": "fail",
  "reason": "token issuance not allowed"
}
```

令牌失败使用`status`/`reason`，而不是Shadow错误模式。TLS失败不会产生HTTP JSON。首先分类状态和操作；不要在散文中分支`reason`。客户经理登入响应是一个不同的模式，包含`user`, `tokens`与`app_certificate`；见[凭证设定](credential-setup.zh-CN.md).

## 阅读当前档案

发布`{"clientToken":"read-7"}`到`$vc/devices/device-1/shadow/name/tutorial/get`，或执行带有签名的HTTP GET。在请求更改电源之前，MQTT接受的响应：

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

GET返回完整的当前状态。省略空差分。HTTP GET没有MQTT请求令牌可以回声。状态/属性元资料时间戳和信封时间戳是Unix秒，而不是毫秒。`version`是每个Shadow生命周期中伺服器拥有的整数，而不是跨装置共享的时钟或版本。

## 更新并观察三个不同的讯息

将此补丁程式释出到相同的根目录中`/update`或使用已签名的HTTP POST：

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

一个`/update/accepted`讯息（或成功的HTTP更新正文）包含已接受的补丁程式，而不是完整的状态：

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

这个`/update/delta`讯息在内部直接放置差异`state`:

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

`/update/documents`包含快照和信封时间戳。快照物件不包含差分、时间戳或clientToken：

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

经过检查的序列化器可能在delta/档案上包含一个非空的突变令牌；不需要在未经请求的通知上包含一个令牌。使用接受/拒绝对请求完成进行关联，并独立处理通知状态。事件可能会重复，并在不同时间到达不同的客户端。 这`previous`当不存在以前的状态时，物件没有状态/元资料；不要要求非空部分。

## 报告实际状态，移除栏位并处理错误

开启电源后，装置提交：

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

一旦接受，新的GET将显示所需和报告的功率`on`并省略空三角。装置执行仅由韧体的实际操作/读取来建立；PUBACK或所需的接受都无法证明这一点。

移除补丁明确使用空值；省略会使现有属性保持不变：

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

相应的已接受补丁程式保留了`power:null`；删除值的属性元资料被省略。阵列原子替换，空阵列元素无效。接受删除是`{}`; MQTT DELETE忽略其有效负载，因此不要等待回声的clientToken。

过时的MQTT拒绝版本：

```json
{
  "code": 409,
  "message": "Version conflict",
  "timestamp": 1788480002,
  "clientToken": "power-on-8"
}
```

HTTP使用其状态和影子错误正文；检查[错误操作](shadow-reference.zh-CN.md). 未正确或无效的相关性值无需回响。HTTP名称列表响应可以是：

```json
{
  "results": [
    "tutorial"
  ],
  "timestamp": 1788480002
}
```

`nextToken`是可选的和不透明的；永远不要从名称中推断它。在同时建立/删除时，使用真正的nextToken，直到缺失，不要假设在同时建立/删除下有一个稳定的快照。

## 现场存在和单位

|场地|存在/所有权|单元或省略规则|
| --- | --- | --- |
|更新`state` |请求容器|所需/报告的补丁程式；省略的属性保持不变|
|请求`version` |可选的比较和更新保护器|来自当前GET的伺服器整数；永远不是时间戳|
|请求`clientToken` |可选的呼叫者相关性|最多64个UTF-8位元组；不是重试重复资料删除金钥|
|回应`version` |伺服器拥有对状态响应的控制权|每个影子生命周期；已接受的删除无任何|
|回应`timestamp` |在定义时由伺服器拥有|Unix秒；不在内部档案快照中|
|属性元资料`timestamp` |伺服器拥有的财产更新时间|Unix秒；内嵌如状态，移除的属性元资料省略|
|得到`state.delta` |只有当存在差异时|Delta通知相反使用顶级级别`state` |
| `previous` / `current` |档案通知快照|仅限状态、元资料和版本；省略了空格部分|
|错误`code` / `message` |阴影拒绝|数字状态类似的程式和诊断散文；令牌错误使用不同的模式|
|列表`nextToken` |可选的继续|不透明；缺席表示没有下一页|

## 解析器接受清单

接受省略的空状态部分、可选相关性以及额外的栏位；拒绝您的应用程式依赖它们的无效形状。将Unix秒与RFC 3339到期时间分开。切勿将更新补丁程式解释为替换快照。测试缺少的影子、删除、清除空值、重复事件和版本冲突。下一个：[状态设计](state-model.zh-CN.md)与[整合除错](debugging.zh-CN.md).
