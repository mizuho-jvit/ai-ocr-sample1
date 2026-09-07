import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CreateMemberRequest,
  MemberListResponse,
  MemberStatus,
} from "../../worker/types/contracts";
import type { MembersApi } from "../api/members";
import { toErrorMessage } from "../api/members";
import { MEMBER_STATUS_LABELS } from "../labels";

export interface MemberListPageProps {
  api: Pick<MembersApi, "list" | "create">;
  onSelectMember: (memberId: string) => void;
}

const EMPTY_NEW_MEMBER: CreateMemberRequest = {
  address: "",
  birthDate: "",
  email: "",
  name: "",
  nameKana: "",
  phone: "",
  postalCode: "",
  status: "pending",
};

/** リクエスト送信時、任意項目の空文字は「未入力」として省く（送るとVALIDATION_ERRORになり得るため）。 */
function toCreateMemberRequest(form: CreateMemberRequest): CreateMemberRequest {
  return {
    address: form.address ? form.address : undefined,
    birthDate: form.birthDate ? form.birthDate : undefined,
    email: form.email ? form.email : undefined,
    name: form.name,
    nameKana: form.nameKana ? form.nameKana : undefined,
    phone: form.phone,
    postalCode: form.postalCode ? form.postalCode : undefined,
    status: form.status,
  };
}

/**
 * 🔴 Intent: `screen-list.md`は「会員一覧・検索」と「会員詳細」の2画面のみを定め、
 * 独立した「会員登録」画面を持たない。新規登録(F-5-1)はこの一覧画面内のトグル式フォームで行う
 * （申請詳細の名寄せ判断が専用画面を持たず統合されているのと同じ考え方・決定#2）。
 */
