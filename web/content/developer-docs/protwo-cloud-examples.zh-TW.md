---
title: PRO2 雲端範例
description: 建置、燒錄並測試獨立的 MQTT 與 H.264 範例。
category: Firmware
keywords: [PRO2, MQTT, H264, camera, firmware, UART, 攝影機, 韌體, 燒錄, 串列埠]
language: zh-TW
applies_to: AmebaPro2 SDK 9.6e
last_verified: 2026-09-07
verification: 原始碼與主機端驗證；實體開發板驗收仍待完成。
---
# PRO2 雲端範例

## 選擇測試方式

開啟 [PRO2 雲端範例](/console/chipset-sdk/pro2/cloud-examples)選擇版本。每個版本都包含原始碼、本離線指南、三個完整的非 TrustZone Flash 映像檔，以及對應的 SHA-256 校驗檔。版本資訊清單會標明確切的原始碼與 SDK 版本。

**網站提供的二進位檔是隔離測試版本。**其中的 Wi-Fi 預留值、自簽身分與保留的 `.test` 服務無法連接你的 Cloud。僅可用來檢查下載、映像檔傳輸與開發板啟動。使用測試設定時，反覆出現網路錯誤屬於預期行為。映像檔傳輸成功，不代表雲端連線或攝影機運作正常。

若要測試實際 Cloud，請從 Developer UI 下載自己的裝置憑證，並在本機重新建置。裝置憑證與觀看端或使用者的驗證資訊不同。這些範例未實作憑證簽發、線上編譯、音訊，或燒錄後的驗證資訊設定。

## 準備硬體與相依工具

請使用相容於 SDK 9.6e 的 AmebaPro2 開發板、穩定的開發板電源，以及符合開發板指定電壓的 USB UART。將轉接器 TX 接至開發板 RX、轉接器 RX 接至開發板 TX，並共接 GND。不要接入 RS-232 電壓，也不要假設 UART 轉接器能為開發板供電。請依開發板手冊確認 UART 與下載接腳。攝影機預設為 GC2053；使用其他感測器時，必須明確選取。

透過已授權的 SDK 發布管道取得原版 AmebaPro2 SDK 9.6e 與 RTK Ameba WebRTC SDK。本原始碼壓縮檔不包含原版 SDK。請在 `dependencies.json` 選擇 RTK 版本，並安裝 GCC 10.3.1/newlib 4.1.0（gcc-arm-none-eabi-10.3-2021.10）、Python 3、CMake、Ninja 與 OpenSSL。建置流程會檢查這些版本，並在建置前後計算原廠 SDK 的雜湊值。

請將各儲存庫放在不同目錄，並設定絕對路徑：

```sh
export RTK_AMEBA_SDK_ROOT=/absolute/path/to/sdk-ameba-v9.6e
export RTK_AMEBA_WEBRTC_ROOT=/absolute/path/to/rtk_ameba_webrtc
export RTK_ARM_TOOLCHAIN_BIN=/absolute/path/to/gcc-arm-none-eabi-10.3-2021.10/bin
mkdir -p local
cp config/device.example.json local/device.local.json
```

## 設定自己的 Cloud

設定 `wifi_ssid`、`wifi_password` 與 `wifi_security`（`wpa2-aes`、`open` 或 `provisioned`）。Provisioned 模式會等待外部管理的 Wi-Fi 連線；本應用程式不會自行設定或重新建立該連線。

依所選 Cloud 設定 `device_id`、`token_url`、`cloud_base_url`、`mqtt_broker_host` 與 `mqtt_broker_port`。請使用該環境的裝置 mTLS Token 端點，不是純 HTTP API 連接埠。將 `mqtt_command_topic`、`mqtt_presence_topic` 與 `mqtt_tenant_topic_prefix` 設為裝置獲授權的主題。不要混用不同環境或裝置 ID。

