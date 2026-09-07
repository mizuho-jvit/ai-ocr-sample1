import {
  type AppConfig,
  type SqlExpr,
  type TenantRow,
  toMemberId,
  toStaffUserId,
  toTenantId,
} from "../types";
import { insertTenantIfAbsent } from "./atomic-writes";
import {
  createTenantRepository,
  type TableRepository,
  whereFieldEquals,
} from "./repositories";
import type { members, staffUsers } from "./schema";

export const DEMO_TENANT_ID = toTenantId("01J60000000000000000000000");
export const DEMO_STAFF_USER_IDS = [
  toStaffUserId("01J60000000000000000000001"),
  toStaffUserId("01J60000000000000000000002"),
] as const;
export const DEMO_MEMBER_IDS = [
  toMemberId("01J60000000000000000000101"),
  toMemberId("01J60000000000000000000102"),
  toMemberId("01J60000000000000000000103"),
  toMemberId("01J60000000000000000000104"),
  toMemberId("01J60000000000000000000105"),
] as const;

const DEMO_TIMESTAMP = "2024-05-12T00:00:00+09:00";
const DEMO_ADMIN_PASSWORD_HASH =
  "pbkdf2-sha256$20000$ABEiM0RVZneImaq7zN3u/w==$anYoQl89K7Ongx74MssdzWnoV//fWYPD+vI15njLOTA=";
const DEMO_STAFF_PASSWORD_HASH =
  "pbkdf2-sha256$20000$/+7dzLuqmYh3ZlVEMyIRAA==$oUX9EIm4RqBiWzlOOFBFp42lDtHtg3jShiXsOw9yiHU=";

type StaffInsert = typeof staffUsers.$inferInsert;
type MemberInsert = typeof members.$inferInsert;

export const DEMO_TENANT = {
  code: "demo-organization",
  createdAt: DEMO_TIMESTAMP,
  id: DEMO_TENANT_ID,
  name: "デモ自治体",
  updatedAt: DEMO_TIMESTAMP,
} as const;

export const DEMO_STAFF: Omit<StaffInsert, "tenantId">[] = [
  {
    createdAt: DEMO_TIMESTAMP,
    createdById: null,
    email: "admin@example.com",
    failedLoginCount: 0,
    id: DEMO_STAFF_USER_IDS[0],
    isActive: true,
    lockedUntil: null,
    name: "管理 太郎",
    passwordHash: DEMO_ADMIN_PASSWORD_HASH,
    role: "admin",
    updatedAt: DEMO_TIMESTAMP,
    updatedById: null,
  },
  {
    createdAt: DEMO_TIMESTAMP,
    createdById: null,
    email: "staff@example.com",
    failedLoginCount: 0,
    id: DEMO_STAFF_USER_IDS[1],
    isActive: true,
    lockedUntil: null,
    name: "窓口 花子",
    passwordHash: DEMO_STAFF_PASSWORD_HASH,
    role: "staff",
    updatedAt: DEMO_TIMESTAMP,
    updatedById: null,
  },
];

const MEMBER_SOURCE = [
  {
    address: "東京都新宿区四谷3丁目",
    birthDate: "1980-01-01",
    kanaNormalized: "センダイイチロウ",
    name: "仙臺 一郎",
    nameKana: "センダイ イチロウ",
    nameNormalized: "仙台一郎",
    phone: "00011112222",
    postalCode: "160-0004",
  },
  {
    address: "宮城県仙台市青葉区中央1丁目",
    birthDate: "1992-11-03",
    kanaNormalized: "アオバハナコ",
    name: "青葉 花子",
    nameKana: "アオバ ハナコ",
    nameNormalized: "青葉花子",
    phone: "0220001111",
    postalCode: "980-0021",
  },
  {
    address: "東京都杉並区高円寺南2丁目",
    birthDate: "1975-06-21",
    kanaNormalized: "タカハシマコト",
    name: "高橋 誠",
    nameKana: "タカハシ マコト",
    nameNormalized: "高橋誠",
    phone: "0300002222",
    postalCode: "166-0003",
  },
  {
    address: "神奈川県横浜市中区本町4丁目",
    birthDate: "1988-03-30",
    kanaNormalized: "ワタナベユミ",
    name: "渡邊 由美",
    nameKana: "ワタナベ ユミ",
    nameNormalized: "渡辺由美",
    phone: "0450003333",
    postalCode: "231-0005",
  },
  {
    address: "千葉県船橋市本町7丁目",
    birthDate: "1969-12-08",
    kanaNormalized: "サトウケンジ",
    name: "佐藤 健二",
    nameKana: "サトウ ケンジ",
    nameNormalized: "佐藤健二",
    phone: "0470004444",
    postalCode: "273-0005",
  },
] as const;

export const DEMO_MEMBERS: Omit<MemberInsert, "tenantId">[] = MEMBER_SOURCE.map(
  (member, index) => ({
    ...member,
    createdAt: DEMO_TIMESTAMP,
    createdById: null,
    email: null,
    id: DEMO_MEMBER_IDS[index],
    isSeed: true,
    memberNumber: `M-${1001 + index}`,
    status: "active",
    updatedAt: DEMO_TIMESTAMP,
    updatedById: null,
  }),
);

async function insertIfMissing<
  Row extends TenantRow & { id: string },
  Insert extends TenantRow,
>(
  repository: TableRepository<Row, Insert>,
  values: Omit<Insert, "tenantId">,
  idExpression: SqlExpr,
): Promise<void> {
  if (await repository.findOne(idExpression)) {
    return;
  }
  try {
    await repository.insert(values);
  } catch (error) {
    // 複数の初期化処理が競合しても、同じ固定IDが作成済みなら成功として扱う。
    if (await repository.findOne(idExpression)) {
      return;
    }
    throw error;
  }
}

/**
 * 🔵 Intent: 固定IDを再利用し、既存のシード行を更新しない冪等な初期投入に限定する。
 */
export async function seedDemoData(
  database: D1Database,
  config: AppConfig,
): Promise<void> {
  if (config.tenantId !== DEMO_TENANT_ID) {
    throw new Error(
      `TENANT_ID must be ${DEMO_TENANT_ID} when seeding demo data`,
    );
  }

  await insertTenantIfAbsent(database, DEMO_TENANT);

  const repositories = createTenantRepository(database).forTenant(
    config.tenantId,
  );
  for (const staff of DEMO_STAFF) {
    await insertIfMissing(
      repositories.staffUsers,
      staff,
      whereFieldEquals("staff_users", "id", staff.id),
    );
  }
  for (const member of DEMO_MEMBERS) {
    await insertIfMissing(
      repositories.members,
      member,
      whereFieldEquals("members", "id", member.id),
    );
  }
}
