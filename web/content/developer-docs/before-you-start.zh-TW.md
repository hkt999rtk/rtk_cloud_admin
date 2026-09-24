---
title: 開始之前
description: 準備一個測試裝置、授權身份、端點和命令列工具。
category: Start here
keywords:
- 先決條件
- 終點
- TLS
- 憑證
- 設定
- prerequisites
- endpoint
- certificate
- setup
language: zh-TW
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 來源審查和本地測試；現場環境資格待定
---


# 開始之前

## 你需要什麼

在同一裝置和Brand Cloud上使用專用的測試裝置和授權的應用程式身份。 跟隨[建立第一個雲端與裝置](setup-cloud-device.zh-TW.md)與[設定裝置與應用程式憑證](credential-setup.zh-TW.md)在開始之前完成註冊、啟動、授權和憑證獲取。

|輸入|如何獲得它|
| --- | --- |
|裝置ID|您註冊的測試裝置；更換`device-1`一致地|
|裝置/應用程式令牌端點|環境已驗證的mTLS來源；這些可能與普通API來源不同|
|MQTT主機名稱和TLS埠|您的環境連線設定；不是從令牌元資料中推斷出的|
|伺服器CA信任捆綁包|環境提供的信任鏈|
|裝置證書和私鑰|裝置註冊；證書身份必須匹配`devid` |
|應用程式證書和私鑰訪問|帳戶登入和應用程式本地CSR註冊|
| `mqtt`, `iot_shadow` |產品/裝置服務配置|

帳戶經理登入令牌不是用作MQTT密碼的影片雲執行時令牌。生產應用程式將其本地生成的私鑰保留在平臺安全儲存中。可匯出開發者控制檯捆綁包僅用於本地/試用測試。這些命令列教學假設有一個授權的測試PEM捆綁包；生產應用程式使用其平臺金鑰提供商執行相同的令牌交換。

## 本地工具和設定

安裝`curl`與`--aws-sigv4`支援，`jq`，以及Mosquitto`mosquitto_pub`與`mosquitto_sub`客戶端。用Bash進行示例。所有示例都使用TLS驗證；不需要不安全的模式。

在教學中使用的每個終端中設定這些值：

```bash
export API_BASE='https://api.example.test'
export DEVICE_TOKEN_BASE='https://device.example.test'
export APP_TOKEN_BASE='https://app-mtls.example.test'
export MQTT_HOST='mqtt.example.test'
export MQTT_PORT='8883'
export CA_FILE='/path/to/server-ca.pem'
export DEVICE_CERT='/path/to/device-cert.pem'
export DEVICE_KEY='/path/to/device-key.pem'
export APP_CERT='/path/to/app-cert.pem'
export APP_KEY='/path/to/app-key.pem'
export DEVICE_ID='device-1'
export SHADOW_NAME='tutorial'
```

使用每個證書角色的實際mTLS來源。普通的HTTP API或普通的HTTP埠轉發無法建立客戶端證書身份。

示例主機名稱不會解析到您的服務。請將它們和證書路徑替換為您環境的值。埠8883是一個示例，而不是通用服務保證。

將憑據儲存在儲存庫外的私人臨時工作目錄中：

```bash
umask 077
export TUTORIAL_DIR="$(mktemp -d)"
```

複製相同的`TUTORIAL_DIR`值傳輸到其他終端。不要啟用外殼跟蹤或在報告中包含令牌檔案。使用否則處於休眠狀態的測試裝置；其一般的MQTT教學訊息和命名Shadow更新是真正的寫入。

## 準備檢查

確認裝置處於活動狀態，該應用程式已授權該裝置使用，並且兩種功能都已啟用。使用以下方法獲取單獨的裝置和應用程式執行時令牌檔案[身分驗證與存取控制](authentication.zh-TW.md). 成功的令牌響應是第一個里程碑；成功的MQTT連線和訂閱是獨立的檢查。

下一個：[交換一個MQTT訊息](mqtt-quickstart.zh-TW.md).

建築：[憑證型別和目的地](credential-setup.zh-TW.md).
