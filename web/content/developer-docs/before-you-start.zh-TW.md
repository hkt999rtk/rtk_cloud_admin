---
title: 開始之前
description: 準備測試裝置、已授權身分、服務端點與命令列
  工具。
category: Start here
keywords:
- 事前準備
- 端點
- 憑證
- 環境設定
- prerequisites
- endpoint
- TLS
- certificate
- setup
language: zh-TW
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 來源檢閱與本機測試；實際環境驗證仍待完成
---

# 開始之前

## 事前準備

請使用專用測試裝置，以及有權存取該裝置與同一 Brand Cloud 的 App 身分。開始前，請依[建立第一個雲端與裝置](setup-cloud-device.zh-TW.md)及[設定裝置與 App 憑證](credential-setup.zh-TW.md)，完成註冊、啟用、授權與驗證資訊準備。

| 必備項目 | 取得方式 |
| --- | --- |
| 裝置 ID | 已註冊的測試裝置 ID；請將所有 `device-1` 一致替換為此 ID |
| 裝置與 App 的 token 端點 | 使用環境中已確認的 mTLS 來源位址；可能與一般 API 的來源位址不同 |
| MQTT 主機名稱與 TLS 連接埠 | 查閱環境連線設定，不能從 token 中繼資料推算 |
| 伺服器 CA 信任憑證包 | 使用環境提供的信任鏈 |
| 裝置憑證與私鑰 | 透過裝置註冊取得；憑證身分必須符合 `devid` |
| App 憑證與私鑰存取權 | 透過帳號登入，以及 App 在本機產生 CSR 的註冊流程取得 |
| `mqtt`, `iot_shadow` | 在產品或裝置的服務設定中啟用 |

Account Manager 的登入 token 與用作 MQTT 密碼的 Video Cloud 執行階段 token 不同。正式應用程式須將本機產生的私鑰保留在平台安全儲存區。Developer Console 可匯出的憑證包僅供本機或 staging 測試。本命令列教學假設你已取得經授權的測試 PEM 憑證包；正式 App 應透過平台金鑰提供者完成相同的 token 交換。

## 本機工具與環境設定

請安裝支援 `--aws-sigv4` 的 `curl`、`jq`，以及 Mosquitto 的 `mosquitto_pub` 與 `mosquitto_sub` 用戶端。範例使用 Bash 執行。所有範例都會驗證 TLS，不需要啟用不安全模式。

請在教學會使用的每個終端機中設定以下值：

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

請依憑證角色使用環境提供的實際 mTLS 來源位址。一般 HTTP API 或純 HTTP 連接埠轉送，無法建立用戶端憑證身分。

範例主機名稱不會解析到你的服務。請將主機名稱與憑證路徑替換為實際環境的值。8883 只是範例連接埠，並非所有環境的服務保證。

請將驗證資訊存放在儲存庫以外的私人暫存工作目錄：

```bash
umask 077
export TUTORIAL_DIR="$(mktemp -d)"
```

將相同的 `TUTORIAL_DIR` 值複製到其他終端機。不要啟用 shell 指令追蹤，也不要將 token 檔案附在報告中。請使用未執行其他工作的測試裝置；教學中的一般 MQTT 訊息與具名 Shadow 更新都會實際寫入資料。

## 開始前的確認

確認裝置已啟用、App 已獲得該裝置的存取權，且兩項功能都已啟用。依[身分驗證與存取控制](authentication.zh-TW.md)分別取得裝置與 App 的執行階段 token 檔案。成功取得 token 是第一項檢查；MQTT 連線與訂閱仍須分別驗證。

下一步：[交換 MQTT 訊息](mqtt-quickstart.zh-TW.md)。

架構說明：[驗證資訊的類型與用途](credential-setup.zh-TW.md)。
