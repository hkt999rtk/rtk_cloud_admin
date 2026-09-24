---
title: PRO2 雲端範例
description: 構建、燃燒和測試獨立的MQTT和H.264示例。
category: Firmware
keywords:
- PRO2
- MQTT
- H264
- 照相機
- 韌體中的程式）
- UART
- H264
- camera
- firmware
- UART
language: zh-TW
applies_to: AmebaPro2 SDK 9.6e
last_verified: 2026-09-07
verification: 來源和主機驗證；物理板接受待定。
---

# PRO2 雲端範例

## 選擇您的測試路徑

開放[PRO2 雲端範例](/console/chipset-sdk/pro2/cloud-examples)選擇一個版本。每個版本都有此離線指南的源程式、三個完整的非TrustZone快閃記憶體映像和SHA-256側載程式。版本清單確定了確切的源程式和SDK修訂版本。

**網站二進位制檔案是孤立的測試構建。**他們的Wi-Fi位元組，自簽身份和保留`.test`服務無法連線到您的雲端。僅使用它們來檢查下載、映像傳輸和板子啟動。它們可能會反覆報告網路錯誤；這是測試設定中預期的。成功傳輸映像並不能證明雲端連線或相機操作。

對於真正的雲測試，請從開發者介面下載您自己的裝置證書，然後在本地重新構建。裝置證書與檢視器/使用者憑據不同。這些示例不實現證書發行、線上編譯、音訊或後快閃記憶體憑據配置。

## 準備硬體和依賴項

使用與SDK 9.6e相容的AmebaPro2板、穩定的板電力和板上的USB UART，電壓為板上的說明所示。將介面卡TX連線到板RX，介面卡RX連線到板TX，並連線到共同的GND。不要連線RS-232電壓或假設UART介面卡可以為板供電。請使用板上的手冊確認UART/下載引腳。相機預設為GC2053；必須明確選擇不同的感測器。

透過您授權的SDK分發渠道獲取原始AmebaPro2 SDK 9.6e和RTK Ameba WebRTC SDK。原始SDK不包含在本源存檔中。選擇RTK修訂版本`dependencies.json`. 安裝GCC 10.3.1/newlib 4.1.0（gcc-arm-none-eabi-10.3-2021.10）、Python 3、CMake、Ninja和OpenSSL。構建檢查這些版本，並在構建前後對供應商SDK進行雜湊。

將儲存庫分開，並配置它們的絕對路徑：

```sh
export RTK_AMEBA_SDK_ROOT=/absolute/path/to/sdk-ameba-v9.6e
export RTK_AMEBA_WEBRTC_ROOT=/absolute/path/to/rtk_ameba_webrtc
export RTK_ARM_TOOLCHAIN_BIN=/absolute/path/to/gcc-arm-none-eabi-10.3-2021.10/bin
mkdir -p local
cp config/device.example.json local/device.local.json
```

## 配置您自己的雲

