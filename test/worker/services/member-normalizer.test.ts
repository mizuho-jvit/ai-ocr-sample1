import { describe, expect, it } from "vitest";

import { normalizeMemberInput } from "../../../src/worker/services/member-normalizer";
import { ApiErrorException } from "../../../src/worker/types";

function identity(overrides: {
  name: string;
  nameKana?: string | null;
  birthDate?: string | null;
  phone?: string | null;
}) {
  return {
    birthDate: overrides.birthDate ?? null,
    name: overrides.name,
    nameKana: overrides.nameKana ?? null,
    phone: overrides.phone ?? null,
  };
}

describe("normalizeMemberInput — name (F-6-1・F-6-11)", () => {
  it("unifies old-form kanji variants listed in the JSON table (仙臺→仙台)", () => {
    const result = normalizeMemberInput(identity({ name: "仙臺 一郎" }));
    expect(result.nameNormalized).toBe("仙台一郎");
  });

  it("unifies 髙→高, 邊/邉→辺, 齋/齊→斎", () => {
    expect(
      normalizeMemberInput(identity({ name: "髙橋" })).nameNormalized,
    ).toBe("高橋");
    expect(
      normalizeMemberInput(identity({ name: "渡邊" })).nameNormalized,
    ).toBe("渡辺");
    expect(
      normalizeMemberInput(identity({ name: "渡邉" })).nameNormalized,
    ).toBe("渡辺");
    expect(
      normalizeMemberInput(identity({ name: "齋藤" })).nameNormalized,
    ).toBe("斎藤");
    expect(
      normalizeMemberInput(identity({ name: "齊藤" })).nameNormalized,
    ).toBe("斎藤");
  });

  it("applies NFKC to unify full-width/half-width forms and removes spaces regardless of width", () => {
    const fullWidthSpace = normalizeMemberInput(
      identity({ name: "山田　太郎" }),
    );
    const halfWidthSpace = normalizeMemberInput(
      identity({ name: "山田 太郎" }),
    );
    const noSpace = normalizeMemberInput(identity({ name: "山田太郎" }));

    expect(fullWidthSpace.nameNormalized).toBe("山田太郎");
    expect(halfWidthSpace.nameNormalized).toBe("山田太郎");
    expect(noSpace.nameNormalized).toBe("山田太郎");
  });

  it("leaves characters absent from the JSON table unchanged (F-6-13)", () => {
    const result = normalizeMemberInput(identity({ name: "檜山 一二三" }));
    expect(result.nameNormalized).toBe("檜山一二三");
  });

  it("does not mutate the original input object", () => {
    const input = identity({ name: "仙臺 一郎" });
    const frozen = Object.freeze({ ...input });
    expect(() => normalizeMemberInput(frozen)).not.toThrow();
    expect(frozen.name).toBe("仙臺 一郎");
  });
});

describe("normalizeMemberInput — kana", () => {
  it("unifies hiragana to katakana", () => {
    const result = normalizeMemberInput(
      identity({ name: "山田太郎", nameKana: "やまだ たろう" }),
    );
    expect(result.kanaNormalized).toBe("ヤマダタロウ");
  });

  it("unifies half-width katakana to full-width via NFKC and removes spaces", () => {
    const result = normalizeMemberInput(
      identity({ name: "山田太郎", nameKana: "ﾔﾏﾀﾞ ﾀﾛｳ" }),
    );
    expect(result.kanaNormalized).toBe("ヤマダタロウ");
  });

  it("returns an empty string when nameKana is absent", () => {
    const result = normalizeMemberInput(identity({ name: "山田太郎" }));
    expect(result.kanaNormalized).toBe("");
  });
});

