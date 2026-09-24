---
title: 快速入門：連線與交換訊息
description: 釋出一個JSON訊息，並透過第二個已驗證的MQTT連線接收它。
category: Tutorials
keywords:
- 發布
- 訂閱
- SUBACK
- PUBACK
- mosquitto
- publish
- subscribe
language: zh-TW
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 來源審查和本地測試；現場環境資格待定
---


# 快速入門：連線與交換訊息

目標：接收`{"temperature_c":23}`，透過應用程式定義的主題傳送。請先完成[身分驗證](authentication.zh-TW.md)。下方兩個連線都使用測試裝置權杖，但採用不同的角色字尾。這樣可先驗證 MQTT 機制，再於裝置影子教學加入第二個主體。

[開啟重新設計的序列圖](assets/mqtt-exchange.zh-TW.html)

## 1. 開始訂閱者

在設定了先決變數的A終端執行：

```bash
mosquitto_sub -h "$MQTT_HOST" -p "$MQTT_PORT" --cafile "$CA_FILE" \
  -u "$(jq -er '.mqtt.username' "$TUTORIAL_DIR/device-token.json")" \
  -P "$(jq -er '.access_token' "$TUTORIAL_DIR/device-token.json")" \
  -i "$(jq -er '.mqtt.client_id' "$TUTORIAL_DIR/device-token.json")-watch" \
  -V mqttv311 -k 60 -q 1 -d -v \
  -t "tutorials/$DEVICE_ID/temperature"
```

在釋出之前，請等待除錯輸出顯示成功SUBACK。僅僅執行一個執行中的過程並不能證明訂閱成功。這些本地測試命令將憑據作為過程引數傳遞；使用孤立的開發機器，並避免在共享日誌中捕獲命令呼叫。

## 2. 釋出訊息

在B埠，使用相同的環境和`TUTORIAL_DIR`:

```bash
mosquitto_pub -h "$MQTT_HOST" -p "$MQTT_PORT" --cafile "$CA_FILE" \
  -u "$(jq -er '.mqtt.username' "$TUTORIAL_DIR/device-token.json")" \
  -P "$(jq -er '.access_token' "$TUTORIAL_DIR/device-token.json")" \
  -i "$(jq -er '.mqtt.client_id' "$TUTORIAL_DIR/device-token.json")-send" \
  -V mqttv311 -k 60 -q 1 \
  -t "tutorials/$DEVICE_ID/temperature" -m '{"temperature_c":23}'
```

## 3. 驗證交付

終端A應該列印：

```text
tutorials/device-1/temperature {"temperature_c":23}
```

JSON是您的應用程式的示例模式；代理服務不會將其轉換為影子狀態。在QoS 1結束時發布命令確認傳輸接收，而不是訂閱者業務邏輯。重複傳送仍然是可能的。完成後，請使用Ctrl-C停止訂閱者。

## 如果沒有收到訊息

檢查SUBACK是否成功，匹配主題拼寫，匹配品牌雲身份，以及不同的客戶端ID。不要指望您稍後訂閱時會重播較早的未保留訊息。成功的通用主題並不能表明影子許可權。

下一個：[連線行為](mqtt-connection.zh-TW.md), [主題參考](mqtt-topics.zh-TW.md)，或者[影子快速入門](shadow-quickstart.zh-TW.md).

建築：[MQTT主題架構](mqtt-topics.zh-TW.md).