設定`wifi_ssid`, `wifi_password`與`wifi_security` (`wpa2-aes`, `open`或者`provisioned`）。配置模式等待外部管理的Wi-Fi關聯；此應用程式不會配置或重新連線該關聯本身。

設定`device_id`, `token_url`, `cloud_base_url`, `mqtt_broker_host`與`mqtt_broker_port`從您選擇的雲端使用。使用其裝置mTLS令牌端點，而不是普通的HTTP API埠。 一套`mqtt_command_topic`, `mqtt_presence_topic`與`mqtt_tenant_topic_prefix`到裝置的授權主題。不要混合環境或裝置ID。

設定`device_certificate_chain_pem`, `device_private_key_pem`, `https_server_ca_pem`與`mqtt_server_ca_pem`到您當地的PEM檔案。構建檢查格式、有效日期、身份和匹配金鑰；執行時驗證伺服器CA和主機名。在TLS之前需要有效的SNTP時間。

**純文字私鑰/證書檔案和嵌入式金鑰陣列僅用於開發快捷方式。**生產私鑰必須配置到**PRO2保護區**。在生產前，請將開發憑證整合替換為受保護區域簽名/訪問。此版本不實現該整合。切勿提交這些本地檔案或釋出包含您真實私鑰的韌體映像。

## 源程式碼概述

`common/app.c`啟動一個FreeRTOS工作者，加入/等待Wi-Fi，同步時間，執行所選的示例，然後在五秒後清理並重試。`common/network.c`擁有明確配置的Wi-Fi連線，但在應用程式重試期間保留外部管理的配置Wi-Fi。

`common/mqtt_identity.c`在MQTT連線前更新雲憑據，並在不記錄令牌的情況下提取代理服務身份。`common/video.c`配置和檢測外部RTK裝置/媒體服務。RTK SDK提供現有的協議實現；這些示例並沒有分叉它。

`tools/build.py`將外部CMake鉤子注入原始SDK中。`assets/test_video.c`包含合成影片。不需要SD卡。修改每個示例的`main.c`用於應用程式行為，並更改裝置身份和端點的本地配置。

## MQTT

從提取的源根構建：

```sh
python3 tools/build.py mqtt --config local/device.local.json
```

`examples/mqtt/main.c`建立mTLS令牌提供商和MQTTS傳輸，訂閱命令，並在訂閱後釋出存在狀態。它不會連結WebRTC媒體引擎。使用授權的雲應用程式訂閱裝置的存在主題，並向其命令主題釋出命令。使用UART位元組計數日誌和應用程式有效載荷驗證雙方收件。斷開/重新連線代理服務，並驗證重新訂閱和新的存在狀態。不要將裝置憑據用作檢視器憑據。

## Webrtc-測試影片

```sh
python3 tools/build.py webrtc_test_video --config local/device.local.json
```

`examples/webrtc_test_video/main.c`傳送內建的320×240、15 FPS、兩秒合成H.264剪輯。幀的節奏是連續的，時間戳在迴圈中保持連續；每個幀都是IDR，帶有SPS/PPS，滿足下一個關鍵幀請求。`common/playback.h`處理節奏/時間戳計算。

為同一裝置/環境開啟一個授權的RTK雲檢視器。確認剪輯在多個迴圈中重複播放，關閉檢視器，重新連線並確認影片恢復播放。先測試直接模式。 一套`force_relay`轉為真實並重建強制繼電器；驗證繼電器候選證據。TURN憑據/URL來自Cloud ICE配置。使用相應的伺服器配置測試TURN/UDP和TURN/TCP；不支援TURN/TLS。

## Webrtc攝像頭

```sh
python3 tools/build.py webrtc_camera --config local/device.local.json --sensor SENSOR_GC2053
```

`examples/webrtc_camera/main.c`使用外部MMFv2相機/H.264橋接器和有限幀池。預設影片為1080p，15 FPS，2,097,152 bps。選擇SDK感測器頭中為您的板定義的感測器；不受支援的選擇或容量報告錯誤。

確認觀看器顯示一個不斷變化的直播場景。請求關鍵幀，關閉並重新開啟會話，並驗證流媒體恢復。清理在銷毀裝置佇列和幀池之前停止攝像頭生產者。在重複會話和在硬體上長時間執行時檢查記憶體；主機/QEMU測試不模擬MMF、感測器DMA或物理Wi-Fi。

## 從URL或本地檔案燒錄

在HTTPS上使用桌面Chrome或Edge與Web序列連線。關閉其他持有USB UART的程式。

對於網站影象，請選擇**燒掉這個例子**，閱讀並接受釋出條款，然後下載韌體。瀏覽器在啟用燒錄之前會檢查其大小和SHA-256。如果之前的URL過期，則重試以獲取新的URL。在燒錄之前必須解決CORS/網路錯誤或雜湊值不匹配。

對於您自己的構建，請開啟[PRO2韌體燒錄器](/console/chipset-sdk/pro2/firmware-burner)，連線UART，開啟韌體面板，並從中選擇匹配的檔案`output/`:

```text
amebapro2_mqtt_flash_ntz.bin
amebapro2_webrtc_test_video_flash_ntz.bin
amebapro2_webrtc_camera_flash_ntz.bin
```

這些是完整的非信任區快閃記憶體映像，寫入於**0x0**。請勿選擇僅限應用程式`firmware_ntz.bin`對於此全圖流。明細檔識別影象佈局；僅檔名無法確定相容性。在寫入之前，請將顯示的SHA-256與後備車進行比較。

對於具有啟動和重置控制的板子：按住啟動鍵，按下一次重置鍵，釋放啟動鍵，然後開始燒錄。如果控制不同，請遵循板子的下載模式說明。保持驗證開啟。整個晶片的擦除也會刪除其他快閃記憶體內容；僅在故意需要時使用。成功驗證後，重置到正常啟動，並觀察115200位/秒的UART。DTR/RTS重置需要正確連線這些引腳；否則手動重置。

## 結果和恢復

真正的配置構建應該達到`EXAMPLE_NETWORK_READY`與`EXAMPLE_READY kind=...`.僅僅這些標記無法證明MQTT接收或影片播放：還要檢查接收應用程式。網路/時間故障會導致有限重試；檢查Wi-Fi模式、DHCP、DNS和SNTP。TLS故障需要匹配身份、CA、時間和端點檢查。切勿將私鑰或令牌貼上到診斷日誌中。

如果UART正在使用，請關閉另一個終端。如果下載模式超時，請重複BOOT/RESET序列。在中斷閃爍或驗證失敗後，請保持板塊處於下載模式，並以較低速度重試；不要將部分映像視為可引導。在URL過期或校驗和不匹配後，下載新的位元組。

釋出驗證報告區分了編譯器、主機、QEMU和物理板證據。已知限制：在重新訂閱過程中，帶有31秒令牌的兩次QEMU壓力執行失敗；示例使用現有的300秒令牌請求。物理快閃記憶體/引導、相機、Wi-Fi恢復和真正的使用者雲訪問仍然待定，直到單獨測試。

## 重現本地驗證

```sh
python3 tools/test_local.py
cmake -S tests -B build/example-tests -G Ninja -DRTK_AMEBA_WEBRTC_ROOT="$RTK_AMEBA_WEBRTC_ROOT"
cmake --build build/example-tests --parallel 4
ctest --test-dir build/example-tests --output-on-failure
python3 tools/test_qemu.py direct
python3 tools/test_qemu.py udp
python3 tools/test_turn_tcp.py
```

本地測試還需要FFmpeg、ffprobe、一個主機C/C++編譯器和libcjson。QEMU/TURN測試需要外部RTK SDK的主機/QEMU先決條件；TCP框架使用Docker Coturn。使用以下方法記錄預期和觀察到的結果`docs/hardware-checklist.md`，並保留`docs/validation.md`附上您的釋放證據。
