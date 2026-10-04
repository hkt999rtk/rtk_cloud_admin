---
title: 文件導覽
description: 依韌體、應用程式或後端開發角色選擇閱讀路線，瀏覽完整文件。

category: Start here
keywords:
- 開始
- 閱讀路線
- 韌體
- 應用程式
- 後端
- 目錄
- start
- learning path
- firmware
- App
- Backend
- contents
language: zh-TW
applies_to: Developer Docs Core + P0 + P1 source edition
last_verified: '2026-09-04'
verification: 已檢查導覽與本機搜尋；服務驗證狀態以各頁說明為準。
---

# 文件導覽

## 選擇閱讀路線

| 開發角色 | 建議順序 |
| --- | --- |
| 裝置韌體 | 事前準備 → 雲端與裝置設定 → 憑證設定 → MQTT 快速入門 → 影子快速入門 → 應用程式與裝置範例 → 狀態模型 → 驗證資訊恢復 |
| 應用程式 | 事前準備 → 憑證設定 → 身分驗證 → 應用程式與裝置範例 → API 範例 → 狀態模型 → 除錯 |
| 後端 | 事前準備 → 雲端與裝置設定 → 後端指南 → HTTP 介面 → API 範例 → 衝突處理 → 連線限制 |

先從[事前準備](before-you-start.zh-TW.md)開始。兩篇快速入門分別介紹單一協定的互動，再由[應用程式與裝置範例](app-device-example.zh-TW.md)串起完整流程。只有尚未備妥獲授權的測試身分或裝置時，才需要進行註冊。

## 依任務瀏覽

### 從這裡開始

- [雲端服務概覽](overview.zh-TW.md)：瞭解 MQTT 訊息傳遞、影子狀態，以及裝置與應用程式的分工。
- [事前準備](before-you-start.zh-TW.md)：備妥測試裝置、獲授權的身分、端點與命令列工具。
- [設定第一個雲端與裝置](setup-cloud-device.zh-TW.md)：建立 Product、完成裝置認領，並在申請執行階段驗證資訊前確認裝置已啟用。
- [裝置與應用程式憑證設定](credential-setup.zh-TW.md)：在本機產生應用程式金鑰與 CSR、取得憑證，並區分裝置出廠身分與執行階段 token。

### 教學

- [連線與訊息交換快速入門](mqtt-quickstart.zh-TW.md)：發布 JSON 訊息，並由另一個已驗證的 MQTT 連線接收。
- [裝置狀態同步快速入門](shadow-quickstart.zh-TW.md)：從應用程式要求開啟電源，確認裝置回報操作後的狀態。
- [應用程式與裝置端對端範例](app-device-example.zh-TW.md)：分別執行兩個用戶端，確認 desired 與 reported 最後一致。

### 概念

- [裝置影子概念](shadow-concepts.zh-TW.md)：瞭解 desired、reported、delta、影子名稱、合併規則及版本。
- [設計裝置狀態模型](state-model.zh-TW.md)：設計相容的 desired/reported 結構、具名影子、錯誤回報及並行寫入。
- [裝置連線狀態與生命週期](device-presence.zh-TW.md)：區分帳戶就緒狀態、MQTT 連線、owner 傳輸連線與應用程式健康狀態。


### 整合開發

- [身分驗證與存取控制](authentication.zh-TW.md)：取得執行階段 token，並將回傳資料用於 MQTT 與影子 HTTP 驗證。
- [MQTT 連線指南](mqtt-connection.zh-TW.md)：設定用戶端身分與恢復流程，不依賴離線訊息的持久傳遞。
- [後端整合指南](backend-integration.zh-TW.md)：選擇獲授權的後端身分，不借用裝置驗證資訊，完成已簽署的影子操作。
- [透過 MQTT 與 HTTP 操作裝置影子](shadow-interfaces.zh-TW.md)：使用完整 MQTT 主題或已簽署 HTTP 請求進行操作。
- [整合實作範例](integration-recipes.zh-TW.md)：處理離線恢復與版本衝突，並如實回報裝置狀態。
- [裝置所有權與分享](ownership-sharing.zh-TW.md)：瞭解帳戶綁定、授權分享與轉售，並區分這些操作與裝置身分。


### 維運與疑難排解

- [驗證資訊更新與連線恢復](credential-recovery.zh-TW.md)：在驗證資訊過期或網路中斷後，更新執行階段驗證資訊並恢復訂閱與狀態。
- [整合除錯指南](debugging.zh-TW.md)：定位第一個失敗的協定層，整理不含敏感資訊的支援報告。
- [疑難排解與相容性](troubleshooting.zh-TW.md)：依協定層診斷失敗原因，瞭解 RTK Shadow 的相容範圍。
- [整合測試套件](integration-test-kit.zh-TW.md)：執行 MQTT Shadow 唯讀檢查與明確啟用的模擬控制，再驗證生命週期及失敗情況。


### 參考文件

- [MQTT 主題與訊息參考](mqtt-topics.zh-TW.md)：區分應用程式自訂訊息、裝置傳輸封裝與影子保留主題。
- [裝置影子 API 與訊息參考](shadow-reference.zh-TW.md)：查詢影子路徑、主題後綴、文件欄位、限制與錯誤。
- [API 與訊息範例](api-examples.zh-TW.md)：查看完整 token 與影子訊息，理解欄位省略及請求與回應對應規則。
- [連線設定與服務限制](connection-settings.zh-TW.md)：區分規格限制、觀測到的開發環境 Broker 設定，以及仍需實際環境驗證的功能。
- [相容性與版本說明](compatibility-releases.zh-TW.md)：查閱用戶端驗證紀錄、RTK 命名空間差異及文件更新。

## 如何使用這組文件

教學提供目標、前置條件、時序、可執行步驟與預期結果；概念章節說明設計選擇；整合指南解釋運作機制。精確的協定欄位與限制以參考文件為準，範例只作說明，不會重新定義規格。維運章節則介紹恢復與診斷。

桌面版可使用章節分組，行動版可使用分組章節選單。搜尋在本機涵蓋所有已發布頁面。網站索引不包含原始設計文件、維護者筆記或執行階段驗證資訊。即使導覽分組調整，頁面網址仍保持不變。

## 版本與驗證

每頁都會標示適用的原始碼快照，以及已執行的驗證類型。本機範例測試不等於實際環境驗證。使用特定用戶端與版本組合前，請先讀[相容性與版本說明](compatibility-releases.zh-TW.md)。Streaming／WebRTC、OTA 與 Telemetry 資料接收仍屬後續批次；SDK 下載仍在 [ChipSet & SDK](/console/chipset-sdk)。
