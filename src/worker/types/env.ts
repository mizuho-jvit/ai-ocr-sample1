import type { OcrPipelineMode, TenantId } from "./contracts";

export interface WorkerEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;

  TENANT_ID: string;
  PBKDF2_ITERATIONS: string;
  ALLOW_WEAK_PASSWORD_HASH?: string;
  MAX_OCR_PAGES_PER_MONTH: string;
  MAX_GEMINI_CALLS_PER_MONTH: string;
  MAX_CHECK_RUNS_PER_APPLICATION: string;
  ALLOW_DATA_RESET?: string;
  OCR_PIPELINE_MODE: string;
  GEMINI_MODEL: string;
  AI_GATEWAY_ACCOUNT_ID: string;
  AI_GATEWAY_ID: string;
  R2_ACCOUNT_ID: string;

  BASIC_AUTH_USERNAME: string;
  BASIC_AUTH_PASSWORD: string;
  GEMINI_API_KEY: string;
  R2_S3_ACCESS_KEY_ID: string;
  R2_S3_SECRET_ACCESS_KEY: string;

  GOOGLE_CLOUD_PROJECT_ID?: string;
  DOCUMENT_AI_LOCATION?: string;
  DOCUMENT_AI_PROCESSOR_ID?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
}

export interface AppConfig {
  tenantId: TenantId;
  pbkdf2Iterations: number;
  maxOcrPagesPerMonth: number;
  maxGeminiCallsPerMonth: number;
  maxCheckRunsPerApplication: number;
  allowDataReset: boolean;
  ocrPipelineMode: OcrPipelineMode;
  geminiModel: string;
  aiGatewayAccountId: string;
  aiGatewayId: string;
}

export type Config = AppConfig;
