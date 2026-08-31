import { MAX_PBKDF2_ITERATIONS } from "../config/load-config";
import type { TenantRepository } from "../db/repositories";
import { whereFieldEquals } from "../db/repositories";
import type { staffUsers } from "../db/schema";
import {
  ApiErrorException,
  type AppConfig,
  type LoginRequest,
  type Role,
  type SessionId,
  type StaffUserSummary,
  toSessionId,
} from "../types";

/** F-1-6: 連続失敗がこの回数に達した時点でロックする。 */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;

/** F-1-6: ロックの継続時間（15分）。 */
export const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1_000;

/**
 * セッションの有効期間。要件は期間を定めていないため、商談1日分を賄い、
 * かつ放置端末が翌日まで開いたままにならない長さとして12時間を採る。
 */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;

const HASH_ALGORITHM = "pbkdf2-sha256";
const SALT_BYTES = 16;
const DERIVED_KEY_BITS = 256;
const SESSION_ID_BYTES = 32;

/** 存在しないアカウントでも同じ回数の鍵導出を行うための固定ソルト（秘密ではない）。 */
const DECOY_SALT: Bytes = new Uint8Array(SALT_BYTES);

export interface SessionActor {
  readonly sessionId: SessionId;
  readonly user: StaffUserSummary;
}

export interface LoginResult {
  readonly sessionId: SessionId;
  readonly expiresAt: Date;
  readonly user: StaffUserSummary;
}

export interface AuthService {
  login(input: LoginRequest): Promise<LoginResult>;
  logout(sessionId: SessionId): Promise<void>;
  resolveSession(sessionId: SessionId): Promise<SessionActor | null>;
}

export interface AuthServiceOptions {
  readonly config: AppConfig;
  readonly repository: TenantRepository;
  readonly clock?: () => Date;
}

/** WebCrypto の BufferSource は SharedArrayBuffer 由来のビューを受け付けない。 */
type Bytes = Uint8Array<ArrayBuffer>;

interface ParsedHash {
  readonly iterations: number;
  readonly salt: Bytes;
  readonly digest: Bytes;
}

type StaffRow = typeof staffUsers.$inferSelect;

function toBase64(bytes: Bytes): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Bytes | null {
  if (value.length === 0) {
    return null;
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function deriveKey(
  password: string,
  salt: Bytes,
  iterations: number,
): Promise<Bytes> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { hash: "SHA-256", iterations, name: "PBKDF2", salt },
    material,
    DERIVED_KEY_BITS,
  );
  return new Uint8Array(derived);
}

/** 🔵 Intent: 比較の所要時間から一致した先頭バイト数を推測させない。 */
function timingSafeEqual(left: Bytes, right: Bytes): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function parseStoredHash(storedHash: string): ParsedHash | null {
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== HASH_ALGORITHM) {
    return null;
  }

  const iterations = Number(parts[1]);
  if (
    !Number.isSafeInteger(iterations) ||
    iterations <= 0 ||
    iterations > MAX_PBKDF2_ITERATIONS
  ) {
    return null;
  }

  const salt = fromBase64(parts[2] ?? "");
  const digest = fromBase64(parts[3] ?? "");
  if (!salt || !digest) {
    return null;
  }

  return { digest, iterations, salt };
}

/**
 * 🔵 Intent: NF-2-2 の自己記述形式で保存し、既定値を変えても既存アカウントを壊さない。
 */
export async function hashPassword(
  password: string,
  iterations: number,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const digest = await deriveKey(password, salt, iterations);
  return `${HASH_ALGORITHM}$${iterations}$${toBase64(salt)}$${toBase64(digest)}`;
}

/**
 * 🔵 Intent: NF-2-3 に従い保存された反復回数で再計算する。
 * 形式不正は例外にせず false とし、500 とログでアカウントの状態を露出させない。
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parsed = parseStoredHash(storedHash);
  if (!parsed) {
    return false;
  }
  const digest = await deriveKey(password, parsed.salt, parsed.iterations);
  return timingSafeEqual(digest, parsed.digest);
}

/**
 * 🔵 Intent: F-1-7 の秘匿を応答時間でも守るため、アカウントが存在しない場合も
 * 同じ回数の鍵導出を行ってから失敗させる。
 */
async function burnPasswordVerification(
  password: string,
  iterations: number,
): Promise<void> {
  await deriveKey(password, DECOY_SALT, iterations);
}

function createSessionId(): SessionId {
  const bytes = crypto.getRandomValues(new Uint8Array(SESSION_ID_BYTES));
  return toSessionId(
    toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  );
}

function toStaffUserSummary(staff: StaffRow): StaffUserSummary {
  return {
    email: staff.email,
    id: staff.id,
    isActive: staff.isActive,
    name: staff.name,
    role: staff.role === "admin" ? "admin" : ("staff" satisfies Role),
  };
}

