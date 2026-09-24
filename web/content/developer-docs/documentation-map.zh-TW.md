---
title: 文件導覽
description: 選擇一個韌體、應用程式或後端學習路線，然後瀏覽完整的檔案集合。
category: Start here
keywords:
- 開始
- 學習途徑
- 韌體中的程式）
- 應用程式
- 後端
- 內容
- start
- learning path
- firmware
- App
- Backend
- contents
language: zh-TW
applies_to: Developer Docs Core + P0 + P1 source edition
last_verified: '2026-09-04'
verification: 導航和本地搜尋檢查；服務資格因頁面而異
---


# 文件導覽

## 選擇你的道路

|開發人員|建議的順序|
| --- | --- |
|裝置韌體|先決條件→雲/裝置設定→憑據設定→MQTT快速入門→影子快速入門→兩個主機元例→狀態模型→憑據恢復|
|應用程式|先決條件→憑證設定→身份驗證→雙主機示例→API示例→狀態模型→除錯|
|後端|先決條件→雲/裝置設定→後端指南→HTTP介面→API示例→衝突食譜→連線限制|

先閱讀[開始之前](before-you-start.zh-TW.md)。這兩個快速入門教導了單個協議的互動；[應用程式和裝置示例](app-device-example.zh-TW.md)將它們連線起來。只有當您的授權測試身份/裝置尚未準備好時，才需要註冊。

## 按任務瀏覽

### 入門

- [雲端服務概覽](overview.zh-TW.md)— 瞭解MQTT訊息傳遞、影子狀態以及裝置和應用程式的角色。
- [開始之前](before-you-start.zh-TW.md)— 準備一個測試裝置、授權身份、端點和命令列工具。
- [建立第一個雲端與裝置](setup-cloud-device.zh-TW.md)— 在請求執行時憑據之前，建立產品、解決裝置索賠並驗證啟動。
- [設定裝置與應用程式憑證](credential-setup.zh-TW.md)— 生成本地應用程式金鑰和CSR，獲取證書，並區分工廠裝置身份與執行時令牌。

### 教學

- [快速入門：連線與交換訊息](mqtt-quickstart.zh-TW.md)— 釋出JSON訊息，並透過第二個已驗證的MQTT連線接收訊息。
- [快速入門：同步裝置狀態](shadow-quickstart.zh-TW.md)—從應用程式請求開機，並確認裝置報告了所應用狀態。
- [端到端應用程式與裝置範例](app-device-example.zh-TW.md)—執行獨立的應用程式和裝置客戶端，並驗證所需到報告的收斂。

### 概念

- [裝置影子概念](shadow-concepts.zh-TW.md)— 瞭解所需和報告的狀態、差異、名稱、合併規則和版本。
- [設計裝置狀態模型](state-model.zh-TW.md)—設計相容的所需和報告狀態、名為Shadows的狀態、故障報告和並行寫入器。
- [裝置在線狀態與生命週期](device-presence.zh-TW.md)—區分帳戶就緒性、MQTT連線性、所有者運輸和應用程式健康狀況。


### 構建整合

- [身分驗證與存取控制](authentication.zh-TW.md)—獲取執行時令牌，並將其元資料對映到MQTT和Shadow HTTP憑據中。
- [MQTT 連線指南](mqtt-connection.zh-TW.md)—在不假設持久離線交付的情況下配置客戶端身份和恢復。
- [後端整合指南](backend-integration.zh-TW.md)— 選擇一個授權的後端身份，並在不借用裝置憑據的情況下執行已簽名的影子操作。
- [透過 MQTT 與 HTTP 使用裝置影子](shadow-interfaces.zh-TW.md)—使用精確的MQTT主題或已簽名的HTTP請求執行影子操作。
- [整合實作範例](integration-recipes.zh-TW.md)—從離線期間恢復，解決衝突，並保持報告的狀態真實。
- [裝置所有權與分享](ownership-sharing.zh-TW.md)— 瞭解帳戶繫結、授權共享和轉售，而不會將它們與裝置身份混淆。


### 操作和故障排除

- [憑證更新與連線復原](credential-recovery.zh-TW.md)— 更新執行時憑據，並在到期或網路丟失後恢復訂閱和狀態。
- [整合除錯](debugging.zh-TW.md)— 找到第一個故障的協議層，並準備一份有用的消毒支援報告。
- [疑難排解與相容性](troubleshooting.zh-TW.md)—按協議層診斷故障，並瞭解RTK Shadow相容性邊界。
- [整合測試工具組](integration-test-kit.zh-TW.md)—執行只讀MQTT影子探測器和自願模擬控制演習，然後評估生命週期和故障案例。


### 參考

- [MQTT 主題與訊息參考](mqtt-topics.zh-TW.md)— 單獨定義的應用程式訊息、裝置傳輸信封和保留的影子主題。
- [裝置影子 API 與訊息參考](shadow-reference.zh-TW.md)—查詢影子路徑、主題字尾、檔案欄位、限制和錯誤。
- [API 與訊息範例](api-examples.zh-TW.md)—檢查完整的說明符號和影子訊息，包括欄位省略和相關性規則。
- [連線設定與服務限制](connection-settings.zh-TW.md)—區分契約限制、觀察到的dev經紀商設定以及需要環境資格的特徵。
- [相容性與版本說明](compatibility-releases.zh-TW.md)— 跟蹤合格客戶的證據、RTK名稱空間差異和檔案更改。

## 如何使用此集合

教學包含目標、先決條件、順序、可執行步驟和預期結果。概念解釋設計選擇。整合指南解釋機制。參考資料擁有自己的確切協議欄位和限制；示例在不重新定義它們的情況下說明它們。操作章節解釋恢復和診斷。

在桌面上使用章節組，或在手機上使用分組章節選擇器。搜尋覆蓋了本地發布的所有頁面。來源設計檔案、維護者備註和執行時憑據不包括在網站索引中。頁面URL在導航組更改時保持穩定。

## 版本和資格

每頁都列出了適用的快照和執行的驗證型別。本地樣本測試不是即時環境資格。 閱讀[相容性與版本說明](compatibility-releases.zh-TW.md)在依賴客戶端/版本組合之前。流媒體/WebRTC、OTA和遙測匯入仍然是未來的批次；SDK下載仍然在[晶片組和SDK](/console/chipset-sdk).
