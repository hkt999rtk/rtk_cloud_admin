---
title: 端到端應用程式與裝置範例
description: 執行獨立的應用程式和裝置客戶端，並驗證所需到報告的收斂。
category: Tutorials
keywords:
- 模仿者
- 蟒
- 應用程式
- 裝置
- 下載
- 渴望的
- 報告的
- simulator
- Python
- app
- device
- download
- desired
- reported
language: zh-TW
applies_to: RTK Cloud contracts 9b1ed887912e; Account Manager 54b37b9c407d; Video
  Cloud 30fbb9a26155; Admin bbaf62f7d6b5
last_verified: '2026-09-04'
verification: 源/API審查；自動樣本檢查；如注釋所示，開發商代理服務配置讀取。完整的現場入職資格正在等待。
---


# 端到端應用程式與裝置範例

## 目標和先決條件

將一個應用程式和一個模擬裝置作為兩個獨立的身份驗證MQTT客戶端執行。應用程式請求開機；裝置應用模擬更改並報告它；應用程式透過GET檢查收斂。此示例是一個協議客戶端，不是取代韌體硬體驗證或裝置所有者傳輸協議的替代品。

完成[雲/裝置設定](setup-cloud-device.zh-TW.md), [憑證設定](credential-setup.zh-TW.md)，和[代幣發行](authentication.zh-TW.md)。你需要電流**分開**應用程式/裝置執行時令牌檔案，`mqtt`與`iot_shadow`，一個授權的測試裝置、Python 3.10+以及訪問固定依賴項。將憑證檔案放在示例目錄之外。

[開啟重新設計的序列圖](assets/two-principal-demo.zh-TW.html)

## 1. 安裝示例

[下載完整的Python示例](assets/shadow-demo.zip).將其提取到一個私人工作目錄中；該存檔包括`demo.py`, `recover.py`, `verify.py`, `requirements.txt`與`README.md`並且不包含憑據。

```bash
unzip shadow-demo.zip -d shadow-demo
cd shadow-demo
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python demo.py --help
```

固定依賴項是`paho-mqtt==2.1.0`。該示例使用其回撥API版本2和MQTT 3.1.1。從以下處獲取端點、CA和裝置ID[開始之前](before-you-start.zh-TW.md)；兩個終端都需要相同的`MQTT_HOST`, `MQTT_PORT`, `CA_FILE`, `DEVICE_ID`, `SHADOW_NAME`與`TUTORIAL_DIR`。使用專用的名稱Shadow`tutorial`在一個平時空閒的測試裝置上。

## 2. 啟動模擬裝置

```bash
python demo.py device --token-file "$TUTORIAL_DIR/device-token.json" --seconds 120
```

客戶端等待成功連線和SUBACK，然後獲取影子。缺失的影子由報告初始模擬電源來處理`off`。重新連線/重新啟動時，它會讀取當前的預期狀態並應用支援的值。它只接受`power=on`或者`power=off`；重複資料不會重複模擬的硬體過渡。它只有在應用更改後才報告狀態。

## 3. 在另一個終端執行應用程式

啟動相同的虛擬環境並匯出相同的設定，然後執行：

```bash
python demo.py app --token-file "$TUTORIAL_DIR/app-token.json" --power on --seconds 45
```

預期應用輸出：

```text
APP desired accepted; waiting for reported state
PASS: desired=reported=on
```

預期裝置輸出包括：

```text
DEVICE ready: simulated power=off
DEVICE applied power=on
DEVICE reported accepted
```

以前存在的預期值可以在初始GET期間應用。不需要在兩個流程中使用固定線訂單。應用程式只有在更新被接受後，以及稍後的、足夠新的GET顯示預期值和報告值都等於請求的功率後，才會以狀態0退出。僅使用PUBACK無法列印PASS。

## 4. 練習離線恢復和故障

停止裝置流程，使用應用程式請求相反的狀態，然後在應用程式的截止日期前重新啟動裝置。裝置獲取當前所需狀態；該示例不依賴於離線差分的重播。如果在截止日期前沒有裝置返回，應用程式將以未知收斂超時退出非零狀態。在決定是否重複突變之前，請閱讀當前狀態。

嘗試一個沒有的裝置`iot_shadow`，只有在專用測試環境中才會發生未經授權的應用程式/裝置配對或過期的測試令牌。所需的政策結果是拒絕。在經過審查的服務路徑中，尚未合格執行「缺少能力強制執行」。將此負面測試記錄為釋出閘道器，而不是已證實的結果。意外成功的要求是需要報告的授權缺陷，而不是允許依賴該行為的許可。拒絕的確切層次可能有所不同：TLS、CONNECT、SUBACK 或一個被拒絕的影子響應。範例在斷開連線、訊息格式錯誤或接收佇列滿時退出；它不實施自動令牌更新或無限重連重試。

## 5.完成並適應

停止模擬器並使用[明確的影子刪除步驟](shadow-interfaces.zh-TW.md)僅移除教學狀態。對於硬體整合，請將模擬分配替換為實際操作和讀取回饋。對於長時間執行的產品，請在中新增受限恢復和更新行為[MQTT 連線指南](mqtt-connection.zh-TW.md)與[整合實作範例](integration-recipes.zh-TW.md).

下載的客戶端驗證與生產合格性分開記錄。本地自動測試涵蓋響應相關性、拒絕請求、過期讀取、重複事件和超時行為。這並不證實任意環境的憑據或權利。

建築：[應用程式、裝置和測試工具架構](integration-test-kit.zh-TW.md).