將 `device_certificate_chain_pem`、`device_private_key_pem`、`https_server_ca_pem` 與 `mqtt_server_ca_pem` 設為本機 PEM 檔案路徑。建置時會檢查格式、效期、身分與金鑰配對；執行時會驗證伺服器 CA 與主機名稱。進行 TLS 前，必須先透過 SNTP 取得正確時間。

**明文私鑰／憑證檔案與內嵌金鑰陣列，只能作為開發時的簡化方式。**正式私鑰必須佈建到 **PRO2 protected zone**。量產前，須將開發用驗證資訊整合改為透過 protected zone 簽章與存取；此版本尚未實作該整合。不要提交這些本機檔案，也不要發布含有真實私鑰的韌體映像檔。

## 原始碼導覽

`common/app.c` 啟動 FreeRTOS 工作程序，加入或等待 Wi-Fi、同步時間、執行所選範例，最後清理並於五秒後重試。`common/network.c` 管理明確設定的 Wi-Fi 連線；應用程式重試時，會保留由外部管理的 provisioned Wi-Fi 連線。

`common/mqtt_identity.c` 在 MQTT CONNECT 前更新雲端驗證資訊，並取得 Broker 身分資訊，不將 Token 寫入日誌。`common/video.c` 負責設定與輪詢外部 RTK 裝置／媒體服務。RTK SDK 提供既有協定實作；這些範例不另建協定分支。

`tools/build.py` 向原版 SDK 注入外部 CMake hook。`assets/test_video.c` 包含合成測試影片，不需要 SD 卡。應用程式行為可修改各範例的 `main.c`；裝置身分與端點則修改本機設定。

## MQTT

在解壓縮後的原始碼根目錄執行建置：

```sh
python3 tools/build.py mqtt --config local/device.local.json
```

`examples/mqtt/main.c` 建立 mTLS Token 提供者與 MQTTS 傳輸，訂閱命令，並於訂閱完成後發布線上狀態。此範例不連結 WebRTC 媒體引擎。請使用已授權的 Cloud 應用程式，訂閱裝置線上狀態主題，並向命令主題發布命令。透過 UART 位元組數日誌與應用程式訊息內容，確認雙方都收到資料。中斷並重新連接 Broker，驗證重新訂閱與新的線上狀態。不要將裝置驗證資訊當成觀看端驗證資訊。

## Webrtc-test-video

```sh
python3 tools/build.py webrtc_test_video --config local/device.local.json
```

`examples/webrtc_test_video/main.c` 傳送內建的 320×240、15 FPS、兩秒合成 H.264 影片。影格會按設定速率送出，循環播放時時間戳記持續遞增；每個影格都是帶有 SPS/PPS 的 IDR，因此可滿足下一個關鍵影格請求。`common/playback.h` 負責傳送節奏與時間戳記計算。

開啟已授權的 RTK Cloud 觀看端，使用相同裝置與環境。確認影片可連續循環播放多次，關閉觀看端後重新連線，再確認播放恢復。先測試直接連線模式。若要強制中繼，將 `force_relay` 設為 true 並重新建置，且檢查 relay candidate 的證據。TURN 驗證資訊與 URL 來自 Cloud ICE 設定。搭配對應伺服器設定測試 TURN/UDP 與 TURN/TCP；不支援 TURN/TLS。

## Webrtc-camera

```sh
python3 tools/build.py webrtc_camera --config local/device.local.json --sensor SENSOR_GC2053
```

`examples/webrtc_camera/main.c` 使用外部 MMFv2 攝影機／H.264 橋接層，以及設有容量上限的影格集區。預設影像為 1080p、15 FPS、2,097,152 bps。請選取 SDK 感測器標頭檔中適用於開發板的感測器；不支援的選項或容量會回報錯誤。

確認觀看端顯示持續變化的即時畫面。請求關鍵影格，關閉並重新開啟工作階段，再驗證串流恢復。清理時會先停止攝影機影格產生端，再銷毀裝置佇列與影格集區。請在實體硬體上反覆建立工作階段並長時間執行，觀察記憶體使用；主機／QEMU 測試不會模擬 MMF、感測器 DMA 或實體 Wi-Fi。

