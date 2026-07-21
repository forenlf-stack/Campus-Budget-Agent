import { describe, expect, it } from "vitest";

import { cleanMerchantAndItem, merchantRuleKey } from "./merchant-normalization";

describe("merchant normalization", () => {
  it("从美团订单描述提取真实商家并移除平台订单后缀", () => {
    expect(cleanMerchantAndItem("美团平台商户", "味千拉面(石景山路店)-美团外卖App-26070811100300001303904935114549")).toMatchObject({
      merchant: "味千拉面(石景山路店)",
      itemName: "味千拉面(石景山路店)",
      rawMerchant: "美团平台商户",
    });
  });

  it("清理长收银编号但保留原始项目名称", () => {
    expect(cleanMerchantAndItem("西塔婆婆生蚝烤肉自助", "美团收银909700214658765130")).toEqual({
      merchant: "西塔婆婆生蚝烤肉自助",
      itemName: "美团收银",
      rawMerchant: "西塔婆婆生蚝烤肉自助",
      rawItemName: "美团收银909700214658765130",
    });
  });

  it("生成稳定的商家规则键", () => {
    expect(merchantRuleKey("蜜雪冰城（古城店）")).toBe("蜜雪冰城");
  });
});
