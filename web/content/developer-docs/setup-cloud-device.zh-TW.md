---
title: 建立第一個雲端與裝置
description: 在請求執行時憑據之前，請建立產品、解決裝置索賠並驗證啟動。
category: Start here
keywords:
- 入職培訓
- 產品
- 索賠
- 供應
- 子
- 物聯網_影子
- onboarding
- Product
- claim
- provision
- mqtt
- iot_shadow
language: zh-TW
applies_to: RTK Cloud contracts 9b1ed887912e; Account Manager 54b37b9c407d; Video
  Cloud 30fbb9a26155; Admin bbaf62f7d6b5
last_verified: '2026-09-04'
verification: 源/API審查；自動樣本檢查；如注釋所示，開發商代理服務配置讀取。完整的現場入職資格正在等待。
---


# 建立第一個雲端與裝置

## 目標和先決條件

最後使用一個啟用的登入檔裝置，其對映的雲`devid`，一個成功的配置結果和一個授權的應用程式使用者。使用帶有出廠身份和有效索賠令牌、經過驗證的帳戶和管理目標雲/產品的許可權的專用測試裝置。從環境的連線遞接中獲取帳戶管理器公共HTTPS來源和CA捆綁包。

[開啟重新設計的序列圖](assets/first-device.zh-TW.html)

## 1.建立或選擇一個品牌雲和產品

1. 登入Connect+並開啟**我的雲朵**.選擇預期的雲或使用**建立品牌雲**如果您的帳戶被允許建立一個帳戶。在管理之前，請完成所有者啟動。
2. 在雲中，開啟**產品→新增產品**。 進入**產品名稱**, **產品型號**，以及適合您裝置的類別。類別是登入檔分類學，而不是憑證範圍。
3. 選擇**裝置遙測**，對映為`mqtt`，並儲存產品。
4. 安排`iot_shadow`與您的專案運營商一起在經批准的產品/裝置服務配置中。**目前的產品編輯器沒有單獨的陰影核取方塊。**選擇裝置遙測不會啟用影子。標準配置API接受`iot_shadow`，但權利和政策仍然決定了接受程度。
5. 使用**會員和訪問**以及授權開發人員的適當產品範圍。僅有可見的產品或成功登入並不能證明執行時裝置訪問。消費者APP終端使用者繫結是一個單獨的身份流；不要假設控制檯會員資格是APP終端使用者繫結。

對於現有產品，預覽服務更改的影響，並驗證是否已完成任何所需的重新配置。不要編輯令牌或放大索賠響應的服務列表，以繞過缺少權利。

## 2. 保持識別符號分開

|識別符號|使用|
| --- | --- |
|品牌雲/組織ID|客戶經理組織上下文；使用為所選雲返回的ID，永遠不要使用顯示名稱|
|產品/裝置專案配置檔案ID|產品授權和裝置配置|
|註冊處`device.id` |客戶經理裝置路由|
| `provision_input.video_cloud_devid` |執行時間令牌`devid`，MQTT主題和影子`thingName` |
|索取代幣|裝置附帶的擁有證明；不是登入或執行時令牌|

## 3. 透過帳戶經理解決索賠

以下是組織擁有的開發人員整合路徑，而不是單獨的消費者APP索賠API。請按照描述完成帳戶登入[憑證設定](credential-setup.zh-TW.md)，然後保留登入響應為`$TUTORIAL_DIR/account-login.json`.

