---
title: 應用程式與裝置端對端範例
description: 分別執行應用程式與裝置用戶端，確認 desired 與 reported 最後達成一致。

category: Tutorials
keywords:
- 模擬器
- 應用程式
- 裝置
- 下載
- 狀態同步
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
verification: 已完成來源與 API 審查、自動化範例測試，並在註明處讀回開發環境 Broker 設定；尚待完整實際環境接入驗證。

---

# 應用程式與裝置端對端範例

## 目標與前置條件

以兩個獨立驗證的 MQTT 用戶端，分別執行應用程式與模擬裝置。應用程式要求開啟電源，裝置模擬執行變更並回報，應用程式再透過 GET 確認預期狀態與回報狀態一致。本範例是協定用戶端，不能取代韌體的硬體驗證或裝置 owner 傳輸協定。

先完成[雲端與裝置設定](setup-cloud-device.zh-TW.md)、[憑證設定](credential-setup.zh-TW.md)與[token 簽發](authentication.zh-TW.md)。你需要仍有效、**彼此獨立**的應用程式及裝置執行階段 token 檔案、已啟用的 `mqtt` 與 `iot_shadow`、獲授權的測試裝置、Python 3.10 以上版本，以及可取得指定版本相依套件的環境。請將驗證資訊檔案放在範例目錄以外。

[開啟時序圖](assets/two-principal-demo.zh-TW.html)

## 1. 安裝範例

[下載完整 Python 範例](assets/shadow-demo.zip)，解壓縮至只有你能存取的工作目錄。壓縮檔包含 `demo.py`、`recover.py`、`verify.py`、`requirements.txt` 與 `README.md`，不含驗證資訊。

```bash
unzip shadow-demo.zip -d shadow-demo
cd shadow-demo
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python demo.py --help
```

相依套件固定為 `paho-mqtt==2.1.0`，範例使用 callback API 第 2 版與 MQTT 3.1.1。請從[事前準備](before-you-start.zh-TW.md)取得 endpoint、CA 與裝置 ID。兩個終端機都需要相同的 `MQTT_HOST`、`MQTT_PORT`、`CA_FILE`、`DEVICE_ID`、`SHADOW_NAME` 與 `TUTORIAL_DIR`。請選擇沒有其他操作的測試裝置，並使用專用的 `tutorial` 具名影子。

## 2. 啟動模擬裝置

```bash
python demo.py device --token-file "$TUTORIAL_DIR/device-token.json" --seconds 120
```

用戶端等待 CONNECT 與 SUBACK 成功後，才 GET 影子。若影子不存在，會回報模擬電源初始狀態 `off`。重新連線或啟動時，會讀取目前 desired 並套用支援的值。範例只接受 `power=on` 或 `power=off`；重複事件不會重做模擬硬體的狀態轉換，且只有套用變更後才會回報狀態。

## 3. 在另一個終端機執行應用程式

啟用相同的虛擬環境，匯出相同設定，再執行：

```bash
python demo.py app --token-file "$TUTORIAL_DIR/app-token.json" --power on --seconds 45
```

預期的應用程式輸出：

```text
APP desired accepted; waiting for reported state
PASS: desired=reported=on
```

預期的裝置輸出包含：

```text
DEVICE ready: simulated power=off
DEVICE applied power=on
DEVICE reported accepted
```

初次 GET 時，可能就會套用先前已存在的 desired。因此不要要求兩個程序的輸出一定按固定順序出現。只有更新被接受，且後續取得足夠新的 GET 結果，顯示 desired 與 reported 都等於要求的電源狀態時，應用程式才會以狀態 0 結束。單靠 PUBACK 不會顯示 PASS。

## 4. 測試離線恢復與失敗情況

停止裝置程序，讓應用程式要求相反狀態，並在應用程式逾時前重新啟動裝置。裝置會 GET 目前 desired；範例不依賴重播離線期間的 delta。如果裝置未在期限內恢復，應用程式會以非零狀態結束，並指出無法確認狀態是否一致。決定是否重送更新前，請先讀取目前狀態。

只在專用測試環境中，測試未啟用 `iot_shadow` 的裝置、未獲授權的應用程式／裝置配對，或已過期的測試 token。依授權規則，這些情況都應被拒絕。目前審查過的服務流程，尚未完整驗證缺少功能授權時的拒絕行為；請將此負向測試列為發布前必須通過的條件，不要視為已驗證結果。若未獲授權的請求意外成功，應回報授權缺陷，不可依賴此行為。拒絕可能發生在 TLS、CONNECT、SUBACK 或影子的 rejected 回應。範例遇到斷線、格式錯誤的訊息或接收佇列已滿時會結束；它未實作自動更新 token 或無上限的重連。

## 5. 結束測試並整合至產品

停止模擬器，依[影子刪除步驟](shadow-interfaces.zh-TW.md)只移除教學狀態。整合硬體時，將模擬賦值替換成真正的硬體操作與狀態讀回。若要用於長時間執行的產品，請加入 [MQTT 連線指南](mqtt-connection.zh-TW.md)與[整合實作範例](integration-recipes.zh-TW.md)所述、有次數與時間上限的恢復及更新機制。

下載用戶端的驗證紀錄與正式環境驗證分開維護。本機自動化測試涵蓋請求與回應對應、請求遭拒、過期讀取、重複事件及逾時處理；這些結果不能證明任意環境的驗證資訊或服務權限正確。

架構說明：[應用程式、裝置與測試工具架構](integration-test-kit.zh-TW.md)。
