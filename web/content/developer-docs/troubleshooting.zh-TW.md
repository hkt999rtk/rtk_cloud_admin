---
title: 疑難排解與相容性
description: 按協議層診斷故障，並瞭解RTK Shadow相容性邊界。
category: Operate and troubleshoot
keywords:
- '401'
- '403'
- '409'
- 暫停
- 伺服器
- 體4
- SUBACK
- '401'
- '403'
- '409'
- timeout
- AWS
- SigV4
language: zh-TW
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 來源審查和本地測試；現場環境資格待定
---


# 疑難排解與相容性

從第一個故障層開始：TLS、令牌發行、MQTT連線、訂閱、釋出、影子響應，然後是裝置操作。一個層次的成功並不證明下一層。

[開啟重新設計的序列圖](assets/authentication-failures.zh-TW.html)

## 症狀清單

|症狀|檢查並下一步操作|
| --- | --- |
|TLS握手失敗|端點主機名稱、CA捆綁包、時鐘、證書有效期、匹配的私鑰|
|令牌請求被拒絕|請求範圍、證書衍生裝置ID、活動裝置、應用程式授權、功能|
|MQTT連線被拒絕|返回的使用者名稱和基本客戶端ID、允許的角色字尾、當前訪問令牌，`mqtt`能力|
|一個連線反覆斷開|另一個過程可能使用相同的客戶端ID|
|訂閱被拒絕|使用確切授予的主題；廣泛的影子萬用字元和另一個裝置保留的主題不等同|
|一般主題有效，影子失敗|驗證`iot_shadow`獨立確認目標/主要許可權|
|釋出成功，沒有Shadow回覆|在請求之前驗證SUBACK，確切的響應主題、待處理的請求令牌和應用程式超時|
|Shadow GET返回404|啟動不會建立狀態；第一個有效的UPDATE會建立狀態|
|在所需更新後沒有差異|獲取當前狀態；請求的屬性可能已經與報告的狀態匹配|
|裝置從未改變狀態|已接受的Shadow補丁程式不會執行硬體；檢查韌體處理|
|HTTP簽名被拒絕|使用返回的端點/地區、服務`iotdevicegateway`，會話令牌，當前憑據和時鐘|
| 409 |獲取當前版本並進行對賬；不要重新傳送不變的過期版本|
|重複通知|至少一次交付允許重複；不丟失相同版本的事件型別的去重|
|429或緩慢的響應|限制併發執行，降低速度並退縮；請求部署限制|

如需支援，請記錄UTC時間、操作、協議、狀態/錯誤程式、clientToken、裝置/影子識別符號（如果允許）以及SDK/客戶端版本。請排除原始令牌、憑證捆綁包、私鑰和敏感應用程式有效載荷。

## 相容性邊界

RTK Shadow遵循AWS風格的檔案、合併、差分、版本和HTTP資料平面模型。RTK MQTT使用`$vc/devices/{devid}/shadow/...`. `$aws/things/...`不是別名。AWS Device SDK MQTT主題構建器需要適應`$vc`；AWS服務SDK使用帶有返回的SigV4憑據的自定義HTTP端點。

`thingName`是RTK嗎`devid`。命名和未命名的影子是獨立的。不要使用舊的`/api/devices/{devid}/shadow`路由，從主題字串中推斷憑據，或插入內部租戶字首。不要假設檔案模型本身會限制裝置僅報告和應用程式僅為所需；策略定義許可權。

## 資格狀態

本版本與頁面元資料中的源快照相關聯。本地協議測試和圖表檢查記錄在維護者驗證報告中。生產連線限制、經紀商策略和權利執行必須根據您的目標環境進行驗證；本版本不證實部署。API行為、憑據或許可權不得更改以使示例透過。

返回[概述](overview.zh-TW.md), [MQTT快速入門](mqtt-quickstart.zh-TW.md)，或者[影子快速入門](shadow-quickstart.zh-TW.md).

繼續：[分步整合除錯](debugging.zh-TW.md).
