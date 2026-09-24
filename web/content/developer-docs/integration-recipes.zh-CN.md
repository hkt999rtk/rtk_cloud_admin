---
title: 整合实作范例
description: 从离线期间恢复，解决冲突，并保持报告的状态真实。
category: Build integrations
keywords:
- 离线的
- 和解
- 复制的
- 冲突
- 同值性
- offline
- reconciliation
- duplicate
- conflict
- idempotency
language: zh-CN
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 来源审查和本地测试；现场环境资格待定
---


# 整合实作范例

## 启动或断开连线后进行对账

先决条件：当前凭证、授权的精确订阅以及能够读取实际硬体状态的韧体。

[开启重新设计的序列图](assets/shadow-offline.zh-CN.html)

1. 在阅读状态之前，请连线并订阅。
2. 获取您使用的命名或未命名的影子。将404视为丢失状态，而不是传输失败。
3. 将所需状态与实际硬体进行比较。仅应用受支援的设定。
4. 报告装置实际应用了什么，然后确认接受的回应。
5. 使用版本和事件型别处理通知。在不确定性或差距时重新阅读。

用这个复制这个[影子快速入门](shadow-quickstart.zh-CN.md)：停止观察器，将应用程式所需的功率更改为`off`，重新启动观察者，获取当前状态，模拟应用`off`，并报告它。然后GET应该显示所需和报告的功率`off`。该测试在不假设离线差分重播的情况下成功。

## 处理版本冲突

[开启重新设计的序列图](assets/shadow-conflict.zh-CN.html)

读取当前版本，并传送两个具有相同版本的更新。第一个必须成功，第二个必须返回409。对于来自的HTTP助手[介面指南](shadow-interfaces.zh-CN.md):

```bash
CURRENT_VERSION="$(shadow_http "$SHADOW_URL" | jq -er '.version')"
PATCH="$(jq -nc --argjson version "$CURRENT_VERSION" \
  '{state:{desired:{power:"on"}},version:$version,clientToken:"tutorial-conflict"}')"
shadow_http -X POST -H 'Content-Type: application/json' --data-binary "$PATCH" "$SHADOW_URL"
# Deliberately stale: expect HTTP 409 and a nonzero curl exit status.
shadow_http -X POST -H 'Content-Type: application/json' --data-binary "$PATCH" "$SHADOW_URL"
```

在409之后，获取并决定原始意图是否仍然适用。根据最新版本构建新的补丁程式。不要自动重试非同构操作。如果另一个写入者故意更改电源，盲目重复旧的预期值可能会撤销该工作。

## 处理重复和相同版本的事件

保留每个装置/影子生命周期的最高处理状态版本。忽略旧状态通知，并重复消除已应用的事件。不要在影子中使用一个全域性版本。不要丢弃每个等于最高版本的事件：接受、差异和档案可以描述相同的突变，并为不同的消费者提供服务。

将处理请求与装置操作分开相关联。应用设定，例如`power=on`无效性，因此重复交付不能重复一次性的物理操作。`clientToken`不是伺服器无效键。在长时间储存的删除/重新建立后，使用明确的生命周期知识和新的GET来建立新基线，而不是静默地应用任意旧事件。

## 选择状态或命令

使用Shadow来实现持久目标，例如所需的功率或配置。一次性操作，如分配剂量或解锁一次，需要具有自身操作身份、确认和安全规则的命令协议；可重播的所需状态是不够的。

当操作超时时，将未知结果与已知故障区分开来。在释出替换突变之前，使用GET状态。使用有限等待并显示诊断程式，而不是永远回圈等待可能不存在的差异。

下一个：[疑难排解与相容性](troubleshooting.zh-CN.md).
