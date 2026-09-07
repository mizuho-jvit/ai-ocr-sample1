import { useCallback, useEffect, useState } from "react";

import type { MemberDetail, MemberStatus } from "../../worker/types/contracts";
import type { ApplicationsApi } from "../api/applications";
import { applicationsApi } from "../api/applications";
import type { MembersApi } from "../api/members";
import { toErrorMessage } from "../api/members";
import { MEMBER_STATUS_LABELS } from "../labels";

export interface MemberDetailPageProps {
  api: Pick<MembersApi, "get" | "update" | "changeStatus">;
  imageApi?: Pick<ApplicationsApi, "imageUrl">;
  memberId: string;
  onBack: () => void;
}

interface EditForm {
  name: string;
  nameKana: string;
  birthDate: string;
  postalCode: string;
  address: string;
  phone: string;
  email: string;
}

function toEditForm(member: MemberDetail): EditForm {
  return {
    address: member.address ?? "",
    birthDate: member.birthDate ?? "",
    email: member.email ?? "",
    name: member.name,
    nameKana: member.nameKana ?? "",
    phone: member.phone ?? "",
    postalCode: member.postalCode ?? "",
  };
}

/** データベースへ保存されたISO日時を、余計な依存を増やさず簡潔に表示する。 */
function formatDateTime(value: string): string {
  return value.replace("T", " ").slice(0, 16);
}

/**
 * 🔵 Intent: `画面一覧`の「会員詳細」（F-5-1・F-5-6・F-5-7）を1画面へまとめる。
 * 編集・状態変更はそれぞれ専用APIへ委ね、成功のたびに`MemberDetail`を取り直して画面を最新化する
 * （application-detail-page.tsxと同じ方針）。
 */
