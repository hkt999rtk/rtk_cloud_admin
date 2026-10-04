---
title: 集成实现示例
description: 处理离线恢复、版本冲突与重复事件，并如实上报设备状态。

category: Build integrations
keywords:
- 离线
- 状态同步
- 重复事件
- 版本冲突
- 幂等性
- offline
- reconciliation
- duplicate
- conflict
- idempotency
language: zh-CN
applies_to: RTK Cloud contracts snapshot 9b1ed887912e; service snapshot 30fbb9a26155
last_verified: '2026-09-04'
verification: 已完成来源审查与本地测试；尚待实际环境验证
---

# 集成实现示例

## 启动或断线后重新同步状态

前置条件：有效的凭证、获授权的完整主题订阅，以及能读取真实硬件状态的固件。

[开启时序图](assets/shadow-offline.zh-CN.html)

1. 先完成连接与订阅，再读取状态。
2. GET 所使用的命名或未命名影子。404 表示状态不存在，不是传输失败。
3. 比较期望状态与实际硬件，只应用支持的配置。
4. 上报设备实际完成的状态，再确认 accepted 响应。
5. 依版本与事件类型处理通知。结果不确定或版本出现缺口时，重新读取状态。

可用[设备状态同步快速入门](shadow-quickstart.zh-CN.md)重现：停止监听程序，从应用程序将 desired 电源改为 `off`，重新启动监听程序，GET 当前状态，模拟应用 `off` 并上报。之后 GET 应显示 desired 与 reported 电源皆为 `off`。这个测试不需要假设系统会重播离线期间的 delta。

## 处理版本冲突

[开启时序图](assets/shadow-conflict.zh-CN.html)

先读取当前版本，再以同一版本送出两次更新。第一次应成功，第二次应返回 409。使用[接口指南](shadow-interfaces.zh-CN.md)中的 HTTP 辅助函数：

```bash
CURRENT_VERSION="$(shadow_http "$SHADOW_URL" | jq -er '.version')"
PATCH="$(jq -nc --argjson version "$CURRENT_VERSION" \
  '{state:{desired:{power:"on"}},version:$version,clientToken:"tutorial-conflict"}')"
shadow_http -X POST -H 'Content-Type: application/json' --data-binary "$PATCH" "$SHADOW_URL"
# Deliberately stale: expect HTTP 409 and a nonzero curl exit status.
shadow_http -X POST -H 'Content-Type: application/json' --data-binary "$PATCH" "$SHADOW_URL"
```

收到 409 后，GET 最新状态，判断原本的操作意图是否仍适用，再依最新版本创建新的部分更新。非幂等操作不可直接自动重试。若其他写入方已刻意修改电源，盲目重送旧 desired 值可能会覆盖对方的操作。

## 处理重复与同版本事件

针对每个设备／影子生命周期，记录已处理的最高状态版本。忽略较旧的状态通知，并避免重复应用已处理的事件。不要跨影子共用同一个全局版本，也不要丢弃所有等于最高版本的事件：accepted、delta 与 documents 可能描述同一次异动，但有不同用途。

请求与响应的对应应与设备动作分开处理。`power=on` 这类配置应以幂等方式应用，确保重复消息不会造成一次性硬件操作再次执行。`clientToken` 不是服务器端的幂等性密钥。若影子删除后隔了较长时间才重建，请依明确的生命周期信息与新的 GET 结果创建基准，不要直接应用任意旧事件。

## 选择状态模型或命令协议

持续有效的目标，例如预期电源或配置，适合使用影子。单次给药、只解锁一次等动作，则需要命令协议，自行定义动作识别码、确认响应与安全规则；可能重复应用的 desired 状态不足以处理这类操作。

操作超时时，请区分「结果未知」与「已知失败」。重新发出更新前，先 GET 状态。配置等待上限并上报诊断信息，不要无限等待可能根本不会出现的 delta。

下一步：[疑难排解与兼容性](troubleshooting.zh-CN.md)。
