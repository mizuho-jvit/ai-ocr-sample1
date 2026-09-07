import type { TenantRepository } from "../db/repositories";
import { whereFieldEquals } from "../db/repositories";
import {
  ApiErrorException,
  type AppConfig,
  type ChangeMemberStatusRequest,
  type CreateMemberRequest,
  type MatchCandidateView,
  type MemberDetail,
  type MemberId,
  type MemberListQuery,
  type MemberListResponse,
  type MemberStatus,
  toMemberId,
  type UpdateMemberRequest,
} from "../types";
import { buildMatchCandidateView, toMemberSummary } from "./application-view";
import type { SessionActor } from "./auth";
import { normalizeMemberInput } from "./member-normalizer";
import { buildMemberDetail, type MemberRow } from "./member-view";

export interface MemberService {
  list(query: MemberListQuery): Promise<MemberListResponse>;
  get(memberId: MemberId): Promise<MemberDetail>;
  create(
    input: CreateMemberRequest,
    actor: SessionActor,
  ): Promise<MemberDetail>;
  update(
    memberId: MemberId,
    actor: SessionActor,
    input: UpdateMemberRequest,
  ): Promise<MemberDetail>;
  changeStatus(
    memberId: MemberId,
    actor: SessionActor,
    input: ChangeMemberStatusRequest,
  ): Promise<MemberDetail>;
  /** 重複疑いリスト（F-5-9・api.md #16）。未解決（pending/hold）の候補をテナント横断で返す。 */
  listMatchCandidates(): Promise<MatchCandidateView[]>;
}

export interface MemberServiceOptions {
  readonly config: AppConfig;
  readonly repository: TenantRepository;
}

/** 🔴 Intent: ページングは他の一覧APIと同じ既定値とする（決定#29と同じ実装時判断）。 */
const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

/** F-5-9・api.md #16「未解決」＝pending/hold。merged/rejected/staleは重複疑いリストから外れる。 */
const UNRESOLVED_MATCH_STATUSES = new Set(["pending", "hold"]);

/** 🟡 Intent: 実在し得ない値にして、無効な生年月日フィルタが誤って何かに一致しないようにする。 */
const IMPOSSIBLE_BIRTH_DATE_FILTER = "invalid-birth-date-filter";

/** 🟡 Intent: 実在し得ない値にして、無効な電話番号フィルタが誤って何かに一致しないようにする。 */
const IMPOSSIBLE_PHONE_FILTER = "invalid-phone-filter";

function notFound(): ApiErrorException {
  return new ApiErrorException("NOT_FOUND");
}

function validationError(): ApiErrorException {
  return new ApiErrorException("VALIDATION_ERROR");
}

function clampPerPage(value: number): number {
  return Math.min(Math.max(value, 1), MAX_PER_PAGE);
}

/**
 * 🟡 Intent: コードレビュー指摘。任意項目(nameKana/postalCode/address/email)は
 * 空文字で送信されても消去の意図として扱い、DBにはnullで保存する
 * (nullableカラムに空文字を残すと、他の「未設定」判定(null比較)と食い違うため)。
 */
function emptyToNull(value: string | null): string | null {
  return value === "" ? null : value;
}

/**
 * 🟡 Intent: 決定#41。`GET /api/members`は422を持たない（api.md #19）ため、
 * 生年月日フィルタが解釈できない値でも例外にせず「一致しない」として扱う。
 */
function normalizedBirthDateFilter(raw: string): string {
  try {
    return (
      normalizeMemberInput({
        birthDate: raw,
        name: "",
        nameKana: null,
        phone: null,
      }).birthDateNormalized ?? IMPOSSIBLE_BIRTH_DATE_FILTER
    );
  } catch {
    return IMPOSSIBLE_BIRTH_DATE_FILTER;
  }
}

/**
 * 🔵 Intent: F-5-1・F-5-4〜9・F-6-2の会員管理API群（api.md #16・#19〜23）を実装する。
 * `MemberDetail`の組み立てはmember-view.tsへ集約し、ここでは検索・採番・正規化・
 * 状態履歴の記録だけを担う（application-service.tsと同じ責務分離）。
 */
