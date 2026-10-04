---
title: 建立第一個雲端與裝置
description: 建立產品、完成裝置認領並驗證啟用結果，再請求
  執行階段驗證資訊。
category: Start here
keywords:
- 入門
- 產品
- 裝置認領
- 佈建
- 啟用
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
verification: 來源／API 檢閱與範例自動檢查；標示處包含開發環境 Broker 設定讀取紀錄。完整的實際環境入門流程仍待驗證。
---

# 建立第一個雲端與裝置

## 目標與事前準備

完成本流程後，你應有一筆已啟用的裝置註冊資料、對應的雲端 `devid`、成功的佈建結果，以及已獲授權的應用程式使用者。請使用具有出廠身分與有效 Claim Token 的專用測試裝置，以及已驗證且有權管理目標 Cloud／Product 的帳號。從環境連線資訊取得 Account Manager 的公開 HTTPS 來源位址與 CA 憑證包。

[開啟首次裝置設定時序圖](assets/first-device.zh-TW.html)

## 1. 建立或選取 Brand Cloud 與產品

1. 登入 Connect+ 並開啟 **My Clouds**。選取目標雲端；若帳號有建立權限，也可使用 **Create Brand Cloud** 建立。開始管理前，須先完成擁有者啟用流程。
2. 在該雲端中開啟 **Products → Add Product**，填入 **Product Name**、**Product Model**，並選擇適合裝置的類別。類別是註冊資料的分類，不代表驗證資訊的授權範圍。
3. 選取對應 `mqtt` 的 **Device Telemetry**，並儲存產品。
4. 請與專案維運人員協調，在經核准的產品或裝置服務設定中加入 `iot_shadow`。**目前的產品編輯器沒有獨立的 Shadow 核取方塊。**選取 Device Telemetry 不會啟用 Shadow。正式佈建 API 接受 `iot_shadow`，但仍會檢查服務使用權與政策。
5. 透過 **Members & Access**，在適當的產品範圍內授權開發者。能看見產品或成功登入，不代表執行階段能存取裝置。消費者 APP 終端使用者綁定屬於另一套身分流程；控制台成員資格不等於 APP 終端使用者綁定。

若使用既有產品，請先預覽服務變更的影響，並確認必要的重新佈建已完成。不要修改 token 或擴增認領回應中的服務清單，藉此繞過服務使用權限制。

## 2. 區分各種識別碼

| 識別碼 | 用途 |
| --- | --- |
| Brand Cloud／組織 ID | 指定 Account Manager 的組織範圍；使用所選雲端回傳的 ID，不可用顯示名稱代替 |
| 產品／裝置項目設定檔 ID | 產品授權與裝置設定 |
| 註冊資料中的 `device.id` | Account Manager 裝置 API 的路徑參數 |
| `provision_input.video_cloud_devid` | 執行階段 token 的 `devid`、MQTT 主題與 Shadow 的 `thingName` |
| 裝置認領碼（Claim Token） | 裝置隨附的持有證明，不是登入或執行階段 token |

## 3. 透過 Account Manager 解析裝置認領資料

以下是組織持有裝置的開發者整合流程，不是另一套消費者 APP 認領 API。請依[憑證設定](credential-setup.zh-TW.md)完成帳號登入，並將登入回應儲存為 `$TUTORIAL_DIR/account-login.json`。

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

預期收到 HTTP 201，並包含 `claim_id`、`device` 與 `provision_input`。認領解析會建立或找出裝置註冊資料的綁定，但**不會**啟動裝置啟用流程。請保留 `provision_input` 中回傳的 `activity_id`、`clip_public_key` 及核准服務清單；即使只測試 Shadow，也不要自行編造這些值。

## 4. 開始佈建並檢查結果

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

201 代表建立一筆操作；200 則可能回傳既有操作。兩者都不能單獨證明裝置已啟用。操作尚未完成時，請在設定的輪詢上限內再次讀取佈建狀態。檢查 `operation.status`、`readiness.state`、`readiness.sources` 與 `video_metadata`；若有 `readiness.failure`，也須檢查。遇到無法繼續的失敗狀態時，請停止並記錄操作 ID。請求結果不確定而需重試時，保留相同操作識別資訊，避免建立無關的重複操作。

## 5. 就緒檢查與失敗復原

- 確認裝置註冊資料已啟用，且對應預期的 `DEVICE_ID`。
- 確認佈建成功，裝置已啟用且具備兩項功能。
- 確認憑證身分符合該 `DEVICE_ID`，且 App 使用者有權存取。
- 分別簽發 App 與裝置 token，再分別驗證 CONNECT、SUBACK 與 Shadow GET。尚未建立的 Shadow，GET 正常情況下可能回傳 404。
- MQTT 教學中的連線沒有實作服務的裝置主連線（owner transport）協定，也不能據此認定 Fleet 線上狀態指示應該改變。

若認領碼無效或已使用，請依認領解析或所有權移轉政策處理；反覆呼叫佈建 API 無法修復所有權。遇到 403 時，請確認雲端、產品授權範圍與裝置綁定。若啟用仍在等待中，應檢查操作狀態，不要替換裝置驗證資訊。若缺少 `iot_shadow`，請返回產品與服務使用權設定步驟。

下一步：[設定裝置與 App 憑證](credential-setup.zh-TW.md)，再執行 [App 與裝置整合範例](app-device-example.zh-TW.md)。

延伸閱讀：[所有權與解除綁定的生命週期](ownership-sharing.zh-TW.md)。

架構說明：[帳號、出廠身分與執行階段的生命週期](device-presence.zh-TW.md)。
