---
title: API 與訊息範例
description: 檢查完整的說明符號和影子訊息，包括欄位省略和相關規則。
category: Reference
keywords:
- JSON
- 公認的
- 三角洲
- 檔案
- 單位
- accepted
- delta
- documents
- units
language: zh-TW
applies_to: RTK contracts 9b1ed887912e; Account Manager 54b37b9c407d; Video Cloud
  30fbb9a26155; Admin bbaf62f7d6b5
last_verified: '2026-09-04'
verification: 來源審查和本地檢查；現場環境資格待定
---


# API 與訊息範例

## 目的和先決條件

完成後，使用這些固定裝置構建解析器[令牌設定](authentication.zh-TW.md)與[Shadow介面教學](shadow-interfaces.zh-TW.md).以下的所有識別符號、令牌字串和時間戳僅供說明，不是捕獲的憑據。使用裝置`device-1`，名叫Shadow`tutorial`，和力量`off` → `on`。 這[參考](shadow-reference.zh-TW.md)擁有路線、驗證和尺寸限制。

[開啟重新設計的序列圖](assets/message-shapes.zh-TW.html)

## 令牌的成功和失敗

一個說明性的HTTP 200響應`POST /request_token`與`scope:app`, `devid:device-1`與`aws_iot_data:true`:

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

請勿將這些佔位符複製到客戶端中。`mqtt`是條件元資料；在嘗試MQTT之前需要它。`aws_credentials`在審查的實現中按要求返回；其令牌模式尚未完全反映在標準OpenAPI中。`tenantId`可以省略。`refresh_token`可以缺席，不是單獨的OAuth授予。沒有公共的`expires_in`或序列化`expiry`檢查令牌響應中的欄位。從以下時間開始安排JWT續訂`exp`（Unix秒）；SigV4`expiration`是一個RFC 3339 UTC字串。

一個說明性的HTTP 401令牌發行失敗示例：

```json
{
  "status": "fail",
  "reason": "token issuance not allowed"
}
```

令牌失敗使用`status`/`reason`，而不是Shadow錯誤模式。TLS失敗不會產生HTTP JSON。首先分類狀態和操作；不要在散文中分支`reason`。客戶經理登入響應是一個不同的模式，包含`user`, `tokens`與`app_certificate`；見[憑證設定](credential-setup.zh-TW.md).

## 閱讀當前檔案

發布`{"clientToken":"read-7"}`到`$vc/devices/device-1/shadow/name/tutorial/get`，或執行帶有簽名的HTTP GET。在請求更改電源之前，MQTT接受的響應：

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

GET返回完整的當前狀態。省略空差分。HTTP GET沒有MQTT請求令牌可以回聲。狀態/屬性元資料時間戳和信封時間戳是Unix秒，而不是毫秒。`version`是每個Shadow生命週期中伺服器擁有的整數，而不是跨裝置共享的時鐘或版本。

## 更新並觀察三個不同的訊息

將此補丁程式釋出到相同的根目錄中`/update`或使用已簽名的HTTP POST：

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

一個`/update/accepted`訊息（或成功的HTTP更新正文）包含已接受的補丁程式，而不是完整的狀態：

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

這個`/update/delta`訊息在內部直接放置差異`state`:

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

`/update/documents`包含快照和信封時間戳。快照物件不包含差分、時間戳或clientToken：

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

經過檢查的序列化器可能在delta/檔案上包含一個非空的突變令牌；不需要在未經請求的通知上包含一個令牌。使用接受/拒絕對請求完成進行關聯，並獨立處理通知狀態。事件可能會重複，並在不同時間到達不同的客戶端。 這`previous`當不存在以前的狀態時，物件沒有狀態/元資料；不要要求非空部分。

## 報告實際狀態，移除欄位並處理錯誤

開啟電源後，裝置提交：

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

一旦接受，新的GET將顯示所需和報告的功率`on`並省略空三角。裝置執行僅由韌體的實際操作/讀取來建立；PUBACK或所需的接受都無法證明這一點。

移除補丁明確使用空值；省略會使現有屬性保持不變：

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

相應的已接受補丁程式保留了`power:null`；刪除值的屬性元資料被省略。陣列原子替換，空陣列元素無效。接受刪除是`{}`; MQTT DELETE忽略其有效負載，因此不要等待回聲的clientToken。

過時的MQTT拒絕版本：

```json
{
  "code": 409,
  "message": "Version conflict",
  "timestamp": 1788480002,
  "clientToken": "power-on-8"
}
```

HTTP使用其狀態和影子錯誤正文；檢查[錯誤操作](shadow-reference.zh-TW.md). 未正確或無效的相關性值無需回響。HTTP名稱列表響應可以是：

```json
{
  "results": [
    "tutorial"
  ],
  "timestamp": 1788480002
}
```

`nextToken`是可選的和不透明的；永遠不要從名稱中推斷它。在同時建立/刪除時，使用真正的nextToken，直到缺失，不要假設在同時建立/刪除下有一個穩定的快照。

## 現場存在和單位

|場地|存在/所有權|單元或省略規則|
| --- | --- | --- |
|更新`state` |請求容器|所需/報告的補丁程式；省略的屬性保持不變|
|請求`version` |可選的比較和更新保護器|來自當前GET的伺服器整數；永遠不是時間戳|
|請求`clientToken` |可選的呼叫者相關性|最多64個UTF-8位元組；不是重試重複資料刪除金鑰|
|回應`version` |伺服器擁有對狀態響應的控制權|每個影子生命週期；已接受的刪除無任何|
|回應`timestamp` |在定義時由伺服器擁有|Unix秒；不在內部檔案快照中|
|屬性元資料`timestamp` |伺服器擁有的財產更新時間|Unix秒；內嵌如狀態，移除的屬性元資料省略|
|得到`state.delta` |只有當存在差異時|Delta通知相反使用頂級級別`state` |
| `previous` / `current` |檔案通知快照|僅限狀態、元資料和版本；省略了空格部分|
|錯誤`code` / `message` |陰影拒絕|數字狀態類似的程式和診斷散文；令牌錯誤使用不同的模式|
|列表`nextToken` |可選的繼續|不透明；缺席表示沒有下一頁|

## 解析器接受清單

接受省略的空狀態部分、可選相關性以及額外的欄位；拒絕您的應用程式依賴它們的無效形狀。將Unix秒與RFC 3339到期時間分開。切勿將更新補丁程式解釋為替換快照。測試缺少的影子、刪除、清除空值、重複事件和版本衝突。下一個：[狀態設計](state-model.zh-TW.md)與[整合除錯](debugging.zh-TW.md).
