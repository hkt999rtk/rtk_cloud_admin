---
title: 整合實作範例
description: 處理離線恢復、版本衝突與重複事件，並如實回報裝置狀態。

category: Build integrations
keywords:
- 離線
- 狀態同步
- 重複事件
- 版本衝突
- 冪等性
- offline
- reconciliation
- duplicate
- conflict
- idempotency
language: zh-TW
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 已完成來源審查與本機測試；尚待實際環境驗證
---

# 整合實作範例

## 啟動或斷線後重新同步狀態

前置條件：有效的驗證資訊、獲授權的完整主題訂閱，以及能讀取真實硬體狀態的韌體。

[開啟時序圖](assets/shadow-offline.zh-TW.html)

1. 先完成連線與訂閱，再讀取狀態。
2. GET 所使用的具名或未命名影子。404 表示狀態不存在，不是傳輸失敗。
3. 比較預期狀態與實際硬體，只套用支援的設定。
4. 回報裝置實際完成的狀態，再確認 accepted 回應。
5. 依版本與事件類型處理通知。結果不確定或版本出現缺口時，重新讀取狀態。

可用[裝置狀態同步快速入門](shadow-quickstart.zh-TW.md)重現：停止監聽程式，從應用程式將 desired 電源改為 `off`，重新啟動監聽程式，GET 目前狀態，模擬套用 `off` 並回報。之後 GET 應顯示 desired 與 reported 電源皆為 `off`。這個測試不需要假設系統會重播離線期間的 delta。

## 處理版本衝突

[開啟時序圖](assets/shadow-conflict.zh-TW.html)

先讀取目前版本，再以同一版本送出兩次更新。第一次應成功，第二次應回傳 409。使用[介面指南](shadow-interfaces.zh-TW.md)中的 HTTP 輔助函式：

```bash
CURRENT_VERSION="$(shadow_http "$SHADOW_URL" | jq -er '.version')"
PATCH="$(jq -nc --argjson version "$CURRENT_VERSION" \
  '{state:{desired:{power:"on"}},version:$version,clientToken:"tutorial-conflict"}')"
shadow_http -X POST -H 'Content-Type: application/json' --data-binary "$PATCH" "$SHADOW_URL"
# Deliberately stale: expect HTTP 409 and a nonzero curl exit status.
shadow_http -X POST -H 'Content-Type: application/json' --data-binary "$PATCH" "$SHADOW_URL"
```

收到 409 後，GET 最新狀態，判斷原本的操作意圖是否仍適用，再依最新版本建立新的部分更新。非冪等操作不可直接自動重試。若其他寫入端已刻意修改電源，盲目重送舊 desired 值可能會覆蓋對方的操作。

## 處理重複與同版本事件

針對每個裝置／影子生命週期，記錄已處理的最高狀態版本。忽略較舊的狀態通知，並避免重複套用已處理的事件。不要跨影子共用同一個全域版本，也不要丟棄所有等於最高版本的事件：accepted、delta 與 documents 可能描述同一次異動，但有不同用途。

請求與回應的對應應與裝置動作分開處理。`power=on` 這類設定應以冪等方式套用，確保重複訊息不會造成一次性硬體操作再次執行。`clientToken` 不是伺服器端的冪等性金鑰。若影子刪除後隔了較長時間才重建，請依明確的生命週期資訊與新的 GET 結果建立基準，不要直接套用任意舊事件。

## 選擇狀態模型或命令協定

持續有效的目標，例如預期電源或設定，適合使用影子。單次給藥、只解鎖一次等動作，則需要命令協定，自行定義動作識別碼、確認回應與安全規則；可能重複套用的 desired 狀態不足以處理這類操作。

操作逾時時，請區分「結果未知」與「已知失敗」。重新發出更新前，先 GET 狀態。設定等待上限並回報診斷資訊，不要無限等待可能根本不會出現的 delta。

下一步：[疑難排解與相容性](troubleshooting.zh-TW.md)。
