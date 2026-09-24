---
title: 端到端应用程式与装置范例
description: 执行独立的应用程式和装置客户端，并验证所需到报告的收敛。
category: Tutorials
keywords:
- 模仿者
- 蟒
- 应用程式
- 装置
- 下载
- 渴望的
- 报告的
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
verification: 源/API审查；自动样本检查；如注释所示，开发商代理服务配置读取。完整的现场入职资格正在等待。
---


# 端到端应用程式与装置范例

## 目标和先决条件

将一个应用程式和一个模拟装置作为两个独立的身份验证MQTT客户端执行。应用程式请求开机；装置应用模拟更改并报告它；应用程式透过GET检查收敛。此示例是一个协议客户端，不是取代韧体硬体验证或装置所有者传输协议的替代品。

完成[云/装置设定](setup-cloud-device.zh-CN.md), [凭证设定](credential-setup.zh-CN.md)，和[代币发行](authentication.zh-CN.md)。你需要电流**分开**应用程式/装置执行时令牌档案，`mqtt`与`iot_shadow`，一个授权的测试装置、Python 3.10+以及访问固定依赖项。将凭证档案放在示例目录之外。

[开启重新设计的序列图](assets/two-principal-demo.zh-CN.html)

## 1. 安装示例

[下载完整的Python示例](assets/shadow-demo.zip).将其提取到一个私人工作目录中；该存档包括`demo.py`, `recover.py`, `verify.py`, `requirements.txt`与`README.md`并且不包含凭据。

```bash
unzip shadow-demo.zip -d shadow-demo
cd shadow-demo
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python demo.py --help
```

固定依赖项是`paho-mqtt==2.1.0`。该示例使用其回拨API版本2和MQTT 3.1.1。从以下处获取端点、CA和装置ID[开始之前](before-you-start.zh-CN.md)；两个终端都需要相同的`MQTT_HOST`, `MQTT_PORT`, `CA_FILE`, `DEVICE_ID`, `SHADOW_NAME`与`TUTORIAL_DIR`。使用专用的名称Shadow`tutorial`在一个平时空闲的测试装置上。

## 2. 启动模拟装置

```bash
python demo.py device --token-file "$TUTORIAL_DIR/device-token.json" --seconds 120
```

客户端等待成功连线和SUBACK，然后获取影子。缺失的影子由报告初始模拟电源来处理`off`。重新连线/重新启动时，它会读取当前的预期状态并应用支援的值。它只接受`power=on`或者`power=off`；重复资料不会重复模拟的硬体过渡。它只有在应用更改后才报告状态。

## 3. 在另一个终端执行应用程式

启动相同的虚拟环境并汇出相同的设定，然后执行：

```bash
python demo.py app --token-file "$TUTORIAL_DIR/app-token.json" --power on --seconds 45
```

预期应用输出：

```text
APP desired accepted; waiting for reported state
PASS: desired=reported=on
```

预期装置输出包括：

```text
DEVICE ready: simulated power=off
DEVICE applied power=on
DEVICE reported accepted
```

以前存在的预期值可以在初始GET期间应用。不需要在两个流程中使用固定线订单。应用程式只有在更新被接受后，以及稍后的、足够新的GET显示预期值和报告值都等于请求的功率后，才会以状态0退出。仅使用PUBACK无法列印PASS。

## 4. 练习离线恢复和故障

停止装置流程，使用应用程式请求相反的状态，然后在应用程式的截止日期前重新启动装置。装置获取当前所需状态；该示例不依赖于离线差分的重播。如果在截止日期前没有装置返回，应用程式将以未知收敛超时退出非零状态。在决定是否重复突变之前，请阅读当前状态。

尝试一个没有的装置`iot_shadow`，只有在专用测试环境中才会发生未经授权的应用程式/装置配对或过期的测试令牌。所需的政策结果是拒绝。在经过审查的服务路径中，尚未合格执行「缺少能力强制执行」。将此负面测试记录为释出闸道器，而不是已证实的结果。意外成功的要求是需要报告的授权缺陷，而不是允许依赖该行为的许可。拒绝的确切层次可能有所不同：TLS、CONNECT、SUBACK 或一个被拒绝的影子响应。范例在断开连线、讯息格式错误或接收伫列满时退出；它不实施自动令牌更新或无限重连重试。

## 5.完成并适应

停止模拟器并使用[明确的影子删除步骤](shadow-interfaces.zh-CN.md)仅移除教学状态。对于硬体整合，请将模拟分配替换为实际操作和读取回馈。对于长时间执行的产品，请在中新增受限恢复和更新行为[MQTT 连线指南](mqtt-connection.zh-CN.md)与[整合实作范例](integration-recipes.zh-CN.md).

下载的客户端验证与生产合格性分开记录。本地自动测试涵盖响应相关性、拒绝请求、过期读取、重复事件和超时行为。这并不证实任意环境的凭据或权利。

建筑：[应用程式、装置和测试工具架构](integration-test-kit.zh-CN.md).
