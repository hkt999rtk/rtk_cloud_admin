---
title: 連線設定與服務限制
description: 區分規格限制、開發環境觀察到的 Broker 設定，
  以及仍需在目標環境驗證的功能。
category: Reference
keywords:
- 連線設定
- 限制
- 保留訊息
- 工作階段
- 開發環境
- limits
- MQTT
- TLS
- QoS
- retain
- session
- WebSocket
- dev
language: zh-TW
applies_to: RTK Cloud contracts 9b1ed887912e; Account Manager 54b37b9c407d; Video
  Cloud 30fbb9a26155; Admin bbaf62f7d6b5
last_verified: '2026-09-04'
verification: 來源／API 檢閱與範例自動檢查；標示處包含開發環境 Broker 設定讀取紀錄。完整的實際環境入門流程仍待驗證。
---

# 連線設定與服務限制

## 目標與事前準備

請依目標環境提供的連線資訊選擇用戶端設定，並區分哪些限制由規格定義。下列觀察值於 **2026-09-04** 從當時的開發環境 Broker 讀取。這些是設定紀錄，不是正式環境的容量保證，也不能證明每項 MQTT 功能都已完成端到端傳遞驗證。

[開啟連線檢查時序圖](assets/connection-check.zh-TW.html)

## 必備的環境連線資訊

請將以下值記錄在專案的環境設定中，不要寫死在原始碼裡：

| 設定值 | 來源與驗證方式 |
| --- | --- |
| Account Manager HTTPS 來源位址 | 帳號或專案的環境設定；驗證一般伺服器 TLS |
| App 與裝置 token 的 mTLS 來源位址 | 環境公布的各角色來源位址；驗證用戶端憑證驗證流程 |
| MQTT 主機名稱與 TLS 連接埠 | 已公布的 MQTT 連線設定；token 中繼資料不包含這些值 |
| 伺服器 CA 信任憑證包 | 環境提供的信任資料；驗證主機名稱與憑證效期 |
| MQTT 使用者名稱與 Client ID 基礎值 | 目前 token 回應的 `mqtt` 欄位 |
| MQTT 密碼 | 目前執行階段的 `access_token` |
| HTTP Shadow 端點、區域、金鑰與工作階段 token | 目前回傳的 `aws_credentials` |

教學使用的 8883 連接埠只是可替換的範例。裝置專用的 WebSocket 傳輸或內部 Broker 監聽端點，不代表提供 MQTT over WebSocket。瀏覽器需要明確公布、具身分驗證的 WSS 端點與受支援的用戶端流程；本版尚未驗證此路徑。在端點確認前，請使用 SDK 為你的平台支援的傳輸方式。

## 規格定義的限制

| 項目 | 已確認的規格 |
| --- | --- |
| MQTT 教學協定 | MQTT 3.1.1；其他版本需在目標環境驗證 |
| Client ID | 回傳且經簽署的基礎值，加上允許的角色後綴；後綴限 1–64 個 ASCII 字母、數字、底線或連字號 |
| 主題隔離 | 依已驗證的 Brand Cloud 命名空間隔離；在一般主題中放入任意裝置 ID，不等於逐裝置存取控制 |
| MQTT Shadow 授權 | 同時需要 `mqtt` 與 `iot_shadow`，且身分主體、裝置與確切主題均須獲得授權 |
| HTTP Shadow 授權 | 需要 `iot_shadow`、已授權身分與已簽署請求 |
| Shadow 狀態大小 | 預期／回報狀態合計上限 8 KiB，不含服務產生的中繼資料；檢查的是合併後儲存的狀態 |
| Shadow 巢狀層數 | 最多八層 |
| Shadow `clientToken` | 最多 64 個 UTF-8 位元組 |
| 具名 Shadow 清單每頁筆數 | 1–100 |
| 訊息傳遞 | Shadow 通知可能重複；排序保證以各 Shadow 為範圍，詳見參考文件 |

## 開發環境觀察到的 Broker 設定

| Broker 設定 | 觀察值 | 對開發者的影響 |
| --- | --- | --- |
| MQTT 封包大小上限 | `1MB` | Broker 封包上限包含協定開銷；Shadow 狀態仍受較小的大小限制 |
| QoS 上限 | 2 | Broker 接受的最高值；教學使用 QoS 1，不保證裝置操作恰好執行一次 |
| 可使用 Retain | `true` | 僅表示 Broker 設定；仍受服務主題政策與功能驗證限制，Shadow 請求不得設為保留訊息 |
| 未完成確認的 MQTT 訊息上限（in-flight） | 32 | 傳輸流量控制設定，不代表允許的 Shadow 並行請求數 |
| 工作階段訊息佇列上限 | 1000 | Broker 的有限佇列，不代表離線 Shadow 通知一定會重播 |
| 工作階段到期時間 | `2h` | Broker 設定；不能套用為教學 Clean Session 的持久保存保證 |
| Keep Alive 倍數／檢查間隔 | 1.5 / `30s` | Broker 存活檢查設定，不代表用戶端會在精確時間點斷線 |
| 伺服器覆寫 Keep Alive | 停用 | 教學請求 60 秒；仍須考慮網路與代理的閒置逾時 |
| 主題層數上限 | 128 | Broker 上限；用戶端仍須使用確切獲授權的主題 |
| 萬用字元訂閱 | Broker 層已啟用 | 即使 Broker 啟用此設定，Shadow ACL 仍可拒絕範圍過廣的萬用字元訂閱 |

讀取設定值，不能驗證重新連線後的資料保留、保留訊息重播、MQTT 5 功能、共享訂閱，或你的帳號能否使用 WebSocket。依賴這些行為前，請先驗證對應情境。正式部署可能使用不同限制；應公布該環境的新設定，不要把這些開發環境數值直接當成通用規格。

## 請求速率、連線數與重試上限

已審查的公開規格尚未定義共通的每帳號連線配額、每秒請求配額，或未完成 Shadow 請求數上限。這是仍待補足的規格與驗證項目。容量規劃前，請先取得目標環境公布的配額；內部佇列長度或 Broker 上限不等於帳號配額。token 不能提高服務使用權或配額。

整合初期，建議每個裝置的每個 Shadow 同時只保留一筆尚未完成的狀態變更。這是保守的用戶端策略，不是伺服器限制。請限制待處理請求數，對暫時性失敗採用加入隨機延遲的退避重試，並明確回報 429，不要無限重試。使用目前有效的驗證資訊重新連線，等待 SUBACK，再以 GET 取得 Shadow 狀態。參閱[連線復原](mqtt-connection.zh-TW.md)。

## 驗收檢查表

發布前，記錄端點與環境設定版本，並確認：錯誤 CA 無法通過 TLS；已到期或屬於其他裝置的驗證資訊遭拒；確切主題訂閱成功；未授權主題遭拒；HTTP 與 MQTT 存取同一個具名 Shadow；重新連線後可透過 GET 復原；狀態超過大小限制或版本過舊時，會回傳文件所述錯誤。未測試的功能應標記為尚未驗證，不可直接視為支援。

下一步：[App 與裝置端到端範例](app-device-example.zh-TW.md)與[疑難排解](troubleshooting.zh-TW.md)。
