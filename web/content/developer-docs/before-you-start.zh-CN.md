---
title: 开始之前
description: 准备测试设备、已授权身份、服务端点与命令行
  工具。
category: Start here
keywords:
- 准备工作
- 端点
- 证书
- 环境配置
- prerequisites
- endpoint
- TLS
- certificate
- setup
language: zh-CN
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 来源审查与本地测试；实际环境验证仍待完成
---

# 开始之前

## 准备工作

请使用专用测试设备，以及有权访问该设备和同一 Brand Cloud 的 App 身份。开始前，请按照[创建第一个云与设备](setup-cloud-device.zh-CN.md)和[配置设备与 App 证书](credential-setup.zh-CN.md)，完成注册、激活、授权和凭证准备。

| 必备项 | 获取方式 |
| --- | --- |
| 设备 ID | 已注册的测试设备 ID；请将所有 `device-1` 一致替换为此 ID |
| 设备与 App 的令牌端点 | 使用环境中已确认的 mTLS 源地址；可能与普通 API 的源地址不同 |
| MQTT 主机名与 TLS 端口 | 查阅环境连接配置，不能从令牌元数据推算 |
| 服务器 CA 信任证书包 | 使用环境提供的信任链 |
| 设备证书与私钥 | 通过设备注册获取；证书身份必须与 `devid` 一致 |
| App 证书与私钥访问权限 | 通过账号登录，以及 App 在本地生成 CSR 的注册流程获取 |
| `mqtt`, `iot_shadow` | 在产品或设备的服务配置中启用 |

Account Manager 的登录令牌与用作 MQTT 密码的 Video Cloud 运行时令牌不同。生产应用必须将本地生成的私钥保留在平台安全存储中。Developer Console 可导出的凭证包仅用于本地或 staging 测试。本命令行教程假设你已取得经授权的测试 PEM 凭证包；生产 App 应通过平台密钥提供程序完成相同的令牌交换。

## 本地工具与环境配置

请安装支持 `--aws-sigv4` 的 `curl`、`jq`，以及 Mosquitto 的 `mosquitto_pub` 和 `mosquitto_sub` 客户端。示例使用 Bash 执行。所有示例都会验证 TLS，无需启用不安全模式。

请在教程会使用的每个终端中设置以下值：

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

请按证书角色使用环境提供的实际 mTLS 源地址。普通 HTTP API 或纯 HTTP 端口转发，无法建立客户端证书身份。

示例主机名不会解析到你的服务。请将主机名和证书路径替换为实际环境的值。8883 只是示例端口，并非所有环境的服务保证。

请将凭证存放在代码仓库之外的私有临时工作目录中：

```bash
umask 077
export TUTORIAL_DIR="$(mktemp -d)"
```

将相同的 `TUTORIAL_DIR` 值复制到其他终端。不要启用 shell 命令跟踪，也不要将令牌文件附在报告中。请使用未执行其他任务的测试设备；教程中的普通 MQTT 消息和命名 Shadow 更新都会实际写入数据。

## 开始前的确认

确认设备已激活、App 已获得该设备的访问权限，且两项功能都已启用。按照[身份验证与访问控制](authentication.zh-CN.md)分别获取设备与 App 的运行时令牌文件。成功获取令牌是第一项检查；MQTT 连接与订阅仍须分别验证。

下一步：[交换 MQTT 消息](mqtt-quickstart.zh-CN.md)。

架构说明：[凭证的类型与用途](credential-setup.zh-CN.md)。
