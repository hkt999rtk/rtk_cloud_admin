---
title: 应用程序与设备端对端示例
description: 分别执行应用程序与设备客户端，确认 desired 与 reported 最后达成一致。

category: Tutorials
keywords:
- 模拟器
- 应用程序
- 设备
- 下载
- 状态同步
- simulator
- Python
- app
- device
- download
- desired
- reported
language: zh-CN
applies_to: RTK Cloud contracts 9b1ed887912e; Account Manager 54b37b9c407d; Video
  Cloud 30fbb9a26155; Admin bbaf62f7d6b5
last_verified: '2026-09-04'
verification: 已完成来源与 API 审查、自动化示例测试，并在注明处读回开发环境 Broker 配置；尚待完整实际环境接入验证。

---

# 应用程序与设备端对端示例

## 目标与前置条件

以两个独立验证的 MQTT 客户端，分别执行应用程序与模拟设备。应用程序要求开启电源，设备模拟执行变更并上报，应用程序再通过 GET 确认期望状态与上报状态一致。本示例是协议客户端，不能取代固件的硬件验证或设备 owner 传输协议。

先完成[云端与设备配置](setup-cloud-device.zh-CN.md)、[证书配置](credential-setup.zh-CN.md)与[令牌签发](authentication.zh-CN.md)。你需要仍有效、**彼此独立**的应用程序及设备运行时令牌文件、已启用的 `mqtt` 与 `iot_shadow`、获授权的测试设备、Python 3.10 以上版本，以及可取得指定版本依赖包的环境。请将凭证文件放在示例目录以外。

[开启时序图](assets/two-principal-demo.zh-CN.html)

## 1. 安装示例

[下载完整 Python 示例](assets/shadow-demo.zip)，解压缩至只有你能访问的工作目录。压缩档包含 `demo.py`、`recover.py`、`verify.py`、`requirements.txt` 与 `README.md`，不含凭证。

```bash
unzip shadow-demo.zip -d shadow-demo
cd shadow-demo
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python demo.py --help
```

依赖包固定为 `paho-mqtt==2.1.0`，示例使用 callback API 第 2 版与 MQTT 3.1.1。请从[事前准备](before-you-start.zh-CN.md)取得 endpoint、CA 与设备 ID。两个终端都需要相同的 `MQTT_HOST`、`MQTT_PORT`、`CA_FILE`、`DEVICE_ID`、`SHADOW_NAME` 与 `TUTORIAL_DIR`。请选择没有其他操作的测试设备，并使用专用的 `tutorial` 命名影子。

## 2. 启动模拟设备

```bash
python demo.py device --token-file "$TUTORIAL_DIR/device-token.json" --seconds 120
```

客户端等待 CONNECT 与 SUBACK 成功后，才 GET 影子。若影子不存在，会上报模拟电源初始状态 `off`。重新连接或启动时，会读取当前 desired 并应用支持的值。示例只接受 `power=on` 或 `power=off`；重复事件不会重做模拟硬件的状态转换，且只有应用变更后才会上报状态。

## 3. 在另一个终端执行应用程序

激活同一个虚拟环境，设置相同的环境变量，然后运行：

```bash
python demo.py app --token-file "$TUTORIAL_DIR/app-token.json" --power on --seconds 45
```

预期的应用程序输出：

```text
APP desired accepted; waiting for reported state
PASS: desired=reported=on
```

预期的设备输出包含：

```text
DEVICE ready: simulated power=off
DEVICE applied power=on
DEVICE reported accepted
```

初次 GET 时，可能就会应用先前已存在的 desired。因此不要要求两个程序的输出一定按固定顺序出现。只有更新被接受，且后续取得足够新的 GET 结果，显示 desired 与 reported 都等于要求的电源状态时，应用程序才会以状态 0 结束。单靠 PUBACK 不会显示 PASS。

## 4. 测试离线恢复与失败情况

停止设备程序，让应用程序要求相反状态，并在应用程序超时前重新启动设备。设备会 GET 当前 desired；示例不依赖重播离线期间的 delta。如果设备未在期限内恢复，应用程序会以非零状态结束，并指出无法确认状态是否一致。决定是否重送更新前，请先读取当前状态。

只在专用测试环境中，测试未启用 `iot_shadow` 的设备、未获授权的应用程序／设备配对，或已过期的测试令牌。依授权规则，这些情况都应被拒绝。当前审查过的服务流程，尚未完整验证缺少功能授权时的拒绝行为；请将此负向测试列为发布前必须通过的条件，不要视为已验证结果。若未获授权的请求意外成功，应上报授权缺陷，不可依赖此行为。拒绝可能发生在 TLS、CONNECT、SUBACK 或影子的 rejected 响应。示例遇到断线、格式错误的消息或接收队列已满时会结束；它未实现自动更新令牌或无上限的重连。

## 5. 结束测试并集成至产品

停止模拟器，依[影子删除步骤](shadow-interfaces.zh-CN.md)只移除教学状态。集成硬件时，将模拟赋值替换成真正的硬件操作与状态读回。若要用于长时间执行的产品，请加入 [MQTT 连接指南](mqtt-connection.zh-CN.md)与[集成实现示例](integration-recipes.zh-CN.md)所述、有次数与时间上限的恢复及更新机制。

下载客户端的验证记录与正式环境验证分开维护。本地自动化测试涵盖请求与响应对应、请求遭拒、过期读取、重复事件及超时处理；这些结果不能证明任意环境的凭证或服务权限正确。

架构说明：[应用程序、设备与测试工具架构](integration-test-kit.zh-CN.md)。
