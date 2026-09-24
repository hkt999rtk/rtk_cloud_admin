---
title: 建立第一个云端与装置
description: 在请求执行时凭据之前，请建立产品、解决装置索赔并验证启动。
category: Start here
keywords:
- 入职培训
- 产品
- 索赔
- 供应
- 子
- 物联网_影子
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
verification: 源/API审查；自动样本检查；如注释所示，开发商代理服务配置读取。完整的现场入职资格正在等待。
---


# 建立第一个云端与装置

## 目标和先决条件

最后使用一个启用的登入档装置，其对映的云`devid`，一个成功的配置结果和一个授权的应用程式使用者。使用带有出厂身份和有效索赔令牌、经过验证的帐户和管理目标云/产品的许可权的专用测试装置。从环境的连线递接中获取帐户管理器公共HTTPS来源和CA捆绑包。

[开启重新设计的序列图](assets/first-device.zh-CN.html)

## 1.建立或选择一个品牌云和产品

1. 登入Connect+并开启**我的云朵**.选择预期的云或使用**建立品牌云**如果您的帐户被允许建立一个帐户。在管理之前，请完成所有者启动。
2. 在云中，开启**产品→新增产品**。 进入**产品名称**, **产品型号**，以及适合您装置的类别。类别是登入档分类学，而不是凭证范围。
3. 选择**装置遥测**，对映为`mqtt`，并储存产品。
4. 安排`iot_shadow`与您的专案运营商一起在经批准的产品/装置服务配置中。**目前的产品编辑器没有单独的阴影核取方块。**选择装置遥测不会启用影子。标准配置API接受`iot_shadow`，但权利和政策仍然决定了接受程度。
5. 使用**会员和访问**以及授权开发人员的适当产品范围。仅有可见的产品或成功登入并不能证明执行时装置访问。消费者APP终端使用者系结是一个单独的身份流；不要假设控制台会员资格是APP终端使用者系结。

对于现有产品，预览服务更改的影响，并验证是否已完成任何所需的重新配置。不要编辑令牌或放大索赔响应的服务列表，以绕过缺少权利。

## 2. 保持识别符号分开

|识别符号|使用|
| --- | --- |
|品牌云/组织ID|客户经理组织上下文；使用为所选云返回的ID，永远不要使用显示名称|
|产品/装置专案配置档案ID|产品授权和装置配置|
|注册处`device.id` |客户经理装置路由|
| `provision_input.video_cloud_devid` |执行时间令牌`devid`，MQTT主题和影子`thingName` |
|索取代币|装置附带的拥有证明；不是登入或执行时令牌|

## 3. 透过帐户经理解决索赔

以下是组织拥有的开发人员整合路径，而不是单独的消费者APP索赔API。请按照描述完成帐户登入[凭证设定](credential-setup.zh-CN.md)，然后保留登入响应为`$TUTORIAL_DIR/account-login.json`.

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

预期HTTP 201带有`claim_id`, `device`，和`provision_input`。索赔解决建立/定位登入档系结；它确实**不**开始启动。 储存`activity_id`, `clip_public_key`，以及回传的批准服务列表`provision_input`；即使只是进行影子练习，也不要编造它们。

## 4. 开始配置并阅读其结果

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

201建立一个操作；200可以返回现有的操作。仅此两者都不能证明启动已完成。在工作等待时，请再次使用有限取样读取配置状态。 检查`operation.status`, `readiness.state`, `readiness.sources`，和`video_metadata`；检查`readiness.failure`当存在时；在终端故障时停止并记录其操作ID。在重试不确定请求时保留相同的操作身份，而不是启动无关的重复操作。

## 5. 准备检查和故障恢复

- 确认登入档装置已启用并对映到预期的`DEVICE_ID`.
- 确认配置成功，装置已启动并具有两个功能。
- 确认证书身份与那个匹配`DEVICE_ID`并且应用程式使用者已获得授权。
- 发放单独的应用程式/装置令牌，然后单独验证连线、SUBACK和影子GET。一个新的影子GET可能会正确返回404。
- MQTT教学连线不实现服务的所有者传输协议，也不证明车队线上指示器应该更改。

对于无效/已申请的令牌，请使用申请解决方案/转让策略；重复呼叫配置不会修复所有权。对于403，请验证云端、产品范围和装置系结。对于待启用的装置，请检查操作，而不是更换装置凭据。 如果`iot_shadow`缺失，请返回产品/权利设定步骤。

下一个：[设定装置与应用程式凭证](credential-setup.zh-CN.md)，接著[两个主要示例](app-device-example.zh-CN.md).

继续：[所有权和释出生命周期](ownership-sharing.zh-CN.md).

建筑：[帐户、工厂和执行时生命周期层](device-presence.zh-CN.md).
