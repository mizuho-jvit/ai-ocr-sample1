INSERT OR IGNORE INTO tenants (id, code, name, created_at, updated_at)
VALUES ('01J60000000000000000000000', 'demo-organization', 'デモ自治体', '2024-05-12T00:00:00+09:00', '2024-05-12T00:00:00+09:00');

INSERT OR IGNORE INTO staff_users (id, tenant_id, email, password_hash, name, role, is_active, failed_login_count, locked_until, created_at, updated_at, created_by_id, updated_by_id)
VALUES ('01J60000000000000000000001', '01J60000000000000000000000', 'admin@example.com', 'pbkdf2-sha256$20000$ABEiM0RVZneImaq7zN3u/w==$anYoQl89K7Ongx74MssdzWnoV//fWYPD+vI15njLOTA=', '管理 太郎', 'admin', 1, 0, NULL, '2024-05-12T00:00:00+09:00', '2024-05-12T00:00:00+09:00', NULL, NULL);

INSERT OR IGNORE INTO staff_users (id, tenant_id, email, password_hash, name, role, is_active, failed_login_count, locked_until, created_at, updated_at, created_by_id, updated_by_id)
VALUES ('01J60000000000000000000002', '01J60000000000000000000000', 'staff@example.com', 'pbkdf2-sha256$20000$/+7dzLuqmYh3ZlVEMyIRAA==$oUX9EIm4RqBiWzlOOFBFp42lDtHtg3jShiXsOw9yiHU=', '窓口 花子', 'staff', 1, 0, NULL, '2024-05-12T00:00:00+09:00', '2024-05-12T00:00:00+09:00', NULL, NULL);

INSERT OR IGNORE INTO members (id, tenant_id, member_number, name, name_kana, name_normalized, kana_normalized, birth_date, postal_code, address, phone, email, status, is_seed, created_at, updated_at, created_by_id, updated_by_id)
VALUES ('01J60000000000000000000101', '01J60000000000000000000000', 'M-1001', '仙臺 一郎', 'センダイ イチロウ', '仙台一郎', 'センダイイチロウ', '1980-01-01', '160-0004', '東京都新宿区四谷3丁目', '00011112222', NULL, 'active', 1, '2024-05-12T00:00:00+09:00', '2024-05-12T00:00:00+09:00', NULL, NULL);

INSERT OR IGNORE INTO members (id, tenant_id, member_number, name, name_kana, name_normalized, kana_normalized, birth_date, postal_code, address, phone, email, status, is_seed, created_at, updated_at, created_by_id, updated_by_id)
VALUES ('01J60000000000000000000102', '01J60000000000000000000000', 'M-1002', '青葉 花子', 'アオバ ハナコ', '青葉花子', 'アオバハナコ', '1992-11-03', '980-0021', '宮城県仙台市青葉区中央1丁目', '0220001111', NULL, 'active', 1, '2024-05-12T00:00:00+09:00', '2024-05-12T00:00:00+09:00', NULL, NULL);

INSERT OR IGNORE INTO members (id, tenant_id, member_number, name, name_kana, name_normalized, kana_normalized, birth_date, postal_code, address, phone, email, status, is_seed, created_at, updated_at, created_by_id, updated_by_id)
VALUES ('01J60000000000000000000103', '01J60000000000000000000000', 'M-1003', '高橋 誠', 'タカハシ マコト', '高橋誠', 'タカハシマコト', '1975-06-21', '166-0003', '東京都杉並区高円寺南2丁目', '0300002222', NULL, 'active', 1, '2024-05-12T00:00:00+09:00', '2024-05-12T00:00:00+09:00', NULL, NULL);

INSERT OR IGNORE INTO members (id, tenant_id, member_number, name, name_kana, name_normalized, kana_normalized, birth_date, postal_code, address, phone, email, status, is_seed, created_at, updated_at, created_by_id, updated_by_id)
VALUES ('01J60000000000000000000104', '01J60000000000000000000000', 'M-1004', '渡邊 由美', 'ワタナベ ユミ', '渡辺由美', 'ワタナベユミ', '1988-03-30', '231-0005', '神奈川県横浜市中区本町4丁目', '0450003333', NULL, 'active', 1, '2024-05-12T00:00:00+09:00', '2024-05-12T00:00:00+09:00', NULL, NULL);

INSERT OR IGNORE INTO members (id, tenant_id, member_number, name, name_kana, name_normalized, kana_normalized, birth_date, postal_code, address, phone, email, status, is_seed, created_at, updated_at, created_by_id, updated_by_id)
VALUES ('01J60000000000000000000105', '01J60000000000000000000000', 'M-1005', '佐藤 健二', 'サトウ ケンジ', '佐藤健二', 'サトウケンジ', '1969-12-08', '273-0005', '千葉県船橋市本町7丁目', '0470004444', NULL, 'active', 1, '2024-05-12T00:00:00+09:00', '2024-05-12T00:00:00+09:00', NULL, NULL);
