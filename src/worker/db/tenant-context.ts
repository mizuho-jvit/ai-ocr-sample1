import type { AppConfig, TenantId } from "../types";

/**
 * 🔵 Intent: テナントIDの供給源を設定に固定し、リクエスト値を受け取る経路を作らない。
 * 将来のセッション解決への移行時も、この関数だけを差し替える。
 */
export function currentTenantId(config: AppConfig): TenantId {
  return config.tenantId;
}
