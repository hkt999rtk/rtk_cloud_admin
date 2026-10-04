---
title: 疑難排解與相容性
description: 依協定層定位問題，瞭解 RTK 裝置影子的相容範圍。

category: Operate and troubleshoot
keywords:
- 疑難排解
- 相容性
- 逾時
- 身分驗證
- 版本衝突
- '401'
- '403'
- '409'
- timeout
- AWS
- SigV4
- SUBACK
language: zh-TW
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 已完成來源審查與本機測試；尚待實際環境驗證
---

# 疑難排解與相容性

從第一個失敗的環節開始檢查：TLS、token 簽發、MQTT 連線、訂閱、發布、影子回應，再到裝置操作。某一層成功，不代表下一層也成功。

[開啟時序圖](assets/authentication-failures.zh-TW.html)

## 症狀檢查表

| 症狀 | 檢查項目與下一步 |
| --- | --- |
| TLS 交握失敗 | 檢查端點主機名稱、CA 憑證組、時鐘、憑證有效期限，以及私鑰是否匹配 |
| token 請求被拒絕 | 檢查請求 scope、憑證對應的裝置 ID、裝置是否啟用、應用程式授權及服務功能 |
| MQTT CONNECT 被拒絕 | 使用回傳的 username 與 Client ID 基底、允許的角色後綴、有效 access token，並確認已啟用 `mqtt` |
| 某個連線反覆斷開 | 可能有另一個程序使用相同 Client ID |
| SUBSCRIBE 被拒絕 | 使用明確獲授權的完整主題；廣泛的 Shadow 萬用字元或其他裝置的保留主題不具相同權限 |
| 一般主題可用，影子操作失敗 | 另外檢查 `iot_shadow`，並確認目標與呼叫者權限 |
| 發布成功，沒有影子回應 | 確認請求前已收到 SUBACK、完整回應主題正確，並檢查等待中的請求 token 及應用程式逾時 |
| 影子 GET 回傳 404 | 啟用裝置不會建立狀態；第一次有效 UPDATE 才會建立 |
| 更新 desired 後沒有 delta | GET 目前狀態；要求的屬性可能已與 reported 一致 |
| 裝置狀態始終未改變 | 影子接受部分更新不會直接操作硬體；請檢查韌體處理流程 |
| HTTP 簽章被拒絕 | 使用回傳的 endpoint／region、服務名稱 `iotdevicegateway`、session token、有效驗證資訊及正確時鐘 |
| 409 | GET 目前版本後重新計算更新內容；不要原樣重送過期版本 |
| 通知重複 | 至少一次傳遞允許重複；去重時不能漏掉同版本的不同事件類型 |
| 429 或回應緩慢 | 限制並行數、降低速率並延遲重試；向管理員確認部署限制 |

需要支援時，請記錄 UTC 時間、操作、協定、狀態／錯誤碼、clientToken、允許提供的裝置／影子識別值，以及 SDK／用戶端版本。不要附上原始 token、整組驗證資訊、私鑰或敏感的應用程式 payload。

## 相容範圍

RTK Shadow 採用 AWS 風格的文件、合併、delta、版本及 HTTP 資料介面模型。RTK MQTT 使用 `$vc/devices/{devid}/shadow/...`，`$aws/things/...` 不是別名。AWS Device SDK 的 MQTT 主題產生方式需要調整為 `$vc`；AWS 服務 SDK 則使用自訂 HTTP 端點與回傳的 SigV4 驗證資訊。

`thingName` 就是 RTK 的 `devid`。具名與未命名影子彼此獨立。不要使用舊的 `/api/devices/{devid}/shadow` 路徑、從主題字串推導驗證資訊，或自行插入內部租戶前綴。文件模型本身不會限制裝置只能寫 reported、應用程式只能寫 desired；權限由授權規則決定。

## 驗證狀態

本版對應各頁中繼資料列出的原始碼快照。本機協定測試與圖表檢查結果記錄在維護者驗證報告中。正式環境的連線限制、Broker 規則及服務授權限制，必須在目標環境驗證；本版不代表任何部署已通過認證。不要為了讓範例通過，就變更 API 行為、驗證資訊或權限。

返回[概覽](overview.zh-TW.md)、[MQTT 快速入門](mqtt-quickstart.zh-TW.md)或[裝置狀態同步快速入門](shadow-quickstart.zh-TW.md)。

延伸閱讀：[逐步整合除錯](debugging.zh-TW.md)。