export function MemberDetailPage({
  api,
  imageApi = applicationsApi,
  memberId,
  onBack,
}: MemberDetailPageProps) {
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [toStatus, setToStatus] = useState<MemberStatus>("active");
  const [reason, setReason] = useState("");
  const [isChangingStatus, setIsChangingStatus] = useState(false);

  const [imageUrlByApplicationId, setImageUrlByApplicationId] = useState<
    Record<string, string>
  >({});

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const detail = await api.get(memberId);
      setMember(detail);
      setForm(toEditForm(detail));
      setToStatus(detail.status);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [api, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    if (form === null) {
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const detail = await api.update(memberId, {
        address: form.address,
        birthDate: form.birthDate,
        email: form.email,
        name: form.name,
        nameKana: form.nameKana,
        phone: form.phone,
        postalCode: form.postalCode,
      });
      setMember(detail);
      setForm(toEditForm(detail));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleChangeStatus() {
    if (reason.trim().length === 0) {
      setErrorMessage("状態変更の理由を入力してください。");
      return;
    }
    setIsChangingStatus(true);
    setErrorMessage(null);
    try {
      const detail = await api.changeStatus(memberId, { reason, toStatus });
      setMember(detail);
      setReason("");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handleShowImage(applicationId: string) {
    try {
      const signed = await imageApi.imageUrl(applicationId);
      setImageUrlByApplicationId((current) => ({
        ...current,
        [applicationId]: signed.url,
      }));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }

  return (
    <div className="goth member-detail-page">
      <button
        className="btn btn-ghost btn-small"
        onClick={onBack}
        style={{ marginBottom: 14 }}
        type="button"
      >
        ← 一覧へ戻る
      </button>

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

      {!isLoading && member !== null && form !== null && (
        <>
          <h2 className="serif page-heading">
            {member.name}（会員番号: {member.memberNumber}） —{" "}
            {MEMBER_STATUS_LABELS[member.status]}
          </h2>

          <div className="section-stack">
            <div className="card card-section">
              <h3 className="card-section-title">会員情報</h3>
              <div className="field-grid">
                <label className="field-label">
                  氏名
                  <input
                    className="field-input"
                    onChange={(event) =>
                      setForm((current) =>
                        current
                          ? { ...current, name: event.target.value }
                          : current,
                      )
                    }
                    value={form.name}
                  />
                </label>
                <label className="field-label">
                  氏名カナ
                  <input
                    className="field-input"
                    onChange={(event) =>
                      setForm((current) =>
                        current
                          ? { ...current, nameKana: event.target.value }
                          : current,
                      )
                    }
                    value={form.nameKana}
                  />
                </label>
                <label className="field-label">
                  生年月日
                  <input
                    className="field-input"
                    onChange={(event) =>
                      setForm((current) =>
                        current
                          ? { ...current, birthDate: event.target.value }
                          : current,
                      )
                    }
                    value={form.birthDate}
                  />
                </label>
                <label className="field-label">
                  電話番号
                  <input
                    className="field-input"
                    onChange={(event) =>
                      setForm((current) =>
                        current
                          ? { ...current, phone: event.target.value }
                          : current,
                      )
                    }
                    value={form.phone}
                  />
                </label>
                <label className="field-label">
                  郵便番号
                  <input
                    className="field-input"
                    onChange={(event) =>
                      setForm((current) =>
                        current
                          ? { ...current, postalCode: event.target.value }
                          : current,
                      )
                    }
                    value={form.postalCode}
                  />
                </label>
                <label className="field-label">
                  住所
                  <input
                    className="field-input"
                    onChange={(event) =>
                      setForm((current) =>
                        current
                          ? { ...current, address: event.target.value }
                          : current,
                      )
                    }
                    value={form.address}
                  />
                </label>
                <label className="field-label">
                  メール
                  <input
                    className="field-input"
                    onChange={(event) =>
                      setForm((current) =>
                        current
                          ? { ...current, email: event.target.value }
                          : current,
                      )
                    }
                    value={form.email}
                  />
                </label>
              </div>
              <button
                className="btn btn-primary"
                disabled={isSaving || !form.name || !form.phone}
                onClick={() => void handleSave()}
                type="button"
              >
                保存する
              </button>
            </div>

            <div className="card card-section">
              <h3 className="card-section-title">状態変更</h3>
              <div className="field-grid">
                <label className="field-label">
                  変更後の状態
                  <select
                    className="field-input"
                    onChange={(event) =>
                      setToStatus(event.target.value as MemberStatus)
                    }
                    value={toStatus}
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
                <label className="field-label">
                  状態変更の理由
                  <input
                    className="field-input"
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="変更理由"
                    value={reason}
                  />
                </label>
              </div>
              <button
                className="btn btn-primary"
                disabled={isChangingStatus}
                onClick={() => void handleChangeStatus()}
                type="button"
              >
                変更する
              </button>
            </div>

            <div className="card card-section">
              <h3 className="card-section-title">申請履歴</h3>
              {member.applications.length === 0 && (
                <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>
                  申請履歴はありません。
                </p>
              )}
              {member.applications.map((application) => (
                <div
                  key={application.id}
                  style={{
                    alignItems: "center",
                    display: "flex",
                    fontSize: 13,
                    gap: 10,
                    padding: "6px 0",
                  }}
                >
                  <span>{formatDateTime(application.createdAt)}</span>
                  <span>{application.docType}</span>
                  {application.hasImage && (
                    <button
                      className="btn btn-ghost btn-small"
                      onClick={() => void handleShowImage(application.id)}
                      type="button"
                    >
                      原本を表示
                    </button>
                  )}
                  {imageUrlByApplicationId[application.id] && (
                    <a
                      href={imageUrlByApplicationId[application.id]}
                      rel="noreferrer"
                      target="_blank"
                    >
                      新しいタブで開く
                    </a>
                  )}
                </div>
              ))}
            </div>

            <div className="card card-section">
              <h3 className="card-section-title">状態遷移履歴</h3>
              {member.statusHistory.length === 0 && (
                <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>
                  状態変更の履歴はありません。
                </p>
              )}
              {member.statusHistory.map((entry) => (
                <div key={entry.id} style={{ fontSize: 13, padding: "6px 0" }}>
                  {formatDateTime(entry.createdAt)} —{" "}
                  {entry.fromStatus
                    ? MEMBER_STATUS_LABELS[entry.fromStatus]
                    : "—"}
                  {" → "}
                  {MEMBER_STATUS_LABELS[entry.toStatus]}
                  {entry.reason && `（${entry.reason}）`}（
                  {entry.createdBy.name}）
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
