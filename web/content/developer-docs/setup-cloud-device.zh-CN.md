---
title: 创建第一个云与设备
description: 创建产品、完成设备认领并验证激活结果，再请求
  运行时凭证。
category: Start here
keywords:
- 入门
- 产品
- 设备认领
- 预配
- 激活
- onboarding
- Product
- claim
- provision
- mqtt
- iot_shadow
language: zh-CN
applies_to: RTK Cloud contracts 9b1ed887912e; Account Manager 54b37b9c407d; Video
  Cloud 30fbb9a26155; Admin bbaf62f7d6b5
last_verified: '2026-09-04'
verification: 来源／API 审查与示例自动检查；标示处包含开发环境 Broker 配置读取记录。完整的实际环境入门流程仍待验证。
---

# 创建第一个云与设备

## 目标与准备工作

完成本流程后，你应有一条已启用的设备注册记录、对应的云端 `devid`、成功的预配结果，以及已获授权的应用用户。请使用具有出厂身份和有效 Claim Token 的专用测试设备，以及已验证且有权管理目标 Cloud／Product 的账号。从环境连接信息获取 Account Manager 的公开 HTTPS 源地址和 CA 证书包。

[打开首次设备配置时序图](assets/first-device.zh-CN.html)

## 1. 创建或选择 Brand Cloud 与产品

1. 登录 Connect+ 并打开 **My Clouds**。选择目标云；如果账号有创建权限，也可使用 **Create Brand Cloud** 创建。开始管理前，须先完成所有者激活流程。
2. 在该云中打开 **Products → Add Product**，填写 **Product Name**、**Product Model**，并选择适合设备的类别。类别用于对注册记录分类，不代表凭证的授权范围。
3. 选择对应 `mqtt` 的 **Device Telemetry**，并保存产品。
4. 请与项目运维人员协调，在经批准的产品或设备服务配置中加入 `iot_shadow`。**当前产品编辑器没有独立的 Shadow 复选框。**选择 Device Telemetry 不会启用 Shadow。规范定义的预配 API 接受 `iot_shadow`，但仍会检查服务使用权和策略。
5. 通过 **Members & Access**，在适当的产品范围内授权开发者。能看到产品或成功登录，不代表运行时能访问设备。消费者 APP 终端用户绑定属于另一套身份流程；控制台成员资格不等于 APP 终端用户绑定。

如果使用现有产品，请先预览服务变更的影响，并确认必要的重新预配已完成。不要修改令牌或扩大认领响应中的服务列表，以此绕过服务使用权限制。

## 2. 区分各种标识符

| 标识符 | 用途 |
| --- | --- |
| Brand Cloud／组织 ID | 指定 Account Manager 的组织范围；使用所选云返回的 ID，不可用显示名称代替 |
| 产品／设备项目配置 ID | 产品授权与设备配置 |
| 注册记录中的 `device.id` | Account Manager 设备 API 的路径参数 |
| `provision_input.video_cloud_devid` | 运行时令牌的 `devid`、MQTT 主题与 Shadow 的 `thingName` |
| 设备认领码（Claim Token） | 设备随附的持有证明，不是登录或运行时令牌 |

## 3. 通过 Account Manager 解析设备认领信息

以下是组织持有设备的开发者集成流程，不是另一套消费者 APP 认领 API。请按照[证书配置](credential-setup.zh-CN.md)完成账号登录，并将登录响应保存为 `$TUTORIAL_DIR/account-login.json`。

