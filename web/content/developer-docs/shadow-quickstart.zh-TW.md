---
title: 裝置狀態同步快速入門
description: 從應用程式要求開啟電源，並確認裝置回報操作完成後的實際狀態。

category: Tutorials
keywords:
- 預期狀態
- 回報狀態
- 狀態差異
- 電源
- 快速入門
- desired
- reported
- delta
- power
- quickstart
language: zh-TW
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 已完成來源審查與本機測試；尚待實際環境驗證
---

# 裝置狀態同步快速入門

目標：使用專用的具名影子，完成 desired → 裝置操作 → reported 的完整流程。請先完成[事前準備](before-you-start.zh-TW.md)與[身分驗證](authentication.zh-TW.md)，並分別備妥應用程式及裝置的 token 檔案。兩個身分必須指向同一裝置與品牌雲端，且已啟用 `mqtt` 和 `iot_shadow`。

[開啟時序圖](assets/shadow-sync.zh-TW.html)

## 1. 先訂閱，再傳送

在終端機 A 設定主題根路徑，並啟動裝置端監聽程式。終端機 B 也要使用相同的 `ROOT` 值。

```bash
export ROOT="\$vc/devices/$DEVICE_ID/shadow/name/$SHADOW_NAME"
mosquitto_sub -h "$MQTT_HOST" -p "$MQTT_PORT" --cafile "$CA_FILE" \
  -u "$(jq -er '.mqtt.username' "$TUTORIAL_DIR/device-token.json")" \
  -P "$(jq -er '.access_token' "$TUTORIAL_DIR/device-token.json")" \
  -i "$(jq -er '.mqtt.client_id' "$TUTORIAL_DIR/device-token.json")-watch" \
  -V mqttv311 -k 60 -q 1 -d -v \
  -t "$ROOT/get/accepted" -t "$ROOT/get/rejected" \
  -t "$ROOT/update/accepted" -t "$ROOT/update/rejected" \
  -t "$ROOT/update/delta" -t "$ROOT/update/documents"
```

等所有訂閱都成功後再繼續。這個監聽程式用來顯示教學中的訊息往返；實際應用程式與韌體應各自維護訂閱，以及尚待回應的請求狀態。

在終端機 B 定義發布訊息的輔助函式：

```bash
export ROOT="\$vc/devices/$DEVICE_ID/shadow/name/$SHADOW_NAME"
shadow_publish() {
  local token_file="$1" operation="$2" payload="$3"
  mosquitto_pub -h "$MQTT_HOST" -p "$MQTT_PORT" --cafile "$CA_FILE" \
    -u "$(jq -er '.mqtt.username' "$token_file")" \
    -P "$(jq -er '.access_token' "$token_file")" \
    -i "$(jq -er '.mqtt.client_id' "$token_file")-send" \
    -V mqttv311 -k 60 -q 1 -t "$ROOT/$operation" -m "$payload"
}
```

## 2. 先讀取，再建立初始狀態

```bash
shadow_publish "$TUTORIAL_DIR/device-token.json" get '{"clientToken":"tutorial-get-1"}'
```

若教學影子尚不存在，會收到帶有 404 錯誤碼的 `get/rejected`；若已存在，會收到 `get/accepted`，請先確認可以安全使用這份狀態。本模擬器練習將預期狀態與實際狀態都設為電源關閉。若使用真實硬體，只能回報實際確認過的狀態。

```bash
shadow_publish "$TUTORIAL_DIR/app-token.json" update \
  '{"state":{"desired":{"power":"off"}},"clientToken":"tutorial-baseline-app"}'
# Wait for update/accepted with the matching clientToken.
shadow_publish "$TUTORIAL_DIR/device-token.json" update \
  '{"state":{"reported":{"power":"off"}},"clientToken":"tutorial-baseline-device"}'
```

等待第二個 accepted 回應。影子不存在時，第一次 UPDATE 就會建立它，不需要額外呼叫建立 API。

## 3. 從應用程式要求變更

```bash
shadow_publish "$TUTORIAL_DIR/app-token.json" update \
  '{"state":{"desired":{"power":"on"}},"clientToken":"tutorial-app-on"}'
```

預期會收到包含 `clientToken:"tutorial-app-on"` 的 `update/accepted`，以及最上層 `state.power` 為 `"on"` 的 `update/delta`。delta 事件不使用 `state.delta.power` 結構；那是 GET 回應的結構。版本與時間戳記由伺服器產生，不需要與固定範例數值相同。

## 4. 執行操作，回報實際狀態

先模擬開啟電源，或由韌體執行操作並確認硬體結果，之後才傳送：

```bash
shadow_publish "$TUTORIAL_DIR/device-token.json" update \
  '{"state":{"reported":{"power":"on"}},"clientToken":"tutorial-device-on"}'
```

等待此請求的 accepted 回應。如果硬體操作失敗，reported 仍須反映真實狀態，並透過應用程式的診斷機制顯示錯誤；不可只因收到 desired 就回報成功。

## 5. 確認狀態一致

```bash
shadow_publish "$TUTORIAL_DIR/app-token.json" get '{"clientToken":"tutorial-get-2"}'
```

在 `get/accepted` 中，確認 `state.desired.power` 與 `state.reported.power` 都是 `"on"`，且沒有 `state.delta.power`。若使用既有具名影子，其他屬性仍可能存在差異。若是只含 `power` 的新教學影子，整個 delta 區段會被省略。

若未收到 delta，請 GET 目前狀態：desired 可能原本就等於 reported，也可能是訂閱失敗，或裝置缺少權限。等待固定秒數並不能證明更新成功。

下一步：[MQTT 與 HTTP 操作](shadow-interfaces.zh-TW.md)及[離線恢復](integration-recipes.zh-TW.md)。若要刪除教學狀態，請先停止監聽程式，再依介面指南中的刪除步驟操作。

架構說明：[影子文件的組成](shadow-concepts.zh-TW.md)。
