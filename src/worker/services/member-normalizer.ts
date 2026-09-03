import variantMap from "../assets/variant-map.json";
import { ApiErrorException, type NormalizedKeys } from "../types";

export interface MemberIdentity {
  name: string;
  nameKana: string | null;
  birthDate: string | null;
  phone: string | null;
}

/** F-6-3の一致条件は氏名・カナ+生年月日・電話までであり、住所は対象外（住所はNormalizedKeysと1:1）。 */
export type NormalizedMemberIdentity = NormalizedKeys;

const VARIANT_MAP: Record<string, string> = variantMap;

const HIRAGANA_START = 0x3041;
const HIRAGANA_END = 0x3096;
const HIRAGANA_TO_KATAKANA_OFFSET = 0x60;

interface EraDefinition {
  readonly key: string;
  readonly alpha: string;
  readonly startYear: number;
  readonly startMonth: number;
  readonly startDay: number;
}

/**
 * 🟡 Intent: 改元当日の月日境界を検証するため、各元号の起点を西暦の年月日で明示する
 * （大正=1912-07-30、昭和=1926-12-25、平成=1989-01-08、令和=2019-05-01。
 * 前元号の最終日はいずれも次元号の起点日の前日になる）。
 * 明治のみ、太陽暦採用（明治6年）より前で史実上の日単位対応が定まらないため、
 * 慶応4年1月1日を遡及適用した西暦1868-01-25を採用する。MVPが扱う会員の生年月日に
 * 明治初期が含まれることは実質ないため、この日付の厳密性は業務上問題にならない。
 * 配列の並び順（古い→新しい）に、次元号への切替判定（indexOf+1）が依存する。
 */
const ERAS: readonly EraDefinition[] = [
  { alpha: "M", key: "明治", startDay: 25, startMonth: 1, startYear: 1868 },
  { alpha: "T", key: "大正", startDay: 30, startMonth: 7, startYear: 1912 },
  { alpha: "S", key: "昭和", startDay: 25, startMonth: 12, startYear: 1926 },
  { alpha: "H", key: "平成", startDay: 8, startMonth: 1, startYear: 1989 },
  { alpha: "R", key: "令和", startDay: 1, startMonth: 5, startYear: 2019 },
];

function findEra(token: string): EraDefinition | undefined {
  const upperToken = token.toUpperCase();
  return ERAS.find((era) => era.key === token || era.alpha === upperToken);
}

function invalidDate(): never {
  throw new ApiErrorException("INVALID_DATE");
}

/** 🔵 Intent: 実在する年月日かどうかをUTC上の月末日計算で判定する（うるう年を含む）。 */
function isValidCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDayOfMonth;
}

/**
 * 🔵 Intent: 元号が改元当日を跨ぐ年（元年・翌元号への切替年）のときだけ、
 * 起点日（当元号の初日／次元号の前日まで）との前後関係を検証する。
 */
function assertWithinEraBoundary(
  era: EraDefinition,
  seirekiYear: number,
  month: number,
  day: number,
): void {
  if (seirekiYear < era.startYear) {
    invalidDate();
  }

  if (seirekiYear === era.startYear) {
    const beforeEraStart =
      month < era.startMonth ||
      (month === era.startMonth && day < era.startDay);
    if (beforeEraStart) {
      invalidDate();
    }
  }

  const nextEra = ERAS[ERAS.indexOf(era) + 1];
  if (nextEra === undefined) {
    return;
  }

  if (seirekiYear > nextEra.startYear) {
    invalidDate();
  }

  if (seirekiYear === nextEra.startYear) {
    const onOrAfterNextEraStart =
      month > nextEra.startMonth ||
      (month === nextEra.startMonth && day >= nextEra.startDay);
    if (onOrAfterNextEraStart) {
      invalidDate();
    }
  }
}

const WAREKI_PATTERN =
  /^(明治|大正|昭和|平成|令和|[mtshr])(元|\d{1,2})[年./-](\d{1,2})[月./-]?(\d{1,2})日?$/i;
const SEIREKI_PATTERN = /^(\d{4})[年./-](\d{1,2})[月./-]?(\d{1,2})日?$/;

/**
 * 🔵 Intent: OCR/IME由来でハイフンの代わりに使われがちなダッシュ系文字
 * （U+2010 HYPHEN、U+2015 HORIZONTAL BAR、U+2212 MINUS SIGN、U+30FC 長音記号）を
 * 半角ハイフンへ寄せる。全角ハイフンマイナス（U+FF0D）はNFKCで半角へ変換済みだが、
 * これら4種はNFKCの対象外（正規化等価ではなく見た目が似ているだけ）のため、
 * 生年月日の区切り文字として個別に畳み込む。氏名・カナには適用しない
 * （長音記号「ー」は「サトウ」等の正当なカナ表記のため）。
 */
