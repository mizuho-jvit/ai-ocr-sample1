import { useCallback, useEffect, useState } from "react";

import type {
  CreateStaffRequest,
  Role,
  StaffUserSummary,
  UpdateStaffRequest,
} from "../../worker/types/contracts";
import type { StaffApi } from "../api/staff";
import { toErrorMessage } from "../api/staff";
import { ROLE_LABELS } from "../labels";

export interface StaffPageProps {
  api: Pick<StaffApi, "list" | "create" | "update">;
}

const EMPTY_NEW_STAFF: CreateStaffRequest = {
  email: "",
  name: "",
  password: "",
  role: "staff",
};

interface EditForm {
  name: string;
  role: Role;
  isActive: boolean;
  password: string;
}

function toEditForm(staff: StaffUserSummary): EditForm {
  return {
    isActive: staff.isActive,
    name: staff.name,
    password: "",
    role: staff.role,
  };
}

/** 新しいパスワードが入力されていなければ、変更しない(空文字を送るとVALIDATION_ERRORになるため)。 */
function toUpdateStaffRequest(form: EditForm): UpdateStaffRequest {
  return {
    isActive: form.isActive,
    name: form.name,
    password: form.password ? form.password : undefined,
    role: form.role,
  };
}

/**
 * 🔴 Intent: `screen-list.md`は「スタッフ管理」の1画面のみを定め、独立した登録・詳細画面を持たない。
 * 会員一覧のトグル式登録フォームと同じ考え方で、一覧内の行編集(インライン)で編集を完結させる。
 */
export function StaffPage({ api }: StaffPageProps) {
  const [items, setItems] = useState<StaffUserSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newStaff, setNewStaff] = useState<CreateStaffRequest>(EMPTY_NEW_STAFF);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await api.list();
      setItems(result);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    setIsCreating(true);
    setCreateError(null);
    try {
      await api.create(newStaff);
      setNewStaff(EMPTY_NEW_STAFF);
      setShowCreateForm(false);
      await load();
    } catch (error) {
      setCreateError(toErrorMessage(error));
    } finally {
      setIsCreating(false);
    }
  }

  function handleStartEdit(staff: StaffUserSummary) {
    setEditingId(staff.id);
    setEditForm(toEditForm(staff));
    setSaveError(null);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setEditForm(null);
    setSaveError(null);
  }

  async function handleSave() {
    if (editingId === null || editForm === null) {
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await api.update(editingId, toUpdateStaffRequest(editForm));
      setEditingId(null);
      setEditForm(null);
      await load();
    } catch (error) {
      setSaveError(toErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="goth staff-page">
      <h2 className="serif page-heading">スタッフ管理</h2>

      <div className="filter-bar">
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
          <h3 className="card-section-title">スタッフを新規登録</h3>
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
                  setNewStaff((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                value={newStaff.name}
              />
            </label>
            <label className="field-label">
              メール
              <input
                className="field-input"
                onChange={(event) =>
                  setNewStaff((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                type="email"
                value={newStaff.email}
              />
            </label>
            <label className="field-label">
              パスワード
              <input
                className="field-input"
                onChange={(event) =>
                  setNewStaff((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                type="password"
                value={newStaff.password}
              />
            </label>
            <label className="field-label">
              ロール
              <select
                className="field-input"
                onChange={(event) =>
                  setNewStaff((current) => ({
                    ...current,
                    role: event.target.value as Role,
                  }))
                }
                value={newStaff.role}
              >
                {(Object.keys(ROLE_LABELS) as Role[]).map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="btn btn-primary"
            disabled={
              isCreating ||
              !newStaff.name ||
              !newStaff.email ||
              !newStaff.password
            }
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

      {!isLoading && (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>氏名</th>
                <th>メール</th>
                <th>ロール</th>
                <th>状態</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td className="table-empty-message" colSpan={5}>
                    スタッフが登録されていません。
                  </td>
                </tr>
              )}
              {items.map((staff) =>
                editingId === staff.id && editForm !== null ? (
                  <tr key={staff.id}>
                    <td>
                      <input
                        aria-label="氏名"
                        className="field-input"
                        onChange={(event) =>
                          setEditForm((current) =>
                            current
                              ? { ...current, name: event.target.value }
                              : current,
                          )
                        }
                        value={editForm.name}
                      />
                    </td>
                    <td>{staff.email}</td>
                    <td>
                      <select
                        aria-label="ロール"
                        className="field-input"
                        onChange={(event) =>
                          setEditForm((current) =>
                            current
                              ? {
                                  ...current,
                                  role: event.target.value as Role,
                                }
                              : current,
                          )
                        }
                        value={editForm.role}
                      >
                        {(Object.keys(ROLE_LABELS) as Role[]).map((value) => (
                          <option key={value} value={value}>
                            {ROLE_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <label className="field-label">
                        <input
                          checked={editForm.isActive}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? {
                                    ...current,
                                    isActive: event.target.checked,
                                  }
                                : current,
                            )
                          }
                          type="checkbox"
                        />
                        有効
                      </label>
                    </td>
                    <td>
                      <label className="field-label">
                        新パスワード
                        <input
                          aria-label="新パスワード"
                          className="field-input"
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? {
                                    ...current,
                                    password: event.target.value,
                                  }
                                : current,
                            )
                          }
                          placeholder="変更する場合のみ入力"
                          type="password"
                          value={editForm.password}
                        />
                      </label>
                      {saveError !== null && (
                        <p className="alert" role="alert">
                          {saveError}
                        </p>
                      )}
                      <button
                        className="btn btn-primary btn-small"
                        disabled={isSaving || !editForm.name}
                        onClick={() => void handleSave()}
                        type="button"
                      >
                        保存する
                      </button>
                      <button
                        className="btn btn-ghost btn-small"
                        disabled={isSaving}
                        onClick={handleCancelEdit}
                        type="button"
                      >
                        キャンセル
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={staff.id}>
                    <td>{staff.name}</td>
                    <td>{staff.email}</td>
                    <td>{ROLE_LABELS[staff.role]}</td>
                    <td>{staff.isActive ? "有効" : "無効化済み"}</td>
                    <td>
                      <button
                        className="btn btn-ghost btn-small"
                        onClick={() => handleStartEdit(staff)}
                        type="button"
                      >
                        編集
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
