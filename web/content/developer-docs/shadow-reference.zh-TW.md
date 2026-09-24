---
title: 裝置影子 API 與訊息參考
description: 查詢影子路徑、主題字尾、檔案欄位、限制和錯誤。
category: Reference
keywords:
- '409'
- '413'
- '429'
- 客戶端令牌
- 版本
- 8千位元組
- 名稱
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
verification: 來源審查和本地測試；現場環境資格待定
---


# 裝置影子 API 與訊息參考

## 身份和路線

|專案|契約|
| --- | --- |
| `devid` / `thingName` |1-128個字元，`[A-Za-z0-9:_-]+` |
|命名的影子|1-64個字元，`[$A-Za-z0-9:_-]+` |
|無名MQTT根| `$vc/devices/{devid}/shadow` |
|命名為MQTT根| `$vc/devices/{devid}/shadow/name/{shadowName}` |
|閱讀| `GET /things/{thingName}/shadow?name={shadowName}` |
|更新/建立| `POST /things/{thingName}/shadow?name={shadowName}` |
|刪除| `DELETE /things/{thingName}/shadow?name={shadowName}` |
|名稱列表| `GET /api/things/shadow/ListNamedShadowsForThing/{thingName}` |

省略`name`選擇無名影子。URL編碼名稱和ID。列表接受`pageSize`從1到100，以及不透明的`nextToken`。老的`/api/devices/{devid}/shadow`與`/api/devices/{devid}/shadows`路由不是公共相容路由。

## MQTT字尾

將這些字尾新增到所選根字元中。客戶端釋出請求並訂閱響應/通知；服務端傳送後者。

|請求字尾|響應字尾|其他通知|
| --- | --- | --- |
| `/get` | `/get/accepted`, `/get/rejected` | — |
| `/update` | `/update/accepted`, `/update/rejected` | `/update/delta`, `/update/documents` |
| `/delete` | `/delete/accepted`, `/delete/rejected` | — |

在請求之前訂閱確切的主題。刪除忽略MQTT有效負載。本契約中沒有MQTT列表操作；請使用HTTP進行名稱陰影列表。

## 更新請求

```json
{
  "state": {"desired": {"power": "on"}},
  "version": 7,
  "clientToken": "tutorial-app-on"
}
```

`state`是更新容器。 供應`desired`, `reported`，或兩者都用於狀態更改；空狀態物件也被接受。`version`與`clientToken`是可選的。在本例中，版本7是示例：用當前的GET版本替換或省略它以獲得無條件補丁。客戶端不會寫入差分、元資料或時間戳。

|欄位或規則|含義|
| --- | --- |
|物件補丁|遞迴合併；省略的屬性仍然存在|
|財產`null` |移除該屬性|
| `desired:null` / `reported:null` |移除該部分|
|陣列|原子替換；空元素無效|
| `version` |比較和更新保護器；不匹配返回409|
| `clientToken` |相關性字串，最多64個UTF-8位元組；不重複|

## 回覆檔案

|回應|內容|
| --- | --- |
|被接受|當前狀態、元資料、版本、週期時間戳；省略了空部分|
|更新已接受|接受所需/報告的補丁程式和相關元資料；而不是整個檔案|
|更新三角形|完成頂級層面的當前差異`state`，所需元資料、版本、時間戳|
|更新檔案| `previous`與`current`快照，每個快照都包含狀態/元資料/版本；信封時間戳|
|已接受刪除| `{}` |
|被拒絕| `code`, `message`，時代`timestamp`，以及一個有效的請求`clientToken`在適用的情況下|

例如，三角事件使用`state.power`，而完整的GET使用`state.delta.power`.元資料映象屬性結構，無需`children`封面。公共國家檔案沒有`updated_at`。 治療`clientToken`作為特定於響應的響應，而不是假設每條訊息都會回應它。

示例被拒絕的回覆：

```json
{"code":409,"message":"Version conflict","timestamp":1788480000,"clientToken":"tutorial-app-on"}
```

## 限制和錯誤

|限制|價值|
| --- | --- |
|所需/報告的狀態大小|8 KiB，不包括生成的元資料；合併儲存狀態重新驗證|
|狀態巢狀|最多八個級別|
|編碼|有效的UTF-8 JSON|
| `clientToken` |最多64個UTF-8位元組|
|命名列表頁面大小| 1–100 |
|刪除版本連續性|48小時墓碑視窗|
|請求機票價格和機上容量|部署定義；不要硬編碼未記錄的通用數字|

|程式|開發者行動|
| --- | --- |
| 400 |正確的JSON、名稱、狀態形狀或無效的陣列/空值使用|
| 401 |重新驗證或更正SigV4簽名/到期時間|
| 403 |正確的主旨、目標裝置、功能或策略|
| 404 |讀取目標缺失；第一次更新會建立一個影子|
| 409 |獲取最新資訊，進行對賬，然後只有在仍然合適的情況下才會重試|
| 413 |減少狀態或請求大小；考慮合併狀態大小|
| 415 |正確的內容型別或不受支援的編碼|
| 429 |降低併發性/速度並縮小距離|
| 500 / 503 |將其視為臨時服務故障；在重試不確定突變之前閱讀|

MQTT應用程式錯誤出現在被拒絕的主題上，帶有`code`；代理服務故障是一個獨立的層。HTTP錯誤包括狀態、JSON和相容性標頭。 看到[介面序列](shadow-interfaces.zh-TW.md)與[故障序列](troubleshooting.zh-TW.md).

## 交付和併發

每個影子都有越來越多的變異版本。標準通知協議至少一次，按每個影子的版本順序排列；允許重複。這不是一個精確一次的交付承諾或保證離線訂閱者會收到每個事件。不同的影子具有獨立的排序。HTTP變異成功不會等待通知交付。對於相同版本的事件，請獨立跟蹤事件型別並請求相關性。

繼續：[完整的API和訊息示例](api-examples.zh-TW.md).
