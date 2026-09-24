---
title: 身分驗證與存取控制
description: 獲取執行時令牌，並將其元資料對映到MQTT和Shadow HTTP憑據中。
category: Build integrations
keywords:
- 請求_令牌
- 重新整理_令牌
- 其他
- 體4
- 客戶端_id
- aws_憑據
- request_token
- refresh_token
- mTLS
- SigV4
- client_id
- aws_credentials
language: zh-TW
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 來源審查和本地測試；現場環境資格待定
---


# 身分驗證與存取控制

經過驗證的裝置證書識別了裝置。應用程式證書識別了應用程式使用者；應用程式執行時令牌還會與請求的裝置繫結。在測試時，請將這兩個身份分開。

[開啟重新設計的序列圖](assets/authentication.zh-TW.html)

## 身份驗證邊界

在各自的邊界上使用每個憑據。帳戶經理持有人不是MQTT密碼；執行時JWT不是AWS帳戶憑據。下面的共享地圖補充了令牌交換序列和詳細的憑據設定指南。

![身份驗證邊界](assets/credential-uses.zh-TW.svg)

[全尺寸方塊圖](assets/credential-uses.zh-TW.svg) · [Mermaid 原始檔](assets/credential-uses.zh-TW.mmd)

## 獲取執行時憑據

完成後[先決條件](before-you-start.zh-TW.md)，在您的私人工作目錄中執行以下操作。`aws_iot_data`請求HTTP示例使用的短暫的憑證捆綁包。

```bash
jq -n --arg devid "$DEVICE_ID" \
  '{scope:"device",devid:$devid,aws_iot_data:true}' > "$TUTORIAL_DIR/device-request.json"
curl --fail-with-body --silent --show-error \
  --cacert "$CA_FILE" --cert "$DEVICE_CERT" --key "$DEVICE_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TUTORIAL_DIR/device-request.json" \
  "$DEVICE_TOKEN_BASE/request_token" > "$TUTORIAL_DIR/device-token.json"

jq -n --arg devid "$DEVICE_ID" \
  '{scope:"app",devid:$devid,aws_iot_data:true}' > "$TUTORIAL_DIR/app-request.json"
curl --fail-with-body --silent --show-error \
  --cacert "$CA_FILE" --cert "$APP_CERT" --key "$APP_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TUTORIAL_DIR/app-request.json" \
  "$APP_TOKEN_BASE/request_token" > "$TUTORIAL_DIR/app-token.json"
```

發生HTTP錯誤後請勿繼續。請確認每個檔案都不是空的`access_token`, `mqtt.username`，和`mqtt.client_id`不列印他們的值。HTTP Shadow示例還需要`aws_credentials`物件。缺失的欄位不是需要編造的值：檢查能力啟用、端點版本和發行策略。

## 將憑據對映到協議

|連線欄位|價值|
| --- | --- |
|MQTT使用者名稱|回應`mqtt.username` |
|MQTT密碼|回應`access_token` |
|MQTT客戶端ID|回應`mqtt.client_id`，可選後跟一個允許的角色字尾|
|HTTP 影子訪問金鑰| `aws_credentials.accessKeyId` |
|HTTP 影子金鑰| `aws_credentials.secretAccessKey` |
|HTTP 影子會話令牌| `aws_credentials.sessionToken` |
|HTTP影子區域和端點| `aws_credentials.region`, `aws_credentials.iotDataEndpoint` |

MQTT使用者名必須與簽名的Brand Cloud身份相匹配。不要在主題前加上Brand Cloud ID。同時的MQTT連線需要不同的客戶端ID。這些教學附加`-watch`與`-send`到返回的基礎。檢查後的實現允許1-64個ASCII字母、數字、下劃線或連字元字尾；使用簡短的固定角色。

普通受保護的服務HTTP API通常使用承載人授權。公共Shadow HTTP契約使用帶有服務名稱的SigV4`iotdevicegateway`；使用返回的憑證捆綁包，而不是假設承運人示例適用。

## 在到期前續訂

從已簽署的JWT中安排令牌續訂`exp`，不是要求的`expiry`持續時間。將解碼的索賠視為排程資料，而不是本地驗證的授權。`/refresh_token`使用歷史上命名的仍然有效的簽名令牌`refresh_token`欄位；這不是一個不透明的重新整理許可權。

```bash
jq '{refresh_token:.access_token}' "$TUTORIAL_DIR/device-token.json" \
  > "$TUTORIAL_DIR/reissue-request.json"
curl --fail-with-body --silent --show-error --cacert "$CA_FILE" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TUTORIAL_DIR/reissue-request.json" \
  "$API_BASE/refresh_token" > "$TUTORIAL_DIR/device-token-next.json"
```

在更換當前令牌檔案之前，請驗證響應。使用其新密碼和返回的元資料重新連線MQTT。如果舊令牌已過期或重新發行失敗，請透過證書引導流程獲取新令牌。要更新HTTP Shadow憑據，請重複`/request_token`與`aws_iot_data:true`；不要假設重新發行會重新發行該捆綁包。

## 故障檢查

TLS故障發生在HTTP響應之前。檢查伺服器信任鏈、證書有效性、私鑰和端點。HTTP令牌拒絕可能表明裝置身份不匹配、未活動裝置、缺少許可權或不可用的裝置投影。成功發行後的MQTT拒絕需要檢查使用者名稱、客戶端ID、令牌到期日和`mqtt`能力。

下一個：[MQTT快速入門](mqtt-quickstart.zh-TW.md)或者[簽名的HTTP影子請求](shadow-interfaces.zh-TW.md).

繼續：[憑證更新和恢復](credential-recovery.zh-TW.md).
