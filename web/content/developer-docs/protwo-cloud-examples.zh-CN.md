---
title: PRO2 云端示例
description: 构建、烧录并测试独立的 MQTT 与 H.264 示例。
category: Firmware
keywords: [PRO2, MQTT, H264, camera, firmware, UART, 摄像头, 固件, 烧录, 串口]
language: zh-CN
applies_to: AmebaPro2 SDK 9.6e
last_verified: 2026-09-07
verification: 源码与主机端验证；实体开发板验收仍待完成。
---
# PRO2 云端示例

## 选择测试方式

打开 [PRO2 云端示例](/console/chipset-sdk/pro2/cloud-examples)选择版本。每个版本都包含源码、本离线指南、三个完整的非 TrustZone Flash 镜像，以及对应的 SHA-256 校验文件。版本清单会标明准确的源码与 SDK 版本。

**网站提供的二进制文件是隔离测试版本。**其中的 Wi-Fi 占位值、自签名身份与保留的 `.test` 服务无法连接你的 Cloud。仅可用于检查下载、镜像传输与开发板启动。使用测试配置时，反复出现网络错误属于预期行为。镜像传输成功，不代表云端连接或摄像头运行正常。

要测试实际 Cloud，请从 Developer UI 下载自己的设备证书，并在本地重新构建。设备证书与观看端或用户凭证不同。这些示例未实现证书签发、在线编译、音频，或烧录后的凭证配置。

## 准备硬件与依赖工具

请使用兼容 SDK 9.6e 的 AmebaPro2 开发板、稳定的开发板电源，以及符合开发板指定电压的 USB UART。将适配器 TX 接至开发板 RX、适配器 RX 接至开发板 TX，并共接 GND。不要接入 RS-232 电压，也不要假设 UART 适配器能为开发板供电。请按开发板手册确认 UART 与下载引脚。摄像头默认为 GC2053；使用其他传感器时，必须明确选择。

通过已授权的 SDK 发布渠道获取原版 AmebaPro2 SDK 9.6e 与 RTK Ameba WebRTC SDK。本源码压缩包不包含原版 SDK。请在 `dependencies.json` 选择 RTK 版本，并安装 GCC 10.3.1/newlib 4.1.0（gcc-arm-none-eabi-10.3-2021.10）、Python 3、CMake、Ninja 和 OpenSSL。构建流程会检查这些版本，并在构建前后计算厂商 SDK 的哈希值。

请将各代码仓库放在不同目录，并配置绝对路径：

```sh
export RTK_AMEBA_SDK_ROOT=/absolute/path/to/sdk-ameba-v9.6e
export RTK_AMEBA_WEBRTC_ROOT=/absolute/path/to/rtk_ameba_webrtc
export RTK_ARM_TOOLCHAIN_BIN=/absolute/path/to/gcc-arm-none-eabi-10.3-2021.10/bin
mkdir -p local
cp config/device.example.json local/device.local.json
```

## 配置自己的 Cloud

配置 `wifi_ssid`、`wifi_password` 和 `wifi_security`（`wpa2-aes`、`open` 或 `provisioned`）。Provisioned 模式会等待外部管理的 Wi-Fi 连接；本应用不会自行配置或重新建立该连接。

根据所选 Cloud 配置 `device_id`、`token_url`、`cloud_base_url`、`mqtt_broker_host` 和 `mqtt_broker_port`。请使用该环境的设备 mTLS Token 端点，不是纯 HTTP API 端口。将 `mqtt_command_topic`、`mqtt_presence_topic` 和 `mqtt_tenant_topic_prefix` 设为设备获授权的主题。不要混用不同环境或设备 ID。

将 `device_certificate_chain_pem`、`device_private_key_pem`、`https_server_ca_pem` 和 `mqtt_server_ca_pem` 设为本地 PEM 文件路径。构建时会检查格式、有效期、身份与密钥配对；运行时会验证服务器 CA 与主机名。进行 TLS 前，必须先通过 SNTP 获取正确时间。

**明文私钥／证书文件与内嵌密钥数组，仅可作为开发时的简化方式。**生产私钥必须预配到 **PRO2 protected zone**。量产前，须将开发用凭证集成改为通过 protected zone 签名与访问；此版本尚未实现该集成。不要提交这些本地文件，也不要发布包含真实私钥的固件镜像。

## 源码导览

`common/app.c` 启动 FreeRTOS 工作进程，连接或等待 Wi-Fi、同步时间、运行所选示例，最后清理并在五秒后重试。`common/network.c` 管理明确配置的 Wi-Fi 连接；应用重试时，会保留由外部管理的 provisioned Wi-Fi 连接。

`common/mqtt_identity.c` 在 MQTT CONNECT 前更新云端凭证，并获取 Broker 身份信息，不将 Token 写入日志。`common/video.c` 负责配置与轮询外部 RTK 设备／媒体服务。RTK SDK 提供现有协议实现；这些示例不另建协议分支。

`tools/build.py` 向原版 SDK 注入外部 CMake hook。`assets/test_video.c` 包含合成测试视频，无需 SD 卡。应用行为可修改各示例的 `main.c`；设备身份与端点则修改本地配置。

## MQTT

在解压后的源码根目录执行构建：

```sh
python3 tools/build.py mqtt --config local/device.local.json
```

`examples/mqtt/main.c` 创建 mTLS Token 提供程序与 MQTTS 传输，订阅命令，并在订阅完成后发布在线状态。此示例不链接 WebRTC 媒体引擎。请使用已授权的 Cloud 应用，订阅设备在线状态主题，并向命令主题发布命令。通过 UART 字节数日志与应用消息内容，确认双方都收到数据。断开并重新连接 Broker，验证重新订阅与新的在线状态。不要将设备凭证当作观看端凭证。