const DASH_VARIANTS_PATTERN = /[‐―−ー]/g;

function foldDashVariants(value: string): string {
  return value.replace(DASH_VARIANTS_PATTERN, "-");
}

function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}

/** 🔵 Intent: F-6-11のJSON対応表を1文字ずつ置換する。未登録文字はF-6-13によりそのまま残す。 */
function applyVariantMap(value: string): string {
  return Array.from(value)
    .map((char) => VARIANT_MAP[char] ?? char)
    .join("");
}

function toKatakana(value: string): string {
  return Array.from(value)
    .map((char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      if (codePoint >= HIRAGANA_START && codePoint <= HIRAGANA_END) {
        return String.fromCodePoint(codePoint + HIRAGANA_TO_KATAKANA_OFFSET);
      }
      return char;
    })
    .join("");
}

/** 🔵 Intent: NFKCで全角/半角・スペース種別を統一してから対応表を適用し、最後に空白を除去する（F-6-1）。 */
function normalizeName(name: string): string {
  const widthUnified = name.normalize("NFKC");
  return stripWhitespace(applyVariantMap(widthUnified));
}

function normalizeKana(nameKana: string | null): string {
  if (nameKana === null) {
    return "";
  }
  const widthUnified = nameKana.normalize("NFKC");
  return stripWhitespace(toKatakana(widthUnified));
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 🔵 Intent: 和暦→西暦は年単位の変換式（起点年 + 和暦年 - 1）で年を求めたうえで、
 * 実在する年月日か（存在チェック）と改元当日の月日境界の両方をassertWithinEraBoundaryで
 * 検証する。どちらかに違反する入力はApiErrorException("INVALID_DATE")として拒否し、
 * 「不正な日付です。」を呼び出し元へ伝える。日付として一切パースできない値（「不明」等）は
 * これまでどおりnullのまま返し、エラーにはしない。
 */
function normalizeBirthDate(birthDate: string | null): string | null {
  if (birthDate === null) {
    return null;
  }
  const normalized = foldDashVariants(birthDate.normalize("NFKC")).trim();

  const warekiMatch = normalized.match(WAREKI_PATTERN);
  if (warekiMatch) {
    const [, eraToken, yearPart, month, day] = warekiMatch as unknown as [
      string,
      string,
      string,
      string,
      string,
    ];
    const era = findEra(eraToken);
    if (era === undefined) {
      return null;
    }
    const warekiYear = yearPart === "元" ? 1 : Number(yearPart);
    const seirekiYear = era.startYear + warekiYear - 1;
    const monthNumber = Number(month);
    const dayNumber = Number(day);
    if (!isValidCalendarDate(seirekiYear, monthNumber, dayNumber)) {
      invalidDate();
    }
    assertWithinEraBoundary(era, seirekiYear, monthNumber, dayNumber);
    return `${seirekiYear}-${pad2(monthNumber)}-${pad2(dayNumber)}`;
  }

  const seirekiMatch = normalized.match(SEIREKI_PATTERN);
  if (seirekiMatch) {
    const [, year, month, day] = seirekiMatch as unknown as [
      string,
      string,
      string,
      string,
    ];
    const yearNumber = Number(year);
    const monthNumber = Number(month);
    const dayNumber = Number(day);
    if (!isValidCalendarDate(yearNumber, monthNumber, dayNumber)) {
      invalidDate();
    }
    return `${yearNumber}-${pad2(monthNumber)}-${pad2(dayNumber)}`;
  }

  return null;
}

function normalizePhone(phone: string | null): string | null {
  if (phone === null) {
    return null;
  }
  const digitsOnly = phone.normalize("NFKC").replace(/\D/g, "");
  return digitsOnly.length > 0 ? digitsOnly : null;
}

/** 🔵 Intent: F-6-1〜F-6-2の決定的正規化。AIを呼ばず、入力オブジェクトは変更しない。 */
export function normalizeMemberInput(
  input: MemberIdentity,
): NormalizedMemberIdentity {
  return {
    birthDateNormalized: normalizeBirthDate(input.birthDate),
    kanaNormalized: normalizeKana(input.nameKana),
    nameNormalized: normalizeName(input.name),
    phoneNormalized: normalizePhone(input.phone),
  };
}
