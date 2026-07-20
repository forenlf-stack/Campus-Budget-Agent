import { describe, expect, it } from "vitest";

import { parseOcrMenuText } from "./menu-recognition-provider";

describe("OCR菜单回退整理", () => {
  it("只把带名称的行转为候选并提取价格", () => {
    const candidates = parseOcrMenuText("外送\n招牌红碗豌杂面+鸡架 ¥24.9\nVPN\n酸菜卤肉饭+小吃+饮品 ¥21.9");
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "招牌红碗豌杂面+鸡架", priceCents: 2490 }),
      expect.objectContaining({ name: "酸菜卤肉饭+小吃+饮品", priceCents: 2190 }),
    ]));
  });
});
