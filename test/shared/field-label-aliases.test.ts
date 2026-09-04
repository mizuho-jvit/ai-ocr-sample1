import { describe, expect, it } from "vitest";
import {
  BIRTH_DATE_LABELS,
  findFieldValueByLabels,
  NAME_KANA_LABELS,
  PHONE_LABELS,
} from "../../src/shared/field-label-aliases";

describe("findFieldValueByLabels", () => {
  it("matches any alias in the label set, not just the primary label", () => {
    const fields = [{ label: "フリガナ", value: "ヤマダ タロウ" }];
    expect(findFieldValueByLabels(fields, NAME_KANA_LABELS)).toBe(
      "ヤマダ タロウ",
    );
  });

  it("matches every documented alias for 氏名カナ and 電話番号", () => {
    for (const label of ["氏名カナ", "氏名（カナ）", "フリガナ", "ふりがな"]) {
      expect(
        findFieldValueByLabels([{ label, value: "x" }], NAME_KANA_LABELS),
      ).toBe("x");
    }
    for (const label of ["電話番号", "電話"]) {
      expect(
        findFieldValueByLabels([{ label, value: "090" }], PHONE_LABELS),
      ).toBe("090");
    }
  });

  it("trims surrounding whitespace on the label before comparing", () => {
    const fields = [{ label: " 生年月日 ", value: "1990-01-01" }];
    expect(findFieldValueByLabels(fields, BIRTH_DATE_LABELS)).toBe(
      "1990-01-01",
    );
  });

  it("returns null when no field matches any alias", () => {
    const fields = [{ label: "住所", value: "東京都" }];
    expect(findFieldValueByLabels(fields, NAME_KANA_LABELS)).toBeNull();
  });

  it("returns null when the matched field's value is blank", () => {
    const fields = [{ label: "フリガナ", value: "   " }];
    expect(findFieldValueByLabels(fields, NAME_KANA_LABELS)).toBeNull();
  });
});
