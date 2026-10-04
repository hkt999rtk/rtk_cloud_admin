---
title: 相容性與版本說明
description: 查閱已完成的用戶端驗證、RTK 命名空間差異及文件變更紀錄。

category: Reference
keywords:
- 相容性
- 遷移
- 版本
- 發布
- 驗證
- AWS
- migration
- versions
- release
- qualification
language: zh-TW
applies_to: RTK contracts 9b1ed887912e; Account Manager 54b37b9c407d; Video Cloud
  30fbb9a26155; Admin bbaf62f7d6b5
last_verified: '2026-09-04'
verification: 已完成來源審查與本機檢查；尚待實際環境驗證
---

# 相容性與版本說明

## 適用範圍與驗證層級

本頁記錄已審查的 RTK 規格與文件套件，不代表所有 AWS 用戶端或部署環境都已通過驗證。各頁中繼資料會列出適用的原始碼快照。請區分來源審查、本機解析與規則測試、瀏覽器測試，以及對實際 Broker／服務執行的測試。

| 用戶端或介面 | 本版已完成的驗證 | 尚未確認的範圍 |
| --- | --- | --- |
| Python 3.13 / paho-mqtt 2.1.0 | 範例邏輯測試與 callback API 建構 | 此新範例與實際 RTK MQTT 環境的互通性 |
| Python 3.10+ | 範例預定支援的語法與最低執行版本 | 每個支援的 Python 次版本及平台都能執行 |
| curl / Mosquitto 命令列範例 | 命令語法與來源審查 | 固定版本、跨平台的實際環境驗證矩陣 |
| Admin 文件閱讀頁 | 桌面 Chromium 與 Pixel 7 視窗尺寸下的連結、搜尋與下載檢查 | 所有瀏覽器、實體手機或輔助科技 |
| RTK 用戶端 SDK | 提供維護中的 ChipSet & SDK 套件連結 | 套件存在不代表各版本都相容 |
| AWS 服務／Device SDK | 下方說明的規格對應 | 全面二進位／API 相容性，或可使用 AWS 帳戶驗證資訊 |

SDK 套件版本及發布驗證紀錄請查閱 [ChipSet & SDK](/console/chipset-sdk)。未執行的測試不可標為「通過」。目標環境配額、缺少功能授權時的拒絕行為、撤銷生效時間，以及完整接入流程，仍需在實際環境中驗證。

## RTK 與 AWS 風格介面的對應

| 項目 | RTK 整合方式 |
| --- | --- |
| 狀態、遞迴合併、delta、版本 | 採用 AWS 風格的公開文件模型；限制與欄位省略規則以本版為準 |
| Thing 識別值 | `thingName` 對應 RTK 執行階段 `devid`，不是任意 AWS IoT Thing |
| MQTT 主題 | `$vc/devices/{devid}/shadow/...`；`$aws/things/...` 不是別名 |
| HTTP | 使用回傳的自訂 `iotDataEndpoint`、SigV4 服務名稱 `iotdevicegateway`、region 與工作階段驗證資訊 |
| 租戶路由 | 由授權結果決定；不要自行加入內部命名空間前綴 |
| 具名影子清單 | 使用 HTTP 清單路徑；沒有 MQTT 清單操作 |
| 舊版 RTK Shadow 路徑 | `/api/devices/{devid}/shadow` 與 `/shadows` 不屬於公開支援的相容路徑 |

## 遷移範例

以名為 `tutorial` 的影子為例，請在組合協定主題的位置修改：

```text
AWS-style: $aws/things/device-1/shadow/name/tutorial/update
RTK:       $vc/devices/device-1/shadow/name/tutorial/update
```

對 get/delete 及所有完整的 accepted/rejected/delta/documents 訂閱，都套用相同的根路徑對應。不要替換 JSON 狀態內的任意字串，也不要假設 SDK 的自動主題產生器一定能調整。若無法調整，請使用支援的轉接層或用戶端。MQTT 驗證也必須改用 RTK 回應中的資料，只改主題並不足夠。

HTTP 用戶端應使用 RTK 回傳的 endpoint、region 與工作階段驗證資訊，並保留簽署所用的標準 HTTP method、path、query 及標頭。可用 `GET /things/device-1/shadow?name=tutorial` 驗證目標。不要將這些驗證資訊送到預設 AWS 端點，也不要當成 AWS 帳戶金鑰使用。

切換前，請依 [API 範例](api-examples.zh-TW.md)比對 GET 欄位省略、null 刪除、accepted 部分更新結構、通知快照、請求對應、衝突、刪除重建與重連行為。在獲授權的目標環境測試通過前，保留可回復舊整合的方式。

## 文件版本紀錄

| 日期／版本 | 變更 | 發布狀態 |
| --- | --- | --- |
| 2026-09-04 / Core | 十二篇 MQTT／Shadow 章節、Mermaid 圖表與本機全文搜尋 | 已交付的核心版本 |
| 2026-09-04 / P0 | 接入流程、憑證設定、獨立 App／Device 範例、後端指南及觀測到的開發環境設定 | 工作目錄新增內容；不是服務發布 |
| 2026-09-04 / P1 | 訊息範例、驗證資訊恢復程式、狀態建模、除錯與相容性；分組導覽及依角色安排的閱讀路線 | 工作目錄新增內容；不代表已部署 |

這些文件版本未變更任何服務 API、主題、驗證資訊政策或權限。P0／P1 是文件撰寫里程碑，不是服務的語意化版本。

## 新增生命週期與測試套件 — 2026-09-04

新增「裝置所有權與分享」、「裝置連線狀態與生命週期」及「整合測試套件」。套件新增唯讀檢查，以及必須明確啟用的模擬器操作測試。這是文件與套件更新，不是服務發布或實際環境驗證結果，部署仍待完成。

## 架構圖審查 — 2026-09-04

新增八張方塊圖，說明驗證資訊用途、後端責任、MQTT 主題分類、影子狀態與介面、狀態拆分、恢復元件及分層診斷。九篇指南嵌入這些圖表，快速入門則連到對應的架構指南。既有協定行為與頁面網址保持不變。

## 維護本紀錄

未來每次變更，請記錄日期、規格／服務／用戶端版本、行為差異、受影響的頁面與範例、遷移步驟、驗證紀錄及實際部署狀態。文件修正不應默默變成新的服務能力承諾。請保留既有頁面網址；停用頁面時，明確安排重新導向。[文件導覽](documentation-map.zh-TW.md)說明各章用途與閱讀順序。