## 從 URL 或本機檔案燒錄

請使用支援 Web Serial 的桌面版 Chrome 或 Edge，透過 HTTPS 開啟頁面。關閉其他占用 USB UART 的程式。

使用網站映像檔時，選取 **Burn this example**，閱讀並接受發布條款後下載韌體。瀏覽器會先檢查檔案大小與 SHA-256，再允許燒錄。若先前 URL 已到期，重試會取得新 URL。CORS／網路錯誤或雜湊不符，必須先解決才能燒錄。

使用自行建置的版本時，開啟 [PRO2 韌體燒錄工具](/console/chipset-sdk/pro2/firmware-burner)，連接 UART，開啟韌體面板，再從 `output/` 選擇對應檔案：

```text
amebapro2_mqtt_flash_ntz.bin
amebapro2_webrtc_test_video_flash_ntz.bin
amebapro2_webrtc_camera_flash_ntz.bin
```

這些都是完整的非 TrustZone Flash 映像檔，寫入位址為 **0x0**。此完整映像檔流程不可選擇僅含應用程式的 `firmware_ntz.bin`。版本資訊清單會標示映像檔配置，單靠檔名無法確認相容性。寫入前，請比對畫面上的 SHA-256 與校驗檔。

開發板若有 BOOT 與 RESET 控制：按住 BOOT、按一下 RESET、放開 BOOT，再開始燒錄。若控制方式不同，請依開發板的下載模式說明操作。請保持燒錄驗證啟用。整片晶片抹除也會移除其他 Flash 內容，僅在確實需要時使用。驗證成功後，重設為正常開機，並以 115200 baud 觀察 UART。DTR/RTS 重設需要正確接線，否則請手動重設。

## 結果確認與失敗復原

完成真實環境設定的版本應輸出 `EXAMPLE_NETWORK_READY` 與 `EXAMPLE_READY kind=...`。這些標記本身不能證明 MQTT 已收到資料或影片已播放，還須檢查接收端應用程式。網路或時間同步失敗會觸發有次數上限的重試；請檢查 Wi-Fi 模式、DHCP、DNS 與 SNTP。TLS 失敗時，須檢查身分是否相符、CA、時間與端點。不要將私鑰或 Token 貼入診斷日誌。

UART 被占用時，關閉其他終端機。進入下載模式逾時時，重新執行 BOOT／RESET 步驟。燒錄中斷或驗證失敗後，讓開發板維持下載模式，並降低速度重試；不要將不完整映像檔視為可開機版本。URL 到期或校驗不符時，請重新下載檔案。

版本驗證報告分別記錄編譯器、主機、QEMU 與實體開發板的驗證證據。已知限制：使用 31 秒 Token 的兩個工作階段 QEMU 壓力測試，在重新訂閱時失敗；範例沿用現有的 300 秒 Token 請求。實體燒錄／開機、攝影機、Wi-Fi 復原與真實使用者 Cloud 存取，都仍需另行測試後才能確認。

## 重現本機驗證流程

```sh
python3 tools/test_local.py
cmake -S tests -B build/example-tests -G Ninja -DRTK_AMEBA_WEBRTC_ROOT="$RTK_AMEBA_WEBRTC_ROOT"
cmake --build build/example-tests --parallel 4
ctest --test-dir build/example-tests --output-on-failure
python3 tools/test_qemu.py direct
python3 tools/test_qemu.py udp
python3 tools/test_turn_tcp.py
```

本機測試另需 FFmpeg、ffprobe、主機 C/C++ 編譯器與 libcjson。QEMU／TURN 測試需要外部 RTK SDK 所列的主機／QEMU 必備工具；TCP 測試工具使用 Docker Coturn。請依 `docs/hardware-checklist.md` 記錄預期與實際結果，並將 `docs/validation.md` 一併保留為版本驗證證據。