```bash
export ACCOUNT_BASE='https://accounts.example.test'
export ORG_ID='replace-with-selected-cloud-organization-id'
read -r -s -p 'Device Claim Token: ' CLAIM_TOKEN; printf '\n'
jq -n --arg claim "$CLAIM_TOKEN" \
  '{claim_token:$claim,device_name:"Developer test device"}' > "$TUTORIAL_DIR/claim-request.json"
unset CLAIM_TOKEN
curl --fail-with-body --silent --show-error --cacert "$CA_FILE" \
  -H "Authorization: Bearer $(jq -er '.tokens.access_token' "$TUTORIAL_DIR/account-login.json")" \
  -H 'Content-Type: application/json' --data-binary @"$TUTORIAL_DIR/claim-request.json" \
  "$ACCOUNT_BASE/v1/orgs/$ORG_ID/devices/claim/resolve" > "$TUTORIAL_DIR/claim.json"
export REGISTRY_DEVICE_ID="$(jq -er '.device.id' "$TUTORIAL_DIR/claim.json")"
export DEVICE_ID="$(jq -er '.provision_input.video_cloud_devid' "$TUTORIAL_DIR/claim.json")"
```

预期收到 HTTP 201，并包含 `claim_id`、`device` 和 `provision_input`。认领解析会创建或查找设备注册记录的绑定，但**不会**启动设备激活流程。请保留 `provision_input` 中返回的 `activity_id`、`clip_public_key` 以及已批准的服务列表；即使只测试 Shadow，也不要自行编造这些值。

## 4. 开始预配并检查结果

```bash
jq -e '.provision_input | .service_options | index("mqtt") != null and index("iot_shadow") != null' \
  "$TUTORIAL_DIR/claim.json"
# Continue only if both required capabilities are present.
jq '.provision_input' "$TUTORIAL_DIR/claim.json" > "$TUTORIAL_DIR/provision-request.json"
curl --fail-with-body --silent --show-error --cacert "$CA_FILE" \
  -H "Authorization: Bearer $(jq -er '.tokens.access_token' "$TUTORIAL_DIR/account-login.json")" \
  -H 'Content-Type: application/json' --data-binary @"$TUTORIAL_DIR/provision-request.json" \
  "$ACCOUNT_BASE/v1/orgs/$ORG_ID/devices/$REGISTRY_DEVICE_ID/provision" \
  > "$TUTORIAL_DIR/provision-result.json"
curl --fail-with-body --silent --show-error --cacert "$CA_FILE" \
  -H "Authorization: Bearer $(jq -er '.tokens.access_token' "$TUTORIAL_DIR/account-login.json")" \
  "$ACCOUNT_BASE/v1/orgs/$ORG_ID/devices/$REGISTRY_DEVICE_ID/provisioning" \
  > "$TUTORIAL_DIR/provisioning-state.json"
```

201 表示创建一条操作；200 则可能返回已有操作。两者都不能单独证明设备已激活。操作尚未完成时，请在设置的轮询上限内再次读取预配状态。检查 `operation.status`、`readiness.state`、`readiness.sources` 和 `video_metadata`；如果存在 `readiness.failure`，也须检查。遇到无法继续的失败状态时，请停止并记录操作 ID。请求结果不确定而需要重试时，保留相同操作标识，避免创建无关的重复操作。

## 5. 就绪检查与故障恢复

- 确认设备注册记录已启用，且对应预期的 `DEVICE_ID`。
- 确认预配成功，设备已激活且具备两项功能。
- 确认证书身份与该 `DEVICE_ID` 一致，且 App 用户有权访问。
- 分别签发 App 与设备令牌，再分别验证 CONNECT、SUBACK 与 Shadow GET。尚未创建的 Shadow，GET 在正常情况下可能返回 404。
- MQTT 教程中的连接没有实现服务的设备主连接（owner transport）协议，也不能据此认定 Fleet 在线状态指示应该改变。

如果认领码无效或已使用，请按照认领解析或所有权转移策略处理；反复调用预配 API 无法修复所有权。遇到 403 时，请确认云、产品授权范围与设备绑定。如果激活仍在等待中，应检查操作状态，不要替换设备凭证。如果缺少 `iot_shadow`，请返回产品与服务使用权配置步骤。

下一步：[配置设备与 App 证书](credential-setup.zh-CN.md)，再运行 [App 与设备集成示例](app-device-example.zh-CN.md)。

延伸阅读：[所有权与解绑生命周期](ownership-sharing.zh-CN.md)。

架构说明：[账号、出厂身份与运行时生命周期](device-presence.zh-CN.md)。
