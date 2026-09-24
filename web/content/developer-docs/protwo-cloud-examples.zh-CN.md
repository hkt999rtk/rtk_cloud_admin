---
title: PRO2 云端范例
description: 构建、燃烧和测试独立的MQTT和H.264示例。
category: Firmware
keywords:
- PRO2
- MQTT
- H264
- 照相机
- 韧体中的程式）
- UART
- H264
- camera
- firmware
- UART
language: zh-CN
applies_to: AmebaPro2 SDK 9.6e
last_verified: 2026-09-07
verification: 来源和主机验证；物理板接受待定。
---

# PRO2 云端范例

## 选择您的测试路径

开放[PRO2 云端范例](/console/chipset-sdk/pro2/cloud-examples)选择一个版本。每个版本都有此离线指南的源程式、三个完整的非TrustZone快闪记忆体映像和SHA-256侧载程式。版本清单确定了确切的源程式和SDK修订版本。

**网站二进位制档案是孤立的测试构建。**他们的Wi-Fi位元组，自签身份和保留`.test`服务无法连线到您的云端。仅使用它们来检查下载、映像传输和板子启动。它们可能会反复报告网路错误；这是测试设定中预期的。成功传输映像并不能证明云端连线或相机操作。

对于真正的云测试，请从开发者介面下载您自己的装置证书，然后在本地重新构建。装置证书与检视器/使用者凭据不同。这些示例不实现证书发行、线上编译、音讯或后快闪记忆体凭据配置。

## 准备硬体和依赖项

使用与SDK 9.6e相容的AmebaPro2板、稳定的板电力和板上的USB UART，电压为板上的说明所示。将介面卡TX连线到板RX，介面卡RX连线到板TX，并连线到共同的GND。不要连线RS-232电压或假设UART介面卡可以为板供电。请使用板上的手册确认UART/下载引脚。相机预设为GC2053；必须明确选择不同的感测器。

透过您授权的SDK分发渠道获取原始AmebaPro2 SDK 9.6e和RTK Ameba WebRTC SDK。原始SDK不包含在本源存档中。选择RTK修订版本`dependencies.json`. 安装GCC 10.3.1/newlib 4.1.0（gcc-arm-none-eabi-10.3-2021.10）、Python 3、CMake、Ninja和OpenSSL。构建检查这些版本，并在构建前后对供应商SDK进行杂凑。

将储存库分开，并配置它们的绝对路径：

```sh
export RTK_AMEBA_SDK_ROOT=/absolute/path/to/sdk-ameba-v9.6e
export RTK_AMEBA_WEBRTC_ROOT=/absolute/path/to/rtk_ameba_webrtc
export RTK_ARM_TOOLCHAIN_BIN=/absolute/path/to/gcc-arm-none-eabi-10.3-2021.10/bin
mkdir -p local
cp config/device.example.json local/device.local.json
```

## 配置您自己的云

