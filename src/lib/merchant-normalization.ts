import type { ImportedTransactionCandidate } from "./transaction-imports";

const genericPlatformMerchants = new Set(["美团", "美团平台商户", "支付宝", "微信支付", "微信", "财付通"]);

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function merchantRuleKey(value: string) {
  return compact(value).toLocaleLowerCase("zh-CN").replace(/[（(].*?[）)]/g, "").replace(/平台商户|官方旗舰店/g, "").replace(/[\s·_-]/g, "");
}

export function cleanMerchantAndItem(merchant: string, itemName: string) {
  const rawMerchant = compact(merchant);
  const rawItemName = compact(itemName);
  let normalizedItem = rawItemName
    .replace(/[-—]\s*(?:美团外卖|美团)App[-—]?\d{12,}$/i, "")
    .replace(/(美团收银|Steam Purchase)\s*\d{12,}$/i, "$1")
    .replace(/(?:订单号|商户单号|交易单号)[:：]?\s*[A-Za-z0-9_-]{12,}$/i, "")
    .replace(/[-—_,，\s]+$/g, "")
    .trim();
  if (!normalizedItem) normalizedItem = rawItemName;

  let normalizedMerchant = rawMerchant.replace(/平台商户$/u, "").trim();
  const itemContainedMerchant = rawItemName.match(/^(.+?)[-—]\s*(?:美团外卖|美团)App[-—]?\d{12,}$/i)?.[1]?.trim();
  if (itemContainedMerchant && genericPlatformMerchants.has(rawMerchant)) normalizedMerchant = itemContainedMerchant;
  if (!normalizedMerchant) normalizedMerchant = rawMerchant || "未填写商家";

  return {
    merchant: normalizedMerchant.slice(0, 100),
    itemName: normalizedItem.slice(0, 100),
    rawMerchant: rawMerchant.slice(0, 300),
    rawItemName: rawItemName.slice(0, 300),
  };
}

export function normalizeImportedCandidate(candidate: ImportedTransactionCandidate): ImportedTransactionCandidate {
  const cleaned = cleanMerchantAndItem(candidate.merchant, candidate.itemName);
  return { ...candidate, ...cleaned };
}