export function MemberListPage({ api, onSelectMember }: MemberListPageProps) {
  const [q, setQ] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<MemberStatus | "">("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<MemberListResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newMember, setNewMember] =
    useState<CreateMemberRequest>(EMPTY_NEW_MEMBER);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /** 🟡 Intent: コードレビュー指摘。条件変更のたびに新しい検索を発行するため、
   * 古い検索が遅れて完了しても最新の結果を上書きしないよう世代番号で判定する。 */
  const latestRequestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await api.list({
        birthDate: birthDate || undefined,
        page,
        phone: phone || undefined,
        q: q || undefined,
        status: status || undefined,
      });
      if (latestRequestIdRef.current !== requestId) {
        return;
      }
      setResult(response);
    } catch (error) {
      if (latestRequestIdRef.current !== requestId) {
        return;
      }
      setErrorMessage(toErrorMessage(error));
    } finally {
      if (latestRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [api, q, birthDate, phone, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    setIsCreating(true);
    setCreateError(null);
    try {
      await api.create(toCreateMemberRequest(newMember));
      setNewMember(EMPTY_NEW_MEMBER);
      setShowCreateForm(false);
      if (page !== 1) {
        setPage(1);
      } else {
        await load();
      }
    } catch (error) {
      setCreateError(toErrorMessage(error));
    } finally {
      setIsCreating(false);
    }
  }

  const totalPages = result
    ? Math.max(1, Math.ceil(result.total / result.perPage))
    : 1;

  return (
    <div className="goth member-list-page">
      <h2 className="serif page-heading">会員一覧・検索</h2>

      <div className="filter-bar">
        <label className="field-label filter-field">
          氏名・カナ
          <input
            aria-label="氏名・カナで検索"
            className="field-input"
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
            value={q}
          />
        </label>
        <label className="field-label filter-field">
          生年月日
          <input
            aria-label="生年月日で絞り込み"
            className="field-input"
            onChange={(event) => {
              setBirthDate(event.target.value);
              setPage(1);
            }}
            placeholder="1980-01-01"
            value={birthDate}
          />
        </label>
        <label className="field-label filter-field">
          電話番号
          <input
            aria-label="電話番号で絞り込み"
            className="field-input"
            onChange={(event) => {
              setPhone(event.target.value);
              setPage(1);
            }}
            value={phone}
          />
        </label>
        <label className="field-label filter-field">
          状態
          <select
            aria-label="状態で絞り込み"
            className="field-input"
            onChange={(event) => {
              setStatus(event.target.value as MemberStatus | "");
              setPage(1);
            }}
            value={status}
          >
            <option value="">すべて</option>
            {(Object.keys(MEMBER_STATUS_LABELS) as MemberStatus[]).map(
              (value) => (
                <option key={value} value={value}>
                  {MEMBER_STATUS_LABELS[value]}
                </option>
              ),
            )}
          </select>
        </label>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreateForm((current) => !current)}
          type="button"
        >
          {showCreateForm ? "登録フォームを閉じる" : "新規登録"}
        </button>
      </div>

      {showCreateForm && (
        <div className="card card-section" style={{ marginBottom: 14 }}>
          <h3 className="card-section-title">会員を新規登録</h3>
          {createError !== null && (
            <p className="alert" role="alert" style={{ marginBottom: 10 }}>
              {createError}
            </p>
          )}
          <div className="field-grid">
            <label className="field-label">
              氏名
              <input
                className="field-input"
                onChange={(event) =>
                  setNewMember((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                value={newMember.name}
              />
            </label>
            <label className="field-label">
              氏名カナ
              <input
                className="field-input"
                onChange={(event) =>
                  setNewMember((current) => ({
                    ...current,
                    nameKana: event.target.value,
                  }))
                }
                value={newMember.nameKana ?? ""}
              />
            </label>
            <label className="field-label">
              生年月日
              <input
                className="field-input"
                onChange={(event) =>
                  setNewMember((current) => ({
                    ...current,
                    birthDate: event.target.value,
                  }))
                }
                value={newMember.birthDate ?? ""}
              />
            </label>
            <label className="field-label">
              電話番号
              <input
                className="field-input"
                onChange={(event) =>
                  setNewMember((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
                value={newMember.phone}
              />
            </label>
            <label className="field-label">
              郵便番号
              <input
                className="field-input"
                onChange={(event) =>
                  setNewMember((current) => ({
                    ...current,
                    postalCode: event.target.value,
                  }))
                }
                value={newMember.postalCode ?? ""}
              />
            </label>
            <label className="field-label">
              住所
              <input
                className="field-input"
                onChange={(event) =>
                  setNewMember((current) => ({
                    ...current,
                    address: event.target.value,
                  }))
                }
                value={newMember.address ?? ""}
              />
            </label>
            <label className="field-label">
              メール
              <input
                className="field-input"
                onChange={(event) =>
                  setNewMember((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                value={newMember.email ?? ""}
              />
            </label>
            <label className="field-label">
              状態
              <select
                className="field-input"
                onChange={(event) =>
                  setNewMember((current) => ({
                    ...current,
                    status: event.target.value as MemberStatus,
                  }))
                }
                value={newMember.status}
              >
                {(Object.keys(MEMBER_STATUS_LABELS) as MemberStatus[]).map(
                  (value) => (
                    <option key={value} value={value}>
                      {MEMBER_STATUS_LABELS[value]}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          <button
            className="btn btn-primary"
            disabled={isCreating || !newMember.name || !newMember.phone}
            onClick={() => void handleCreate()}
            type="button"
          >
            登録する
          </button>
        </div>
      )}

      {errorMessage !== null && (
        <p className="alert" role="alert" style={{ marginBottom: 14 }}>
          {errorMessage}
        </p>
      )}

      {isLoading && (
        <p className="status-message" role="status">
          読み込んでいます…
        </p>
      )}

      {!isLoading && result !== null && (
        <>
          <div className="card" style={{ overflow: "hidden" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>会員番号</th>
                  <th>氏名</th>
                  <th>氏名カナ</th>
                  <th>状態</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.items.length === 0 && (
                  <tr>
                    <td className="table-empty-message" colSpan={5}>
                      該当する会員はいません。
                    </td>
                  </tr>
                )}
                {result.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.memberNumber}</td>
                    <td>{item.name}</td>
                    <td>{item.nameKana ?? ""}</td>
                    <td>{MEMBER_STATUS_LABELS[item.status]}</td>
                    <td>
                      <button
                        className="btn btn-ghost btn-small"
                        onClick={() => onSelectMember(item.id)}
                        type="button"
                      >
                        詳細
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination-bar">
            <button
              className="btn btn-ghost btn-small"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              type="button"
            >
              前へ
            </button>
            <span className="page-indicator">
              {page} / {totalPages}（全{result.total}件）
            </span>
            <button
              className="btn btn-ghost btn-small"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
              type="button"
            >
              次へ
            </button>
          </div>
        </>
      )}
    </div>
  );
}