## Webrtc-test-video

```sh
python3 tools/build.py webrtc_test_video --config local/device.local.json
```

`examples/webrtc_test_video/main.c` 发送内置的 320×240、15 FPS、两秒合成 H.264 视频。帧会按配置速率发送，循环播放时时间戳持续递增；每帧都是带有 SPS/PPS 的 IDR，因此可满足下一个关键帧请求。`common/playback.h` 负责发送节奏与时间戳计算。

打开已授权的 RTK Cloud 观看端，使用相同设备与环境。确认视频可连续循环播放多次，关闭观看端后重新连接，再确认播放恢复。先测试直连模式。要强制中继，将 `force_relay` 设为 true 并重新构建，且检查 relay candidate 的证据。TURN 凭证与 URL 来自 Cloud ICE 配置。结合对应服务器配置测试 TURN/UDP 与 TURN/TCP；不支持 TURN/TLS。

## Webrtc-camera

```sh
python3 tools/build.py webrtc_camera --config local/device.local.json --sensor SENSOR_GC2053
```

`examples/webrtc_camera/main.c` 使用外部 MMFv2 摄像头／H.264 桥接层，以及设有容量上限的帧池。默认视频为 1080p、15 FPS、2,097,152 bps。请选择 SDK 传感器头文件中适用于开发板的传感器；不支持的选项或容量会报告错误。

确认观看端显示持续变化的实时画面。请求关键帧，关闭并重新打开会话，再验证流恢复。清理时会先停止摄像头帧生产端，再销毁设备队列与帧池。请在实体硬件上反复建立会话并长时间运行，观察内存使用；主机／QEMU 测试不会模拟 MMF、传感器 DMA 或实体 Wi-Fi。

## 从 URL 或本地文件烧录

请使用支持 Web Serial 的桌面版 Chrome 或 Edge，通过 HTTPS 打开页面。关闭其他占用 USB UART 的程序。

使用网站镜像时，选择 **Burn this example**，阅读并接受发布条款后下载固件。浏览器会先检查文件大小与 SHA-256，再允许烧录。如果此前 URL 已过期，重试会获取新 URL。CORS／网络错误或哈希不符，必须先解决才能烧录。

使用自行构建的版本时，打开 [PRO2 固件烧录工具](/console/chipset-sdk/pro2/firmware-burner)，连接 UART，打开固件面板，再从 `output/` 选择对应文件：

```text
amebapro2_mqtt_flash_ntz.bin
amebapro2_webrtc_test_video_flash_ntz.bin
amebapro2_webrtc_camera_flash_ntz.bin
```

这些都是完整的非 TrustZone Flash 镜像，写入地址为 **0x0**。此完整镜像流程不可选择仅含应用的 `firmware_ntz.bin`。版本清单会标明镜像布局，仅凭文件名无法确认兼容性。写入前，请比对界面上的 SHA-256 与校验文件。

开发板如果有 BOOT 与 RESET 控制：按住 BOOT、按一下 RESET、松开 BOOT，再开始烧录。如果控制方式不同，请按开发板的下载模式说明操作。请保持烧录校验启用。整片芯片擦除也会移除其他 Flash 内容，仅在确实需要时使用。校验成功后，复位为正常启动，并以 115200 baud 观察 UART。DTR/RTS 复位需要正确接线，否则请手动复位。

## 结果确认与故障恢复

完成真实环境配置的版本应输出 `EXAMPLE_NETWORK_READY` 和 `EXAMPLE_READY kind=...`。这些标记本身不能证明 MQTT 已收到数据或视频已播放，还须检查接收端应用。网络或时间同步失败会触发有次数上限的重试；请检查 Wi-Fi 模式、DHCP、DNS 和 SNTP。TLS 失败时，须检查身份是否匹配、CA、时间与端点。不要将私钥或 Token 粘贴到诊断日志中。

UART 被占用时，关闭其他终端。进入下载模式超时时，重新执行 BOOT／RESET 步骤。烧录中断或校验失败后，让开发板保持下载模式，并降低速度重试；不要将不完整镜像视为可启动版本。URL 过期或校验不符时，请重新下载文件。

版本验证报告分别记录编译器、主机、QEMU 与实体开发板的验证证据。已知限制：使用 31 秒 Token 的两个会话 QEMU 压力测试，在重新订阅时失败；示例沿用现有的 300 秒 Token 请求。实体烧录／启动、摄像头、Wi-Fi 恢复与真实用户 Cloud 访问，都仍需单独测试后才能确认。

## 复现本地验证流程

```sh
python3 tools/test_local.py
cmake -S tests -B build/example-tests -G Ninja -DRTK_AMEBA_WEBRTC_ROOT="$RTK_AMEBA_WEBRTC_ROOT"
cmake --build build/example-tests --parallel 4
ctest --test-dir build/example-tests --output-on-failure
python3 tools/test_qemu.py direct
python3 tools/test_qemu.py udp
python3 tools/test_turn_tcp.py
```

本地测试另需 FFmpeg、ffprobe、主机 C/C++ 编译器与 libcjson。QEMU／TURN 测试需要外部 RTK SDK 所列的主机／QEMU 必备工具；TCP 测试工具使用 Docker Coturn。请按 `docs/hardware-checklist.md` 记录预期与实际结果，并将 `docs/validation.md` 一并保留为版本验证证据。