设定`wifi_ssid`, `wifi_password`与`wifi_security` (`wpa2-aes`, `open`或者`provisioned`）。配置模式等待外部管理的Wi-Fi关联；此应用程式不会配置或重新连线该关联本身。

设定`device_id`, `token_url`, `cloud_base_url`, `mqtt_broker_host`与`mqtt_broker_port`从您选择的云端使用。使用其装置mTLS令牌端点，而不是普通的HTTP API埠。 一套`mqtt_command_topic`, `mqtt_presence_topic`与`mqtt_tenant_topic_prefix`到装置的授权主题。不要混合环境或装置ID。

设定`device_certificate_chain_pem`, `device_private_key_pem`, `https_server_ca_pem`与`mqtt_server_ca_pem`到您当地的PEM档案。构建检查格式、有效日期、身份和匹配金钥；执行时验证伺服器CA和主机名。在TLS之前需要有效的SNTP时间。

**纯文字私钥/证书档案和嵌入式金钥阵列仅用于开发快捷方式。**生产私钥必须配置到**PRO2保护区**。在生产前，请将开发凭证整合替换为受保护区域签名/访问。此版本不实现该整合。切勿提交这些本地档案或释出包含您真实私钥的韧体映像。

## 源程式码概述

`common/app.c`启动一个FreeRTOS工作者，加入/等待Wi-Fi，同步时间，执行所选的示例，然后在五秒后清理并重试。`common/network.c`拥有明确配置的Wi-Fi连线，但在应用程式重试期间保留外部管理的配置Wi-Fi。

`common/mqtt_identity.c`在MQTT连线前更新云凭据，并在不记录令牌的情况下提取代理服务身份。`common/video.c`配置和检测外部RTK装置/媒体服务。RTK SDK提供现有的协议实现；这些示例并没有分叉它。

`tools/build.py`将外部CMake钩子注入原始SDK中。`assets/test_video.c`包含合成影片。不需要SD卡。修改每个示例的`main.c`用于应用程式行为，并更改装置身份和端点的本地配置。

## MQTT

从提取的源根构建：

```sh
python3 tools/build.py mqtt --config local/device.local.json
```

`examples/mqtt/main.c`建立mTLS令牌提供商和MQTTS传输，订阅命令，并在订阅后释出存在状态。它不会连结WebRTC媒体引擎。使用授权的云应用程式订阅装置的存在主题，并向其命令主题释出命令。使用UART位元组计数日志和应用程式有效载荷验证双方收件。断开/重新连线代理服务，并验证重新订阅和新的存在状态。不要将装置凭据用作检视器凭据。

## Webrtc-测试影片

```sh
python3 tools/build.py webrtc_test_video --config local/device.local.json
```

`examples/webrtc_test_video/main.c`传送内建的320×240、15 FPS、两秒合成H.264剪辑。帧的节奏是连续的，时间戳在回圈中保持连续；每个帧都是IDR，带有SPS/PPS，满足下一个关键帧请求。`common/playback.h`处理节奏/时间戳计算。

为同一装置/环境开启一个授权的RTK云检视器。确认剪辑在多个回圈中重复播放，关闭检视器，重新连线并确认影片恢复播放。先测试直接模式。 一套`force_relay`转为真实并重建强制继电器；验证继电器候选证据。TURN凭据/URL来自Cloud ICE配置。使用相应的伺服器配置测试TURN/UDP和TURN/TCP；不支援TURN/TLS。

## Webrtc摄像头

```sh
python3 tools/build.py webrtc_camera --config local/device.local.json --sensor SENSOR_GC2053
```

`examples/webrtc_camera/main.c`使用外部MMFv2相机/H.264桥接器和有限帧池。预设影片为1080p，15 FPS，2,097,152 bps。选择SDK感测器头中为您的板定义的感测器；不受支援的选择或容量报告错误。

确认观看器显示一个不断变化的直播场景。请求关键帧，关闭并重新开启会话，并验证流媒体恢复。清理在销毁装置伫列和帧池之前停止摄像头生产者。在重复会话和在硬体上长时间执行时检查记忆体；主机/QEMU测试不模拟MMF、感测器DMA或物理Wi-Fi。

## 从URL或本地档案烧录

在HTTPS上使用桌面Chrome或Edge与Web序列连线。关闭其他持有USB UART的程式。

对于网站影象，请选择**烧掉这个例子**，阅读并接受释出条款，然后下载韧体。浏览器在启用烧录之前会检查其大小和SHA-256。如果之前的URL过期，则重试以获取新的URL。在烧录之前必须解决CORS/网路错误或杂凑值不匹配。

对于您自己的构建，请开启[PRO2韧体烧录器](/console/chipset-sdk/pro2/firmware-burner)，连线UART，开启韧体面板，并从中选择匹配的档案`output/`:

```text
amebapro2_mqtt_flash_ntz.bin
amebapro2_webrtc_test_video_flash_ntz.bin
amebapro2_webrtc_camera_flash_ntz.bin
```

这些是完整的非信任区快闪记忆体映像，写入于**0x0**。请勿选择仅限应用程式`firmware_ntz.bin`对于此全图流。明细档识别影象布局；仅档名无法确定相容性。在写入之前，请将显示的SHA-256与后备车进行比较。

对于具有启动和重置控制的板子：按住启动键，按下一次重置键，释放启动键，然后开始烧录。如果控制不同，请遵循板子的下载模式说明。保持验证开启。整个晶片的擦除也会删除其他快闪记忆体内容；仅在故意需要时使用。成功验证后，重置到正常启动，并观察115200位/秒的UART。DTR/RTS重置需要正确连线这些引脚；否则手动重置。

## 结果和恢复

真正的配置构建应该达到`EXAMPLE_NETWORK_READY`与`EXAMPLE_READY kind=...`.仅仅这些标记无法证明MQTT接收或影片播放：还要检查接收应用程式。网路/时间故障会导致有限重试；检查Wi-Fi模式、DHCP、DNS和SNTP。TLS故障需要匹配身份、CA、时间和端点检查。切勿将私钥或令牌贴上到诊断日志中。

如果UART正在使用，请关闭另一个终端。如果下载模式超时，请重复BOOT/RESET序列。在中断闪烁或验证失败后，请保持板块处于下载模式，并以较低速度重试；不要将部分映像视为可引导。在URL过期或校验和不匹配后，下载新的位元组。

释出验证报告区分了编译器、主机、QEMU和物理板证据。已知限制：在重新订阅过程中，带有31秒令牌的两次QEMU压力执行失败；示例使用现有的300秒令牌请求。物理快闪记忆体/引导、相机、Wi-Fi恢复和真正的使用者云访问仍然待定，直到单独测试。

## 重现本地验证

```sh
python3 tools/test_local.py
cmake -S tests -B build/example-tests -G Ninja -DRTK_AMEBA_WEBRTC_ROOT="$RTK_AMEBA_WEBRTC_ROOT"
cmake --build build/example-tests --parallel 4
ctest --test-dir build/example-tests --output-on-failure
python3 tools/test_qemu.py direct
python3 tools/test_qemu.py udp
python3 tools/test_turn_tcp.py
```

本地测试还需要FFmpeg、ffprobe、一个主机C/C++编译器和libcjson。QEMU/TURN测试需要外部RTK SDK的主机/QEMU先决条件；TCP框架使用Docker Coturn。使用以下方法记录预期和观察到的结果`docs/hardware-checklist.md`，并保留`docs/validation.md`附上您的释放证据。
