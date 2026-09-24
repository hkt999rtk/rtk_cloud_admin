---
title: 憑證更新與連線復原
description: 更新執行時憑據，並在到期或網路丟失後恢復訂閱和狀態。
category: Operate and troubleshoot
keywords:
- 更新
- 滿期
- 重新連線
- 撤回
- 電視網
- renewal
- expiry
- reconnect
- revocation
- network
language: zh-TW
applies_to: RTK contracts 9b1ed887912e; Account Manager 54b37b9c407d; Video Cloud
  30fbb9a26155; Admin bbaf62f7d6b5
last_verified: '2026-09-04'
verification: 來源審查和本地檢查；現場環境資格待定
---


# 憑證更新與連線復原

## 恢復示例元件

主管擁有憑證的終身許可權、重試預算和工人的清理工作。工人在MQTT訂閱和影子對賬方面擁有主權。私人臨時令牌檔案連線這些本地流程，並在退出時刪除；沒有雲訊息歷史記錄儲存在那裡。這些是示例元件，不是額外的伺服器服務。

![恢復示例元件](assets/recovery-components.zh-TW.svg)

[全尺寸方塊圖](assets/recovery-components.zh-TW.svg) · [Mermaid 原始檔](assets/recovery-components.zh-TW.mmd)

## 目標和先決條件

使裝置整合在一個令牌壽命之外繼續工作。準備證書、私鑰、伺服器CA和特定於角色的mTLS端點透過[憑證設定](credential-setup.zh-TW.md)。使用[可下載模擬器](app-device-example.zh-TW.md)作為工作人員；下面的恢復執行者監督模擬裝置。生產韌體必須保留其真實的硬體狀態，而不是在處理器啟動時重置模擬電源。

[開啟重新設計的序列圖](assets/credential-renewal.zh-TW.html)

## 憑證壽命規則

|憑證|續訂行動|
| --- | --- |
|客戶經理登入令牌|使用其自己的帳戶身份驗證流程；切勿將其傳遞給影片雲重新整理|
|執行時MQTT JWT|在簽署之前重新發行`exp`，用返回的元資料/密碼重新連線|
|過期的執行時間 JWT|重複驗證證書引導程式`/request_token` |
|HTTP SigV4捆綁包|請求一個新的捆綁包，包含`aws_iot_data:true`；重新整理不是套餐續訂契約|
|到期/撤銷的證書|使用授權證書註冊/輪換；令牌重新整理無法修復它|

解碼`exp`僅用於安排工作，而不是在本地授權。請求的TTL不是發行的終身有效期。重新整理會使用歷史名稱中的仍然有效的訪問令牌`refresh_token`欄位。在更換本地檔案之前，請驗證替換。避免同時為相同的身份進行重新整理工作。

## 執行受限恢復主管

[下載Python示例](assets/shadow-demo.zip)，安裝其固定依賴項，並使用Bash與設定一起使用[開始之前](before-you-start.zh-TW.md)。該檔案包括`recover.py`與`demo.py`.

```bash
python recover.py --duration 3600 --attempts 6
```

主管使用`DEVICE_TOKEN_BASE`, `API_BASE`, `DEVICE_CERT`, `DEVICE_KEY`, `CA_FILE`, `DEVICE_ID`, `MQTT_HOST`和可選的`MQTT_PORT`/`SHADOW_NAME`。它建立一個私人臨時令牌檔案，並在退出時刪除它。每個工作者的連線在GET之前訂閱。它提前續訂，在啟動下一個工作者之前停止舊工作者，並在臨時錯誤的情況下在固定嘗試預算內退縮。這是一個可配置的教學策略，而不是服務SLA。Ctrl-C停止兩個過程。

預期進度訊息包括：

```text
RECOVERY bootstrap succeeded
DEVICE ready: simulated power=off
RECOVERY reissue succeeded
DEVICE ready: simulated power=off
```

在短時間內，可能不會發生續訂。讓它超過退回的有效期才能獲得續訂資格；不要重寫JWT索賠或停用過期檢查。演示不聲稱在重新連線時提供不間斷的MQTT傳輸。

## 網路更改和重新連線對賬

[開啟重新設計的序列圖](assets/network-recovery.zh-TW.html)

DNS更改、Wi-Fi交換機或插座關閉需要重新建立傳輸連線。使用當前端點設定和TLS驗證，允許DNS再次解析，並避免同時使用一個客戶端ID的客戶端。在CONNACK後，等待SUBACK、GET並建立一個新的狀態基線，然後消耗差分。不要假設清潔會話離線傳輸或重播每次錯過的差分。

在專用的測試環境中暫時停止網路，在裝置缺席時更改所需值，然後在主管截止日期前恢復連線。預期結果：重新連線，獲取當前所需值，應用/讀取回，報告實際狀態。如果工作人員反覆退出或收到無效的應用狀態，受限的故障預算將終止診斷執行，而不是無限期地隱藏故障。

## 到期和撤銷分支

重新整理401會在每次嘗試後恢復到證書引導；過期的證書或失敗的引導會停止進度。在本例中，403是終止狀態：檢查範圍、裝置啟動、會員資格、證書狀態和權利。不要增加許可權、反覆輪換證書或繼續使用被拒絕的快取憑據。

撤銷傳播和強制斷開連線的時間不是作為通用部署保證的。資格驗證已連線的客戶端和新的令牌/連線嘗試。如果撤銷後現有流量仍然可能，請報告觀察到的邊界，而不是聲稱立即執行。證書輪換可能會影響同一全球使用者的其他安裝。

## 失敗和資格清單

測試有效重新發行、過期令牌引導、錯誤的CA、撤銷身份、拒絕目標、臨時HTTP 503、網路丟失和用盡重試預算。發生變異後的超時導致結果未知：替換前GET。執行者的策略測試沒有建立即時執行或持續的服務可用性。下一個：[整合除錯](debugging.zh-TW.md), [連線設定](connection-settings.zh-TW.md).
