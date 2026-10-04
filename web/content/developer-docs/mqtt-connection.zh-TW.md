---
title: MQTT 連線指南
description: 設定用戶端身分與復原流程，不假設服務會持久保存
  並補送離線訊息。
category: Build integrations
keywords:
- 用戶端識別碼
- 服務品質
- 保活
- 工作階段
- 重新連線
- 保留訊息
- Client ID
- QoS
- Keep Alive
- session
- reconnect
- retain
language: zh-TW
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 來源檢閱與本機測試；實際環境驗證仍待完成
---

# MQTT 連線指南

請使用環境提供的公開 MQTT TLS 監聽端點。token 回應包含使用者名稱與 Client ID 資訊，不包含主機、連接埠或 CA 信任憑證包。請驗證伺服器憑證與主機名稱。

[開啟 MQTT 重新連線時序圖](assets/mqtt-reconnect.zh-TW.html)

## 連線設定

| 設定 | 教學使用的值 | 說明 |
| --- | --- | --- |
| 協定 | MQTT 3.1.1（`-V mqttv311`） | 用戶端明確選用此版本，不代表服務只支援此版本 |
| Keep Alive | 60 秒（`-k 60`） | 範例用戶端設定；請確認部署環境的限制 |
| 工作階段 | Mosquitto 預設的 Clean Session | 重新連線後要重新訂閱，不假設會重播離線訊息 |
| QoS | 1 | 傳輸至少一次，應用程式可能重複處理 |
| Retain | 關閉；不使用 `-r` | 教學發布的訊息不會設為保留訊息 |
| Client ID | 回傳的基礎 ID 加上 `-watch` 或 `-send` | 避免教學中的連線互相取代 |

已審查的公開傳輸規格未定義共通的 Keep Alive 上限、工作階段持久保存政策、保留訊息政策，或一般主題的 QoS 要求。設計離線佇列前，請先取得部署環境的這些設定。執行階段日誌有自己的 QoS 1 規格，不可套用到所有主題。

## 復原步驟

1. 斷線時暫停依賴連線的操作；訊息只進入本機佇列時，不可回報發布已完成。
2. 檢查有效期限，必要時更新驗證資訊。驗證資訊或權限無效時，停止反覆重試，並提供可據以處理的錯誤訊息。
3. 暫時性連線失敗時，使用加入隨機延遲、且設有上限的指數退避重試。
4. 使用目前的使用者名稱、密碼與 Client ID 資訊重新連線。
5. 訂閱必要主題，並等待成功的 SUBACK。
6. 使用 Shadow 時，先以 GET 取得目前狀態並與裝置實際狀態同步，再處理佇列中的通知。

驗證資訊仍有效時，請維持該角色的連線身分不變。同時存在的連線不可使用相同 Client ID。教學中的短期發布程序，只有在前一個發布程序結束後，才能重用 `-send`。

## 三種不同的確認訊息

**PUBACK** 確認 QoS 1 訊息已在傳輸層收到。**Shadow `update/accepted`** 確認 Shadow 狀態變更成功。**實際回報值**代表韌體聲稱已套用的狀態。只有韌體驗證或應用層執行結果，才能確認硬體操作成功。

不要只因在收到結果前斷線，就重試非冪等操作。應先讀取目前狀態，或使用應用程式的操作識別碼確認結果。Shadow 的 `clientToken` 用於關聯請求，不保證伺服器端會去除重複操作。

下一步：[離線與衝突處理範例](integration-recipes.zh-TW.md)。

延伸閱讀：[執行驗證資訊復原監控程序](credential-recovery.zh-TW.md)。

延伸閱讀：[裝置線上狀態與主連線](device-presence.zh-TW.md)。