describe("normalizeMemberInput — birth date (和暦→西暦)", () => {
  it("passes through an already-seireki YYYY-MM-DD value", () => {
    const result = normalizeMemberInput(
      identity({ birthDate: "1980-01-01", name: "会員" }),
    );
    expect(result.birthDateNormalized).toBe("1980-01-01");
  });

  it("converts full-kanji wareki (昭和55年3月10日) to seireki", () => {
    const result = normalizeMemberInput(
      identity({ birthDate: "昭和55年3月10日", name: "会員" }),
    );
    expect(result.birthDateNormalized).toBe("1980-03-10");
  });

  it("converts abbreviated wareki with dot separators (S55.3.10)", () => {
    const result = normalizeMemberInput(
      identity({ birthDate: "S55.3.10", name: "会員" }),
    );
    expect(result.birthDateNormalized).toBe("1980-03-10");
  });

  it("converts 元年 (the first year of an era) to year 1", () => {
    const result = normalizeMemberInput(
      identity({ birthDate: "令和元年5月1日", name: "会員" }),
    );
    expect(result.birthDateNormalized).toBe("2019-05-01");
  });

  it("normalizes seireki written with full-width digits and kanji separators", () => {
    const result = normalizeMemberInput(
      identity({ birthDate: "１９８０年１月１日", name: "会員" }),
    );
    expect(result.birthDateNormalized).toBe("1980-01-01");
  });

  it("returns null when the value cannot be parsed", () => {
    const result = normalizeMemberInput(
      identity({ birthDate: "不明", name: "会員" }),
    );
    expect(result.birthDateNormalized).toBeNull();
  });

  it("returns null when birthDate is absent", () => {
    const result = normalizeMemberInput(identity({ name: "会員" }));
    expect(result.birthDateNormalized).toBeNull();
  });

  it.each([
    ["1980‐01‐01", "U+2010 HYPHEN"],
    ["1980―01―01", "U+2015 HORIZONTAL BAR"],
    ["1980−01−01", "U+2212 MINUS SIGN"],
    ["1980ー01ー01", "U+30FC 長音記号"],
    ["1980－01－01", "U+FF0D 全角ハイフンマイナス"],
  ])("folds %s (%s) to the same half-width hyphen separator", (birthDate) => {
    const result = normalizeMemberInput(identity({ birthDate, name: "会員" }));
    expect(result.birthDateNormalized).toBe("1980-01-01");
  });

  it("folds dash-like separators inside a wareki date as well (S55−3−10)", () => {
    const result = normalizeMemberInput(
      identity({ birthDate: "S55−3−10", name: "会員" }),
    );
    expect(result.birthDateNormalized).toBe("1980-03-10");
  });

  it("accepts a full-width slash (／) as a separator", () => {
    const result = normalizeMemberInput(
      identity({ birthDate: "1980／01／01", name: "会員" }),
    );
    expect(result.birthDateNormalized).toBe("1980-01-01");
  });
});

describe("normalizeMemberInput — birth date existence check (年月日の実在性)", () => {
  it.each([
    ["1980-02-30", "存在しない2月30日"],
    ["1980-13-01", "存在しない13月"],
    ["1980-01-32", "存在しない1月32日"],
    ["1900-02-29", "うるう年でない1900年の2月29日"],
    ["1980-04-31", "30日までしかない4月の31日"],
    ["昭和55年13月10日", "和暦側の存在しない13月"],
  ])("throws INVALID_DATE for %s (%s)", (birthDate) => {
    const call = () =>
      normalizeMemberInput(identity({ birthDate, name: "会員" }));

    expect(call).toThrowError("不正な日付です。");
    try {
      call();
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiErrorException);
      expect((error as ApiErrorException).code).toBe("INVALID_DATE");
    }
  });

  it("accepts a leap-year February 29 (2000 is divisible by 400)", () => {
    const result = normalizeMemberInput(
      identity({ birthDate: "2000-02-29", name: "会員" }),
    );
    expect(result.birthDateNormalized).toBe("2000-02-29");
  });
});

describe("normalizeMemberInput — 改元当日の月日境界 (和暦→西暦)", () => {
  it.each([
    ["大正15年12月24日", "1926-12-24"],
    ["昭和元年12月25日", "1926-12-25"],
    ["昭和64年1月7日", "1989-01-07"],
    ["平成元年1月8日", "1989-01-08"],
    ["平成31年4月30日", "2019-04-30"],
    ["令和元年5月1日", "2019-05-01"],
  ])("accepts %s as the true boundary day (%s)", (birthDate, expected) => {
    const result = normalizeMemberInput(identity({ birthDate, name: "会員" }));
    expect(result.birthDateNormalized).toBe(expected);
  });

  it.each([
    ["大正15年12月25日", "その日は既に昭和1年"],
    ["昭和元年12月24日", "その日はまだ大正15年"],
    ["昭和64年1月8日", "その日は既に平成1年"],
    ["平成元年1月7日", "その日はまだ昭和64年"],
    ["平成31年5月1日", "その日は既に令和1年"],
    ["令和元年4月30日", "その日はまだ平成31年"],
  ])("rejects %s as an impossible era/date combination (%s)", (birthDate) => {
    expect(() =>
      normalizeMemberInput(identity({ birthDate, name: "会員" })),
    ).toThrowError("不正な日付です。");
  });
});

describe("normalizeMemberInput — phone (ハイフン除去)", () => {
  it("removes hyphens", () => {
    const result = normalizeMemberInput(
      identity({ name: "会員", phone: "090-1234-5678" }),
    );
    expect(result.phoneNormalized).toBe("09012345678");
  });

  it("removes full-width digits and separators via NFKC", () => {
    const result = normalizeMemberInput(
      identity({ name: "会員", phone: "０９０－１２３４－５６７８" }),
    );
    expect(result.phoneNormalized).toBe("09012345678");
  });

  it("returns null when phone is absent", () => {
    const result = normalizeMemberInput(identity({ name: "会員" }));
    expect(result.phoneNormalized).toBeNull();
  });
});
