import {
  incrementUsageCounter,
  readUsageCounter,
  type UsageCounterRow,
} from "../db/client";
import type { OperationTrace } from "../observability/operation-trace";
import {
  ApiErrorException,
  type AppConfig,
  type PeriodKey,
  toPeriodKey,
  type UsageResponse,
} from "../types";

export interface UsageService {
  consumeOcr(): Promise<UsageResponse>;
  consumeGemini(): Promise<UsageResponse>;
  getUsage(): Promise<UsageResponse>;
}

export interface UsageServiceOptions {
  readonly config: AppConfig;
  readonly database: D1Database;
  readonly clock?: () => Date;
  readonly trace?: OperationTrace;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;

/**
 * 🔵 Intent: NF-2-19の期間キーはJSTのYYYY-MM。UTC epochへ9時間分を加算してからUTC getterで
 * 読むことで、実行環境（Workers/テスト）のホストタイムゾーン設定に依存しない値を作る。
 */
function currentPeriodKey(now: Date): PeriodKey {
  const jstShifted = new Date(now.getTime() + JST_OFFSET_MS);
  const year = jstShifted.getUTCFullYear();
  const month = String(jstShifted.getUTCMonth() + 1).padStart(2, "0");
  return toPeriodKey(`${year}-${month}`);
}

function toUsageResponse(
  config: AppConfig,
  period: PeriodKey,
  row: UsageCounterRow | null,
): UsageResponse {
  const ocrPages = row?.ocrPages ?? 0;
  return {
    geminiCalls: row?.geminiCalls ?? 0,
    geminiCallsLimit: config.maxGeminiCallsPerMonth,
    ocrPages,
    ocrPagesLimit: config.maxOcrPagesPerMonth,
    ocrPagesRemaining: Math.max(0, config.maxOcrPagesPerMonth - ocrPages),
    period,
  };
}

/**
 * 🔵 Intent: OCR/Geminiの月次上限をJSTでfail closed制御する（NF-2-16・NF-2-18・NF-2-34）。
 * 加算はDB層の単一UPSERTに委ね、影響0行（NF-2-39）だけを上限到達として例外化する。
 * F-9のデモリセットが呼び出せる操作をここへ持たず、UsageCounterを変更する手段を
 * consume系の2メソッドだけに限定する（NF-2-40）。
 */
export function createUsageService(options: UsageServiceOptions): UsageService {
  const { config, database, trace } = options;
  const clock = options.clock ?? (() => new Date());

  async function consume(
    column: "ocrPages" | "geminiCalls",
    limit: number,
  ): Promise<UsageResponse> {
    const period = currentPeriodKey(clock());
    const row = await incrementUsageCounter(
      database,
      period,
      column,
      limit,
      trace,
    );
    if (!row) {
      throw new ApiErrorException("USAGE_LIMIT_EXCEEDED");
    }
    return toUsageResponse(config, period, row);
  }

  return Object.freeze({
    consumeGemini: () => consume("geminiCalls", config.maxGeminiCallsPerMonth),
    consumeOcr: () => consume("ocrPages", config.maxOcrPagesPerMonth),
    async getUsage(): Promise<UsageResponse> {
      const period = currentPeriodKey(clock());
      const row = await readUsageCounter(database, period, trace);
      return toUsageResponse(config, period, row);
    },
  } satisfies UsageService);
}
