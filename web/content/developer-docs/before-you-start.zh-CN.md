---
title: 开始之前
description: 准备一个测试装置、授权身份、端点和命令列工具。
category: Start here
keywords:
- 先决条件
- 终点
- TLS
- 凭证
- 设定
- prerequisites
- endpoint
- certificate
- setup
language: zh-CN
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 来源审查和本地测试；现场环境资格待定
---


# 开始之前

## 你需要什么

在同一装置和Brand Cloud上使用专用的测试装置和授权的应用程式身份。 跟随[建立第一个云端与装置](setup-cloud-device.zh-CN.md)与[设定装置与应用程式凭证](credential-setup.zh-CN.md)在开始之前完成注册、启动、授权和凭证获取。

|输入|如何获得它|
| --- | --- |
|装置ID|您注册的测试装置；更换`device-1`一致地|
|装置/应用程式令牌端点|环境已验证的mTLS来源；这些可能与普通API来源不同|
|MQTT主机名称和TLS埠|您的环境连线设定；不是从令牌元资料中推断出的|
|伺服器CA信任捆绑包|环境提供的信任链|
|装置证书和私钥|装置注册；证书身份必须匹配`devid` |
|应用程式证书和私钥访问|帐户登入和应用程式本地CSR注册|
| `mqtt`, `iot_shadow` |产品/装置服务配置|

帐户经理登入令牌不是用作MQTT密码的影片云执行时令牌。生产应用程式将其本地生成的私钥保留在平台安全储存中。可汇出开发者控制台捆绑包仅用于本地/试用测试。这些命令列教学假设有一个授权的测试PEM捆绑包；生产应用程式使用其平台金钥提供商执行相同的令牌交换。

## 本地工具和设定

安装`curl`与`--aws-sigv4`支援，`jq`，以及Mosquitto`mosquitto_pub`与`mosquitto_sub`客户端。用Bash进行示例。所有示例都使用TLS验证；不需要不安全的模式。

在教学中使用的每个终端中设定这些值：

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

使用每个证书角色的实际mTLS来源。普通的HTTP API或普通的HTTP埠转发无法建立客户端证书身份。

示例主机名称不会解析到您的服务。请将它们和证书路径替换为您环境的值。埠8883是一个示例，而不是通用服务保证。

将凭据储存在储存库外的私人临时工作目录中：

```bash
umask 077
export TUTORIAL_DIR="$(mktemp -d)"
```

复制相同的`TUTORIAL_DIR`值传输到其他终端。不要启用外壳跟踪或在报告中包含令牌档案。使用否则处于休眠状态的测试装置；其一般的MQTT教学讯息和命名Shadow更新是真正的写入。

## 准备检查

确认装置处于活动状态，该应用程式已授权该装置使用，并且两种功能都已启用。使用以下方法获取单独的装置和应用程式执行时令牌档案[身分验证与存取控制](authentication.zh-CN.md). 成功的令牌响应是第一个里程碑；成功的MQTT连线和订阅是独立的检查。

下一个：[交换一个MQTT讯息](mqtt-quickstart.zh-CN.md).

建筑：[凭证型别和目的地](credential-setup.zh-CN.md).