function isLocked(staff: StaffRow, now: Date): boolean {
  if (!staff.lockedUntil) {
    return false;
  }
  const lockedUntil = Date.parse(staff.lockedUntil);
  return Number.isFinite(lockedUntil) && lockedUntil > now.getTime();
}

function storedIterations(storedHash: string): number {
  return parseStoredHash(storedHash)?.iterations ?? 0;
}

function invalidCredentials(): ApiErrorException {
  return new ApiErrorException("INVALID_CREDENTIALS");
}

/**
 * 🔵 Intent: 認証・ロック・セッションの判断を1箇所へ集約し、ルート層へ漏らさない。
 * 失敗要因（不明・誤り・無効・ロック）を呼び出し元から区別できなくする（F-1-7）。
 */
export function createAuthService(options: AuthServiceOptions): AuthService {
  const { config, repository } = options;
  const clock = options.clock ?? (() => new Date());
  const scoped = () => repository.forTenant(config.tenantId);

  /**
   * 読み取った回数に加算して書き戻すと、並行リクエストが同じ値を読んで同じ値を書き、
   * F-1-6 のロックを回避できてしまう。加算とロック判定はDB側の単一UPDATEへ委ねる。
   */
  async function registerFailure(staff: StaffRow, now: Date): Promise<void> {
    const repositories = scoped();

    // ここへ来るのは locked === false のときだけなので、
    // lockedUntil が残っていれば「満了済み」を意味する。満了分は数え直す。
    if (staff.lockedUntil) {
      await repositories.staffUsers.clearExpiredLoginLock(
        staff.id,
        staff.lockedUntil,
      );
    }

    await repositories.staffUsers.registerLoginFailure(staff.id, {
      lockThreshold: MAX_FAILED_LOGIN_ATTEMPTS,
      lockedUntil: new Date(
        now.getTime() + LOGIN_LOCK_DURATION_MS,
      ).toISOString(),
    });
  }

  async function clearFailures(
    staff: StaffRow,
    password: string,
  ): Promise<void> {
    const needsRehash =
      storedIterations(staff.passwordHash) < config.pbkdf2Iterations;
    if (!needsRehash && staff.failedLoginCount === 0 && !staff.lockedUntil) {
      return;
    }

    await scoped().staffUsers.update(
      {
        failedLoginCount: 0,
        lockedUntil: null,
        // NF-2-9: 既定値を下回る保存済みハッシュだけを作り直す。
        ...(needsRehash
          ? {
              passwordHash: await hashPassword(
                password,
                config.pbkdf2Iterations,
              ),
            }
          : {}),
      },
      whereFieldEquals("staff_users", "id", staff.id),
    );
  }

  return Object.freeze({
    async login({ email, password }: LoginRequest): Promise<LoginResult> {
      const now = clock();
      const staff = await scoped().staffUsers.findOne(
        whereFieldEquals("staff_users", "email", email),
      );

      if (!staff) {
        await burnPasswordVerification(password, config.pbkdf2Iterations);
        throw invalidCredentials();
      }

      const locked = isLocked(staff, now);
      const passwordMatches = await verifyPassword(
        password,
        staff.passwordHash,
      );

      if (locked || !staff.isActive || !passwordMatches) {
        // ロック中の試行でロックを延長しない（無期限ロックを避ける）。
        if (!locked && !passwordMatches) {
          await registerFailure(staff, now);
        }
        throw invalidCredentials();
      }

      const sessionId = createSessionId();
      const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
      await scoped().sessions.insert({
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        id: sessionId,
        staffUserId: staff.id,
      });
      await clearFailures(staff, password);

      return { expiresAt, sessionId, user: toStaffUserSummary(staff) };
    },

    async logout(sessionId: SessionId): Promise<void> {
      await scoped().sessions.delete(
        whereFieldEquals("sessions", "id", sessionId),
      );
    },

    async resolveSession(sessionId: SessionId): Promise<SessionActor | null> {
      const repositories = scoped();
      const session = await repositories.sessions.findOne(
        whereFieldEquals("sessions", "id", sessionId),
      );
      if (!session) {
        return null;
      }

      const expiresAt = Date.parse(session.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= clock().getTime()) {
        await repositories.sessions.delete(
          whereFieldEquals("sessions", "id", sessionId),
        );
        return null;
      }

      const staff = await repositories.staffUsers.findOne(
        whereFieldEquals("staff_users", "id", session.staffUserId),
      );
      // 会期中に無効化された職員のセッションは失効させる（F-7-1・NF-2-10）。
      if (!staff?.isActive) {
        return null;
      }

      return { sessionId, user: toStaffUserSummary(staff) };
    },
  } satisfies AuthService);
}
