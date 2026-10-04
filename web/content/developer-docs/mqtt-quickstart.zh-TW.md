---
title: 快速入門：連線與交換訊息
description: 發布一則 JSON 訊息，再透過另一條已驗證的 MQTT
  連線接收。
category: Tutorials
keywords:
- 發布
- 訂閱
- 訊息交換
- publish
- subscribe
- SUBACK
- PUBACK
- mosquitto
language: zh-TW
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 來源檢閱與本機測試；實際環境驗證仍待完成
---

# 快速入門：連線與交換訊息

目標：在應用程式自訂的主題收到 `{"temperature_c":23}`。請先完成[身分驗證](authentication.zh-TW.md)。以下兩條連線都使用測試裝置 token，但使用不同的角色後綴。先以同一身分確認 MQTT 運作，再於 Shadow 教學加入第二個身分主體。

[開啟 MQTT 訊息交換時序圖](assets/mqtt-exchange.zh-TW.html)

## 1. 啟動訂閱端

在已設定必要變數的終端機 A 中執行：

```bash
mosquitto_sub -h "$MQTT_HOST" -p "$MQTT_PORT" --cafile "$CA_FILE" \
  -u "$(jq -er '.mqtt.username' "$TUTORIAL_DIR/device-token.json")" \
  -P "$(jq -er '.access_token' "$TUTORIAL_DIR/device-token.json")" \
  -i "$(jq -er '.mqtt.client_id' "$TUTORIAL_DIR/device-token.json")-watch" \
  -V mqttv311 -k 60 -q 1 -d -v \
  -t "tutorials/$DEVICE_ID/temperature"
```

請等除錯輸出顯示 SUBACK 成功後再發布訊息。程序正在執行，不代表訂閱成功。這些本機測試指令會以程序參數傳入驗證資訊；請使用隔離的開發機器，避免將指令執行內容記錄在共用日誌中。

## 2. 發布訊息

在終端機 B 使用相同環境與 `TUTORIAL_DIR` 執行：

```bash
mosquitto_pub -h "$MQTT_HOST" -p "$MQTT_PORT" --cafile "$CA_FILE" \
  -u "$(jq -er '.mqtt.username' "$TUTORIAL_DIR/device-token.json")" \
  -P "$(jq -er '.access_token' "$TUTORIAL_DIR/device-token.json")" \
  -i "$(jq -er '.mqtt.client_id' "$TUTORIAL_DIR/device-token.json")-send" \
  -V mqttv311 -k 60 -q 1 \
  -t "tutorials/$DEVICE_ID/temperature" -m '{"temperature_c":23}'
```

## 3. 驗證訊息傳遞

終端機 A 應顯示：

```text
tutorials/device-1/temperature {"temperature_c":23}
```

這份 JSON 是應用程式自訂的範例資料格式；Broker 不會將它轉成 Shadow 狀態。QoS 1 發布指令完成，只確認傳輸層已收到訊息，不代表訂閱端的業務邏輯已完成。訊息仍可能重複傳遞。完成後，使用 Ctrl-C 停止訂閱端。

## 未收到訊息時

確認 SUBACK 成功、主題拼寫一致、Brand Cloud 身分一致，且 Client ID 不同。較晚才訂閱時，不會重播先前未保留的訊息。一般主題操作成功，不代表已具備 Shadow 權限。

下一步：[連線行為](mqtt-connection.zh-TW.md)、[主題參考](mqtt-topics.zh-TW.md)或 [Shadow 快速入門](shadow-quickstart.zh-TW.md)。

架構說明：[MQTT 主題架構](mqtt-topics.zh-TW.md)。
