---
title: 裝置影子 API 與訊息參考
description: 查詢影子 API 路徑、主題後綴、文件欄位、限制與錯誤碼。
category: Reference
keywords:
- 版本衝突
- 大小限制
- 速率限制
- 影子名稱
- 請求對應
- '409'
- '413'
- '429'
- clientToken
- version
- 8 KiB
- name
language: zh-TW
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 已完成來源審查與本機測試；尚待實際環境驗證
---

# 裝置影子 API 與訊息參考

## 識別值與 API 路徑

| 項目 | 規格 |
| --- | --- |
| `devid` / `thingName` | 1–128 個字元，符合 `[A-Za-z0-9:_-]+` |
| 具名影子名稱 | 1–64 個字元，符合 `[$A-Za-z0-9:_-]+` |
| 未命名影子的 MQTT 根路徑 | `$vc/devices/{devid}/shadow` |
| 具名影子的 MQTT 根路徑 | `$vc/devices/{devid}/shadow/name/{shadowName}` |
| 讀取 | `GET /things/{thingName}/shadow?name={shadowName}` |
| 更新／建立 | `POST /things/{thingName}/shadow?name={shadowName}` |
| 刪除 | `DELETE /things/{thingName}/shadow?name={shadowName}` |
| 列出具名影子 | `GET /api/things/shadow/ListNamedShadowsForThing/{thingName}` |

省略 `name` 即選擇未命名影子。名稱與 ID 都必須做 URL 編碼。清單 API 接受 1 到 100 的 `pageSize`，以及不應解讀內容的 `nextToken`。舊的 `/api/devices/{devid}/shadow` 與 `/api/devices/{devid}/shadows` 路徑不屬於公開支援的相容路徑。

## MQTT 主題後綴

將下列後綴接在所選的根路徑後。用戶端發布請求，並訂閱由服務傳送的回應與通知。

| 請求後綴 | 回應後綴 | 其他通知 |
| --- | --- | --- |
| `/get` | `/get/accepted`, `/get/rejected` | — |
| `/update` | `/update/accepted`, `/update/rejected` | `/update/delta`, `/update/documents` |
| `/delete` | `/delete/accepted`, `/delete/rejected` | — |

傳送請求前，先訂閱完整且明確的主題。DELETE 會忽略 MQTT payload。本規格沒有定義 MQTT 清單操作；要列出具名影子，請使用 HTTP。

## 更新請求

```json
{
  "state": {"desired": {"power": "on"}},
  "version": 7,
  "clientToken": "tutorial-app-on"
}
```

更新內容放在 `state` 中。若要變更狀態，請提供 `desired`、`reported` 或兩者；空的 state 物件也會被接受。`version` 與 `clientToken` 都是選填。範例中的版本 7 僅供示意，請改用 GET 取得的目前版本；若省略版本，就會無條件套用部分更新。用戶端不能寫入 delta、中繼資料或時間戳記。

| 欄位或規則 | 說明 |
| --- | --- |
| 物件的部分更新 | 遞迴合併；未提供的屬性保留原值 |
| 屬性值為 `null` | 刪除該屬性 |
| `desired:null` / `reported:null` | 刪除整個區段 |
| 陣列 | 以原子方式整組取代；不得包含 null 元素 |
| `version` | 更新前比對版本；不符時回傳 409 |
| `clientToken` | 對應請求與回應的字串，最多 64 個 UTF-8 位元組；不提供請求去重 |

## 回應文件

| 回應 | 內容 |
| --- | --- |
| GET accepted | 目前狀態、中繼資料、版本與 Unix 時間戳記；空區段會省略 |
| UPDATE accepted | 接受的 desired/reported 部分更新與相關中繼資料；不是完整文件 |
| UPDATE delta | 最上層 `state` 包含目前完整的狀態差異，另有 desired 中繼資料、版本及時間戳記 |
| UPDATE documents | `previous` 與 `current` 快照，各含 state/metadata/version；外層另有時間戳記 |
| DELETE accepted | `{}` |
| Rejected | `code`、`message`、Unix `timestamp`，以及適用時帶回的有效請求 `clientToken` |

例如，delta 事件使用 `state.power`，完整 GET 回應則使用 `state.delta.power`。中繼資料的結構對應各屬性，不會多包一層 `children`。公開的狀態文件沒有 `updated_at`。是否帶回 `clientToken` 取決於回應類型，不要假設每則訊息都會附帶它。

rejected 回應範例：

```json
{"code":409,"message":"Version conflict","timestamp":1788480000,"clientToken":"tutorial-app-on"}
```

## 限制與錯誤

| 限制 | 數值或規則 |
| --- | --- |
| desired/reported 狀態大小 | 8 KiB，不計入服務產生的中繼資料；合併後的儲存狀態會再次驗證 |
| 狀態巢狀層數 | 最多八層 |
| 編碼 | 有效的 UTF-8 JSON |
| `clientToken` | 最多 64 個 UTF-8 位元組 |
| 具名影子清單的每頁筆數 | 1–100 |
| 刪除後的版本延續 | 刪除記錄保留 48 小時 |
| 請求速率與同時處理容量 | 由部署環境決定；不可將未記載的數字當作所有環境通用的限制 |

| 錯誤碼 | 開發者處理方式 |
| --- | --- |
| 400 | 修正 JSON、名稱、狀態結構，或無效的陣列／null 用法 |
| 401 | 重新驗證身分，或修正 SigV4 簽署與有效期限 |
| 403 | 檢查身分、目標裝置、啟用功能及授權規則 |
| 404 | 讀取的目標不存在；第一次 UPDATE 會建立影子 |
| 409 | GET 最新狀態，重新計算更新內容；確認仍有必要後才重試 |
| 413 | 縮小狀態或請求內容，並檢查合併後的狀態大小 |
| 415 | 修正內容類型或不支援的編碼 |
| 429 | 降低並行數或請求速率，並延遲重試 |
| 500 / 503 | 視為暫時性服務故障；若不確定更新是否完成，重試前先讀取狀態 |

MQTT 應用層錯誤會在 rejected 主題中帶有 `code`；MQTT Broker 的錯誤屬於另一層。HTTP 錯誤包含狀態碼、JSON 與相容性標頭。詳見[介面時序](shadow-interfaces.zh-TW.md)與[失敗處理時序](troubleshooting.zh-TW.md)。

## 訊息傳遞與並行更新

每個影子的異動版本會持續遞增。標準通知規格採至少一次傳遞，同一影子依版本排序，允許重複訊息；這不代表恰好一次傳遞，也不保證離線訂閱者能收到每個事件。不同影子的順序互不相關。HTTP 更新成功不會等待通知送達。同版本事件的類型與請求對應關係應分別追蹤。

延伸閱讀：[完整 API 與訊息範例](api-examples.zh-TW.md)。
