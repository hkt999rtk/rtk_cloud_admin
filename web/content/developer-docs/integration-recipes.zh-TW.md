---
title: 整合實作範例
description: 從離線期間恢復，解決衝突，並保持報告的狀態真實。
category: Build integrations
keywords:
- 離線的
- 和解
- 複製的
- 衝突
- 同值性
- offline
- reconciliation
- duplicate
- conflict
- idempotency
language: zh-TW
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 來源審查和本地測試；現場環境資格待定
---


# 整合實作範例

## 啟動或斷開連線後進行對賬

先決條件：當前憑證、授權的精確訂閱以及能夠讀取實際硬體狀態的韌體。

[開啟重新設計的序列圖](assets/shadow-offline.zh-TW.html)

1. 在閱讀狀態之前，請連線並訂閱。
2. 獲取您使用的命名或未命名的影子。將404視為丟失狀態，而不是傳輸失敗。
3. 將所需狀態與實際硬體進行比較。僅應用受支援的設定。
4. 報告裝置實際應用了什麼，然後確認接受的回應。
5. 使用版本和事件型別處理通知。在不確定性或差距時重新閱讀。

用這個複製這個[影子快速入門](shadow-quickstart.zh-TW.md)：停止觀察器，將應用程式所需的功率更改為`off`，重新啟動觀察者，獲取當前狀態，模擬應用`off`，並報告它。然後GET應該顯示所需和報告的功率`off`。該測試在不假設離線差分重播的情況下成功。

## 處理版本衝突

[開啟重新設計的序列圖](assets/shadow-conflict.zh-TW.html)

讀取當前版本，並傳送兩個具有相同版本的更新。第一個必須成功，第二個必須返回409。對於來自的HTTP助手[介面指南](shadow-interfaces.zh-TW.md):

```bash
CURRENT_VERSION="$(shadow_http "$SHADOW_URL" | jq -er '.version')"
PATCH="$(jq -nc --argjson version "$CURRENT_VERSION" \
  '{state:{desired:{power:"on"}},version:$version,clientToken:"tutorial-conflict"}')"
shadow_http -X POST -H 'Content-Type: application/json' --data-binary "$PATCH" "$SHADOW_URL"
# Deliberately stale: expect HTTP 409 and a nonzero curl exit status.
shadow_http -X POST -H 'Content-Type: application/json' --data-binary "$PATCH" "$SHADOW_URL"
```

在409之後，獲取並決定原始意圖是否仍然適用。根據最新版本構建新的補丁程式。不要自動重試非同構操作。如果另一個寫入者故意更改電源，盲目重複舊的預期值可能會撤銷該工作。

## 處理重複和相同版本的事件

保留每個裝置/影子生命週期的最高處理狀態版本。忽略舊狀態通知，並重複消除已應用的事件。不要在影子中使用一個全域性版本。不要丟棄每個等於最高版本的事件：接受、差異和檔案可以描述相同的突變，並為不同的消費者提供服務。

將處理請求與裝置操作分開相關聯。應用設定，例如`power=on`無效性，因此重複交付不能重複一次性的物理操作。`clientToken`不是伺服器無效鍵。在長時間儲存的刪除/重新建立後，使用明確的生命週期知識和新的GET來建立新基線，而不是靜默地應用任意舊事件。

## 選擇狀態或命令

使用Shadow來實現持久目標，例如所需的功率或配置。一次性操作，如分配劑量或解鎖一次，需要具有自身操作身份、確認和安全規則的命令協議；可重播的所需狀態是不夠的。

當操作超時時，將未知結果與已知故障區分開來。在釋出替換突變之前，使用GET狀態。使用有限等待並顯示診斷程式，而不是永遠迴圈等待可能不存在的差異。

下一個：[疑難排解與相容性](troubleshooting.zh-TW.md).
