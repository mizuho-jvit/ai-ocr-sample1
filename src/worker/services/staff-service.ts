import type { TenantRepository } from "../db/repositories";
import { whereFieldEquals } from "../db/repositories";
import type { staffUsers } from "../db/schema";
import {
  ApiErrorException,
  type AppConfig,
  type CreateStaffRequest,
  type StaffUserId,
  type StaffUserSummary,
  toStaffUserId,
  type UpdateStaffRequest,
} from "../types";
import { toStaffUserSummary } from "./application-view";
import type { SessionActor } from "./auth";
import { hashPassword } from "./auth";

type StaffRow = typeof staffUsers.$inferSelect;

export interface StaffService {
  list(): Promise<StaffUserSummary[]>;
  create(
    input: CreateStaffRequest,
    actor: SessionActor,
  ): Promise<StaffUserSummary>;
  update(
    staffId: StaffUserId,
    actor: SessionActor,
    input: UpdateStaffRequest,
  ): Promise<StaffUserSummary>;
}

export interface StaffServiceOptions {
  readonly config: AppConfig;
  readonly repository: TenantRepository;
}

function validationError(): ApiErrorException {
  return new ApiErrorException("VALIDATION_ERROR");
}

function notFound(): ApiErrorException {
  return new ApiErrorException("NOT_FOUND");
}

/**
 * 🟡 Intent: コードレビュー指摘(P2)。事前SELECT(決定#43)は並行登録に対するTOCTOUを
 * 完全には防げないため、INSERT自体が`staff_users_tenant_email_unique`違反で失敗した
 * 場合も422へ変換できるようにする。D1/drizzleは制約違反を専用の型で公開しないため、
 * `DrizzleQueryError.cause`(D1が投げる生のError)のメッセージ文字列で判定する
 * (workerd実機で実際に投げられる形を確認済み: `cause.message`が
 * `D1_ERROR: UNIQUE constraint failed: staff_users.tenant_id, staff_users.email: ...`)。
 */
function isDuplicateStaffEmailInsertError(error: unknown): boolean {
  const cause = (error as { cause?: unknown } | undefined)?.cause;
  const message = cause instanceof Error ? cause.message : undefined;
  return (
    typeof message === "string" &&
    message.includes("UNIQUE constraint failed") &&
    message.includes("staff_users.email")
  );
}

/**
 * 🔵 Intent: F-7・api.md #24〜26のスタッフ管理APIを実装する。削除エンドポイントは
 * 設けず（Implementation Notes）、無効化は`isActive: false`への更新のみで表す。
 */
export function createStaffService(options: StaffServiceOptions): StaffService {
  const { config, repository } = options;
  const repositories = () => repository.forTenant(config.tenantId);

  async function requireStaff(staffId: StaffUserId): Promise<StaffRow> {
    const staff = await repositories().staffUsers.findOne(
      whereFieldEquals("staff_users", "id", staffId),
    );
    if (!staff) {
      throw notFound();
    }
    return staff;
  }

  return Object.freeze({
    async create(input, actor) {
      const repos = repositories();

      // 🟡 Intent: 早期に分かりやすいエラーを返すための事前検証(決定#43)。
      // 並行登録に対する最終的な一意性保証はDB制約側にあるため、これをすり抜けた
      // 場合もinsert()のcatchで422へ変換する(コードレビュー指摘・P2)。
      const existing = await repos.staffUsers.findOne(
        whereFieldEquals("staff_users", "email", input.email),
      );
      if (existing) {
        throw validationError();
      }

      const passwordHash = await hashPassword(
        input.password,
        config.pbkdf2Iterations,
      );

      try {
        const inserted = await repos.staffUsers.insert({
          createdById: actor.user.id,
          email: input.email,
          failedLoginCount: 0,
          id: toStaffUserId(crypto.randomUUID()),
          isActive: true,
          lockedUntil: null,
          name: input.name,
          passwordHash,
          role: input.role,
          updatedById: null,
        });
        return toStaffUserSummary(inserted);
      } catch (error) {
        if (isDuplicateStaffEmailInsertError(error)) {
          throw validationError();
        }
        throw error;
      }
    },

    async list() {
      const repos = repositories();
      const rows = await repos.staffUsers.all();
      // 🔴 Intent: 一覧の既定並び順は要件に定めが無い。登録順(createdAt昇順)を採る。
      const sorted = [...rows].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      return sorted.map(toStaffUserSummary);
    },

    async update(staffId, actor, input) {
      const repos = repositories();
      const current = await requireStaff(staffId);

      const nextRole = input.role ?? current.role;
      const nextIsActive = input.isActive ?? current.isActive;
      // 🔵 Intent: コードレビュー指摘(P1)。この更新によって対象行が
      // 「有効なadmin」でなくなる場合に限り、他に有効なadminが存在するかをDB側で
      // 検証する条件付きUPDATEへ回す。対象行が元々有効なadminでなければ、
      // この更新は不変条件(有効なadminが1人以上)に影響しないため素通しする。
      const removesLastActiveAdmin =
        current.role === "admin" &&
        current.isActive &&
        !(nextRole === "admin" && nextIsActive === true);
      // 🔵 Intent: コードレビュー指摘(P1・関連)。`isActive`をtrue→falseへ変える
      // (無効化する)場合に限り、対象職員の既存セッションを同一トランザクションで
      // 削除する。再有効化(false→true)や、無効化以外の変更では削除しない。
      const isDeactivating = input.isActive === false && current.isActive;

      const values = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.password !== undefined
          ? {
              passwordHash: await hashPassword(
                input.password,
                config.pbkdf2Iterations,
              ),
            }
          : {}),
        updatedById: actor.user.id,
      };

      if (removesLastActiveAdmin || isDeactivating) {
        const updated = await repos.staffUsers.updateGuarded(staffId, values, {
          deleteSessions: isDeactivating,
          requireOtherActiveAdmin: removesLastActiveAdmin,
        });
        if (!updated) {
          throw new ApiErrorException("INVALID_TRANSITION");
        }
        return toStaffUserSummary(updated);
      }

      await repos.staffUsers.update(
        values,
        whereFieldEquals("staff_users", "id", staffId),
      );

      const updated = await requireStaff(staffId);
      return toStaffUserSummary(updated);
    },
  } satisfies StaffService);
}
