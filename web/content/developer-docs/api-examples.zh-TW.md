---
title: API 與訊息範例
description: 查看完整 token 與影子訊息範例，瞭解欄位省略及請求與回應的對應規則。

category: Reference
keywords:
- 訊息範例
- 欄位省略
- 請求對應
- 單位
- JSON
- accepted
- delta
- documents
- units
language: zh-TW
applies_to: RTK contracts 9b1ed887912e; Account Manager 54b37b9c407d; Video Cloud
  30fbb9a26155; Admin bbaf62f7d6b5
last_verified: '2026-09-04'
verification: 已完成來源審查與本機檢查；尚待實際環境驗證
---

# API 與訊息範例

## 用途與前置條件

完成 [token 設定](authentication.zh-TW.md)與[影子介面教學](shadow-interfaces.zh-TW.md)後，可用本頁範例開發解析器。下列識別值、token 字串與時間戳記全是示意資料，不是實際擷取的驗證資訊。範例使用裝置 `device-1`、具名影子 `tutorial`，以及電源 `off` → `on` 的變化。路徑、驗證規則與大小限制以[參考文件](shadow-reference.zh-TW.md)為準。

[開啟時序圖](assets/message-shapes.zh-TW.html)

## token 簽發成功與失敗

以 `scope:app`、`devid:device-1` 與 `aws_iot_data:true` 呼叫 `POST /request_token`，HTTP 200 回應範例如下：

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

不要直接把這些示意值複製到用戶端。`mqtt` 是有條件回傳的連線資料，嘗試 MQTT 前必須先確認它存在。在已審查的實作中，提出要求時會回傳 `aws_credentials`，但其 token 結構尚未完整反映在標準 OpenAPI 中。`tenantId` 可以省略。`refresh_token` 可能不存在，也不代表獨立的 OAuth 授權流程。已檢查的 token 回應沒有公開的 `expires_in` 或序列化 `expiry` 欄位。JWT 更新時間應依 `exp`（Unix 秒數）安排；SigV4 的 `expiration` 則是 RFC 3339 格式的 UTC 字串。

token 簽發失敗的 HTTP 401 回應範例：

```json
{
  "status": "fail",
  "reason": "token issuance not allowed"
}
```

token 失敗使用 `status`／`reason`，不是影子的錯誤結構。TLS 失敗不會產生 HTTP JSON。請先依狀態碼與操作分類，不要依 `reason` 的自然語言文字判斷程式分支。Account Manager 登入回應使用另一種結構，包含 `user`、`tokens` 與 `app_certificate`，詳見[憑證設定](credential-setup.zh-TW.md)。

## 讀取目前文件

將 `{"clientToken":"read-7"}` 發布到 `$vc/devices/device-1/shadow/name/tutorial/get`，或執行已簽署的 HTTP GET。要求變更電源前，MQTT accepted 回應範例如下：

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

GET 回傳目前完整狀態，空的 delta 會省略。HTTP GET 沒有可帶回的 MQTT 請求 token。狀態／屬性中繼資料與訊息外層的時間戳記，單位都是 Unix 秒數，不是毫秒。`version` 是伺服器為各影子生命週期管理的整數，不是時鐘，也不是跨裝置共用的版本。

## 更新並觀察三種不同訊息

將下列部分更新發布到相同根路徑的 `/update`，或使用已簽署的 HTTP POST：

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

`/update/accepted` 訊息（或 HTTP 更新成功的回應本文）包含接受的部分更新，不是完整狀態：

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

`/update/delta` 訊息將差異直接放在 `state` 中：

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

`/update/documents` 包含快照及外層時間戳記。快照物件本身不含 delta、timestamp 或 clientToken：

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

已檢查的序列化程式，可能在 delta/documents 附上非空的更新請求 token；對主動推送的通知，不要要求一定有 token。請以 accepted/rejected 對應請求是否完成，並獨立處理通知中的狀態。事件可能重複，也可能在不同時間抵達各用戶端。先前狀態不存在時，`previous` 不含 state/metadata；不要要求這些區段一定非空。

## 回報實際狀態、移除欄位與處理錯誤

完成電源操作後，裝置提交：

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

請求被接受後，新的 GET 會顯示 desired 與 reported 電源皆為 `on`，並省略空的 delta。只有韌體的實際操作與讀回結果，才能確認裝置已執行；PUBACK 與 desired accepted 都無法證明。

刪除屬性的部分更新必須明確使用 null；省略屬性會保留原值：

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

對應的 accepted 部分更新會保留 `power:null`，但不包含已刪除屬性的中繼資料。陣列以原子方式整組取代，null 陣列元素無效。DELETE accepted 為 `{}`；MQTT DELETE 會忽略 payload，因此不要等待回應帶回 clientToken。

版本過期的 MQTT 拒絕回應：

```json
{
  "code": 409,
  "message": "Version conflict",
  "timestamp": 1788480002,
  "clientToken": "power-on-8"
}
```

HTTP 使用狀態碼及影子錯誤本文，請參考[錯誤處理方式](shadow-reference.zh-TW.md)。格式錯誤或無效的請求對應值不一定會被帶回。HTTP 具名影子清單回應範例如下：

```json
{
  "results": [
    "tutorial"
  ],
  "timestamp": 1788480002
}
```

`nextToken` 是選填且不應自行解讀的游標，絕不能從影子名稱推導。請持續使用實際回傳的 nextToken，直到不再出現；若同時有建立或刪除操作，不要假設分頁結果來自固定不變的快照。

## 欄位是否存在與單位

| 欄位 | 出現條件／管理者 | 單位或省略規則 |
| --- | --- | --- |
| 更新 `state` | 請求內容容器 | desired/reported 部分更新；省略的屬性保持原值 |
| 請求 `version` | 選填的更新前版本比對 | 使用目前 GET 回傳的伺服器整數版本，不是時間戳記 |
| 請求 `clientToken` | 選填，由呼叫者對應請求與回應 | 最多 64 個 UTF-8 位元組；不是重試去重金鑰 |
| 回應 `version` | 狀態回應中由伺服器管理 | 各影子生命週期獨立；DELETE accepted 不含此欄位 |
| 回應 `timestamp` | 規格定義處由伺服器產生 | Unix 秒數；documents 的內部快照不含此欄位 |
| 屬性中繼資料 `timestamp` | 伺服器記錄的屬性更新時間 | Unix 秒數；巢狀結構對應狀態，已刪除屬性的中繼資料會省略 |
| GET `state.delta` | 有差異時才出現 | delta 通知則使用最上層 `state` |
| `previous` / `current` | documents 通知中的快照 | 只含 state、metadata 與 version；空區段會省略 |
| 錯誤 `code` / `message` | 影子拒絕回應 | 類似狀態碼的數字及診斷文字；token 錯誤使用另一種結構 |
| 清單 `nextToken` | 有下一頁時才出現 | 不應解讀其內容；沒有此欄位表示沒有下一頁 |

## 解析器驗收清單

應能接受省略的空狀態區段、選填的請求對應值及額外欄位；對應用程式依賴的資料結構，則應拒絕無效格式。區分 Unix 秒數與 RFC 3339 格式的有效期限。不可把部分更新當成完整取代快照。請測試影子不存在、刪除、null 移除、重複事件與版本衝突。下一步：[狀態設計](state-model.zh-TW.md)及[整合除錯](debugging.zh-TW.md)。
