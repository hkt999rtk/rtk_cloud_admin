---
title: 快速入門：同步裝置狀態
description: 從應用程式請求開機，並確認裝置報告了所應用狀態。
category: Tutorials
keywords:
- 渴望的
- 報告的
- 三角洲
- 力量
- 快速啟動
- desired
- reported
- delta
- power
- quickstart
language: zh-TW
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 來源審查和本地測試；現場環境資格待定
---


# 快速入門：同步裝置狀態

目標：使用專用的名為Shadow的裝置完成一個真實的理想→裝置操作→報告的週期。 完整的[設定](before-you-start.zh-TW.md)與[身分驗證](authentication.zh-TW.md)，包括單獨的應用程式和裝置令牌檔案。兩個主機都必須針對相同的裝置和品牌雲`mqtt`與`iot_shadow`啟用。

[開啟重新設計的序列圖](assets/shadow-sync.zh-TW.html)

## 1. 傳送前訂閱

在終端A中，設定根並啟動裝置觀察器。重複使用這個`ROOT`終端B中的值。

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

等待所有請求的訂閱成功。觀察者會顯示本教學的交換；一個真正的應用程式和韌體都保持自己的訂閱和待處理請求狀態。

在終端B中定義一個小型發布助手：

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

## 2.先閱讀，然後建立基線

```bash
shadow_publish "$TUTORIAL_DIR/device-token.json" get '{"clientToken":"tutorial-get-1"}'
```

新的教學《Shadow》回歸`get/rejected`帶有程式404。現有的程式會返回`get/accepted`；在繼續之前，請驗證使用是否安全。在本模擬器練習中，將關機設定為所需和實際狀態。在硬體上，僅報告您實際驗證過的狀態。

```bash
shadow_publish "$TUTORIAL_DIR/app-token.json" update \
  '{"state":{"desired":{"power":"off"}},"clientToken":"tutorial-baseline-app"}'
# Wait for update/accepted with the matching clientToken.
shadow_publish "$TUTORIAL_DIR/device-token.json" update \
  '{"state":{"reported":{"power":"off"}},"clientToken":"tutorial-baseline-device"}'
```

等待第二個接受的響應。第一次更新會建立一個丟失的影子；不需要明確建立API。

## 3.從應用程式中請求更改

```bash
shadow_publish "$TUTORIAL_DIR/app-token.json" update \
  '{"state":{"desired":{"power":"on"}},"clientToken":"tutorial-app-on"}'
```

預期`update/accepted`與`clientToken:"tutorial-app-on"`與`update/delta`誰的頂級層`state.power`是`"on"`。三角洲事件的形狀不是`state.delta.power`；GET響應使用這種層次結構。版本和時間戳是伺服器值，不需要與固定示例匹配。

## 4. 申請並報告實際狀態

模擬開機，或讓韌體應用並驗證硬體操作。只有這樣才能傳送：

```bash
shadow_publish "$TUTORIAL_DIR/device-token.json" update \
  '{"state":{"reported":{"power":"on"}},"clientToken":"tutorial-device-on"}'
```

等待其接受的響應。如果硬體失敗，請保持報告的狀態準確，並透過應用程式診斷揭示故障；切勿僅僅因為收到所需內容就報告成功。

## 5. 驗證收斂性

```bash
shadow_publish "$TUTORIAL_DIR/app-token.json" get '{"clientToken":"tutorial-get-2"}'
```

在`get/accepted`，檢查`state.desired.power`與`state.reported.power`都是`"on"`與`state.delta.power`缺失。現有名稱的Shadow中的其他屬性可能仍然存在差異。在全新的教學中，Shadow只有`power`，三角洲部分被完全省略了。

如果沒有達爾塔到達，請獲取當前狀態：所需值可能已經等於報告值，訂閱可能失敗，或者裝置可能缺少許可權。不要使用固定睡眠作為成功突變的證據。

下一個：[MQTT和HTTP操作](shadow-interfaces.zh-TW.md)與[離線恢復](integration-recipes.zh-TW.md).要刪除教學狀態，請在停止觀察者後使用介面指南中的明確刪除步驟。

建築：[影子檔案體系結構](shadow-concepts.zh-TW.md).