export function createMemberService(
  options: MemberServiceOptions,
): MemberService {
  const { config, repository } = options;
  const repositories = () => repository.forTenant(config.tenantId);

  async function requireMember(memberId: MemberId): Promise<MemberRow> {
    const member = await repositories().members.findOne(
      whereFieldEquals("members", "id", memberId),
    );
    if (!member) {
      throw notFound();
    }
    return member;
  }

  return Object.freeze({
    async changeStatus(memberId, actor, input) {
      const repos = repositories();
      const member = await requireMember(memberId);

      // F-5-7: 変更者・日時・理由をStatusHistoryへ、状態変更と同一トランザクションで記録する。
      // 決定#40: 許可遷移表は設けず、任意の状態への変更を許可する。
      await repos.runTransaction([
        repos.members.prepareUpdate(
          { status: input.toStatus, updatedById: actor.user.id },
          whereFieldEquals("members", "id", memberId),
        ),
        repos.statusHistory.prepareInsert({
          createdById: actor.user.id,
          fromStatus: member.status as MemberStatus,
          id: crypto.randomUUID(),
          memberId,
          reason: input.reason,
          toStatus: input.toStatus,
        }),
      ]);

      const updated = await requireMember(memberId);
      return buildMemberDetail(repos, updated);
    },

    async create(input, actor) {
      const repos = repositories();
      // F-6-2: 表示・出力用の原文(name/nameKana/birthDate入力値)は変更せず、
      // 正規化済みの値を別途保存する。ただしmembers.birthDate/phoneは
      // 正規化済みの値そのものを単一の列として保存する設計のため(members_*_check制約)、
      // ここでは正規化結果をbirthDate/phoneの保存値として使う。
      const normalized = normalizeMemberInput({
        birthDate: input.birthDate ?? null,
        name: input.name,
        nameKana: input.nameKana ?? null,
        phone: input.phone,
      });
      if (normalized.phoneNormalized === null) {
        throw validationError();
      }

      const inserted = await repos.members.insertWithNextNumber({
        address: emptyToNull(input.address ?? null),
        birthDate: normalized.birthDateNormalized,
        createdById: actor.user.id,
        email: emptyToNull(input.email ?? null),
        id: toMemberId(crypto.randomUUID()),
        isSeed: false,
        kanaNormalized: normalized.kanaNormalized,
        name: input.name,
        nameKana: emptyToNull(input.nameKana ?? null),
        nameNormalized: normalized.nameNormalized,
        phone: normalized.phoneNormalized,
        postalCode: emptyToNull(input.postalCode ?? null),
        status: input.status,
        updatedById: null,
      });

      return buildMemberDetail(repos, inserted);
    },

    async get(memberId) {
      const repos = repositories();
      const member = await requireMember(memberId);
      return buildMemberDetail(repos, member);
    },

    async list(query) {
      const repos = repositories();
      const rows = await repos.members.all();

      const trimmedQ = query.q?.trim();
      const normalizedQuery = trimmedQ
        ? normalizeMemberInput({
            birthDate: null,
            name: trimmedQ,
            nameKana: trimmedQ,
            phone: null,
          })
        : null;
      const birthDateFilter = query.birthDate
        ? normalizedBirthDateFilter(query.birthDate)
        : null;
      const phoneFilter = query.phone
        ? (normalizeMemberInput({
            birthDate: null,
            name: "",
            nameKana: null,
            phone: query.phone,
          }).phoneNormalized ?? IMPOSSIBLE_PHONE_FILTER)
        : null;

      const filtered = rows.filter((row) => {
        if (normalizedQuery) {
          const matchesName = row.nameNormalized.includes(
            normalizedQuery.nameNormalized,
          );
          const matchesKana =
            normalizedQuery.kanaNormalized.length > 0 &&
            row.kanaNormalized.includes(normalizedQuery.kanaNormalized);
          if (!matchesName && !matchesKana) {
            return false;
          }
        }
        if (birthDateFilter !== null && row.birthDate !== birthDateFilter) {
          return false;
        }
        if (phoneFilter !== null && row.phone !== phoneFilter) {
          return false;
        }
        if (query.status && row.status !== query.status) {
          return false;
        }
        return true;
      });

      // 🔴 Intent: 一覧の既定並び順は要件に定めが無い。会員番号(登録順)の昇順を採る。
      const sorted = [...filtered].sort((a, b) =>
        a.memberNumber.localeCompare(b.memberNumber, undefined, {
          numeric: true,
        }),
      );

      const page = query.page && query.page > 0 ? query.page : DEFAULT_PAGE;
      const perPage = clampPerPage(query.perPage ?? DEFAULT_PER_PAGE);
      const start = (page - 1) * perPage;
      const pageRows = sorted.slice(start, start + perPage);

      return {
        items: pageRows.map(toMemberSummary),
        page,
        perPage,
        total: filtered.length,
      };
    },

    async listMatchCandidates() {
      const repos = repositories();
      const rows = await repos.matchCandidates.all();
      const unresolved = rows.filter((row) =>
        UNRESOLVED_MATCH_STATUSES.has(row.status),
      );
      return Promise.all(
        unresolved.map((row) => buildMatchCandidateView(repos, row)),
      );
    },

    async update(memberId, actor, input) {
      const repos = repositories();
      const member = await requireMember(memberId);

      const nextName = input.name ?? member.name;
      const nextNameKana =
        input.nameKana !== undefined ? input.nameKana : member.nameKana;
      const nextBirthDate =
        input.birthDate !== undefined ? input.birthDate : member.birthDate;
      const nextPhone = input.phone !== undefined ? input.phone : member.phone;

      // F-6-2: 編集時にnameNormalized/kanaNormalizedを再計算する。
      const normalized = normalizeMemberInput({
        birthDate: nextBirthDate,
        name: nextName,
        nameKana: nextNameKana,
        phone: nextPhone,
      });
      if (normalized.phoneNormalized === null) {
        throw validationError();
      }

      await repos.members.update(
        {
          address: emptyToNull(
            input.address !== undefined ? input.address : member.address,
          ),
          birthDate: normalized.birthDateNormalized,
          email: emptyToNull(
            input.email !== undefined ? input.email : member.email,
          ),
          kanaNormalized: normalized.kanaNormalized,
          name: nextName,
          nameKana: emptyToNull(nextNameKana),
          nameNormalized: normalized.nameNormalized,
          phone: normalized.phoneNormalized,
          postalCode: emptyToNull(
            input.postalCode !== undefined
              ? input.postalCode
              : member.postalCode,
          ),
          updatedById: actor.user.id,
        },
        whereFieldEquals("members", "id", memberId),
      );

      const updated = await requireMember(memberId);
      return buildMemberDetail(repos, updated);
    },
  } satisfies MemberService);
}
