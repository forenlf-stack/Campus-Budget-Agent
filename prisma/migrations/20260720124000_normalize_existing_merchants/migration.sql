-- Preserve the imported evidence before cleaning display fields.
UPDATE "Transaction"
SET "rawMerchant" = COALESCE("rawMerchant", "merchant"),
    "rawItemName" = COALESCE("rawItemName", "itemName"),
    "rawReference" = COALESCE("rawReference", TRIM(COALESCE("merchant", '') || ' · ' || "itemName"))
WHERE "source" = 'CSV';

-- WeChat/Meituan exports often put the real merchant before a long platform order suffix.
UPDATE "Transaction"
SET "merchant" = SUBSTR("itemName", 1, INSTR("itemName", '-美团外卖App-') - 1),
    "itemName" = SUBSTR("itemName", 1, INSTR("itemName", '-美团外卖App-') - 1)
WHERE INSTR("itemName", '-美团外卖App-') > 1;

UPDATE "Transaction"
SET "merchant" = SUBSTR("itemName", 1, INSTR("itemName", '-美团App-') - 1),
    "itemName" = SUBSTR("itemName", 1, INSTR("itemName", '-美团App-') - 1)
WHERE INSTR("itemName", '-美团App-') > 1;

UPDATE "Transaction"
SET "itemName" = '美团收银'
WHERE "itemName" GLOB '美团收银[0-9]*' AND LENGTH("itemName") > 12;

UPDATE "Transaction"
SET "itemName" = 'Steam Purchase'
WHERE "itemName" GLOB 'Steam Purchase [0-9]*' AND LENGTH("itemName") > 24;