```bash
export ACCOUNT_BASE='https://accounts.example.test'
export ORG_ID='replace-with-selected-cloud-organization-id'
read -r -s -p 'Device Claim Token: ' CLAIM_TOKEN; printf '\n'
jq -n --arg claim "$CLAIM_TOKEN" \
  '{claim_token:$claim,device_name:"Developer test device"}' > "$TUTORIAL_DIR/claim-request.json"
unset CLAIM_TOKEN
curl --fail-with-body --silent --show-error --cacert "$CA_FILE" \
  -H "Authorization: Bearer $(jq -er '.tokens.access_token' "$TUTORIAL_DIR/account-login.json")" \
  -H 'Content-Type: application/json' --data-binary @"$TUTORIAL_DIR/claim-request.json" \
  "$ACCOUNT_BASE/v1/orgs/$ORG_ID/devices/claim/resolve" > "$TUTORIAL_DIR/claim.json"
export REGISTRY_DEVICE_ID="$(jq -er '.device.id' "$TUTORIAL_DIR/claim.json")"
export DEVICE_ID="$(jq -er '.provision_input.video_cloud_devid' "$TUTORIAL_DIR/claim.json")"
```

預期HTTP 201帶有`claim_id`, `device`，和`provision_input`。索賠解決建立/定位登入檔繫結；它確實**不**開始啟動。 儲存`activity_id`, `clip_public_key`，以及回傳的批准服務列表`provision_input`；即使只是進行影子練習，也不要編造它們。

## 4. 開始配置並閱讀其結果

```bash
jq -e '.provision_input | .service_options | index("mqtt") != null and index("iot_shadow") != null' \
  "$TUTORIAL_DIR/claim.json"
# Continue only if both required capabilities are present.
jq '.provision_input' "$TUTORIAL_DIR/claim.json" > "$TUTORIAL_DIR/provision-request.json"
curl --fail-with-body --silent --show-error --cacert "$CA_FILE" \
  -H "Authorization: Bearer $(jq -er '.tokens.access_token' "$TUTORIAL_DIR/account-login.json")" \
  -H 'Content-Type: application/json' --data-binary @"$TUTORIAL_DIR/provision-request.json" \
  "$ACCOUNT_BASE/v1/orgs/$ORG_ID/devices/$REGISTRY_DEVICE_ID/provision" \
  > "$TUTORIAL_DIR/provision-result.json"
curl --fail-with-body --silent --show-error --cacert "$CA_FILE" \
  -H "Authorization: Bearer $(jq -er '.tokens.access_token' "$TUTORIAL_DIR/account-login.json")" \
  "$ACCOUNT_BASE/v1/orgs/$ORG_ID/devices/$REGISTRY_DEVICE_ID/provisioning" \
  > "$TUTORIAL_DIR/provisioning-state.json"
```

201建立一個操作；200可以返回現有的操作。僅此兩者都不能證明啟動已完成。在工作等待時，請再次使用有限取樣讀取配置狀態。 檢查`operation.status`, `readiness.state`, `readiness.sources`，和`video_metadata`；檢查`readiness.failure`當存在時；在終端故障時停止並記錄其操作ID。在重試不確定請求時保留相同的操作身份，而不是啟動無關的重複操作。

## 5. 準備檢查和故障恢復

- 確認登入檔裝置已啟用並對映到預期的`DEVICE_ID`.
- 確認配置成功，裝置已啟動並具有兩個功能。
- 確認證書身份與那個匹配`DEVICE_ID`並且應用程式使用者已獲得授權。
- 發放單獨的應用程式/裝置令牌，然後單獨驗證連線、SUBACK和影子GET。一個新的影子GET可能會正確返回404。
- MQTT教學連線不實現服務的所有者傳輸協議，也不證明車隊線上指示器應該更改。

對於無效/已申請的令牌，請使用申請解決方案/轉讓策略；重複呼叫配置不會修復所有權。對於403，請驗證雲端、產品範圍和裝置繫結。對於待啟用的裝置，請檢查操作，而不是更換裝置憑據。 如果`iot_shadow`缺失，請返回產品/權利設定步驟。

下一個：[設定裝置與應用程式憑證](credential-setup.zh-TW.md)，接著[兩個主要示例](app-device-example.zh-TW.md).

繼續：[所有權和釋出生命週期](ownership-sharing.zh-TW.md).

建築：[帳戶、工廠和執行時生命週期層](device-presence.zh-TW.md).
