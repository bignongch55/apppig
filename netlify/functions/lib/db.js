// netlify/functions/lib/db.js
// เชื่อมต่อ Netlify DB (Postgres บน Neon) — ตัวแปร NETLIFY_DATABASE_URL ถูกฉีดให้อัตโนมัติ
// เมื่อคุณเปิดใช้งาน Netlify Database ในโปรเจกต์ (เมนู "Database" ใน Netlify dashboard หรือ `netlify db init`)
const { neon } = require("@neondatabase/serverless");

const connectionString =
  process.env.NETLIFY_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgres://not-configured:not-configured@not-configured.neon.tech/not-configured";

if (!process.env.NETLIFY_DATABASE_URL && !process.env.DATABASE_URL) {
  console.warn(
    "⚠️ ไม่พบ NETLIFY_DATABASE_URL — ต้องเปิดใช้งาน Netlify Database ก่อน (ดู README-NETLIFY.md)"
  );
}

const sql = neon(connectionString);

const DEFAULT_MENU = [
  { id: "set1", name: "หมูกระทะเซ็ต (2 ท่าน)", unit: "ชุด", price: 199, category: "food", image: "" },
  { id: "pork", name: "หมูสามชั้น (จานเพิ่ม)", unit: "จาน", price: 89, category: "food", image: "" },
  { id: "veg", name: "ผักรวม (จานเพิ่ม)", unit: "จาน", price: 49, category: "food", image: "" },
  { id: "jaew", name: "แจ่วฮ้อน", unit: "ถ้วย", price: 59, category: "food", image: "" },
  { id: "water", name: "น้ำเปล่า", unit: "ขวด", price: 15, category: "drink", image: "" },
  { id: "pepsi", name: "เป๊ปซี่", unit: "ขวด", price: 20, category: "drink", image: "" },
  { id: "ice", name: "น้ำแข็ง", unit: "ถุง", price: 10, category: "drink", image: "" },
];
const DEFAULT_USERS = [{ username: "owner", password: "owner123", role: "owner" }];
const DEFAULT_TABLES = [1, 2, 3, 4];

let schemaReady = null;

// สร้างตาราง + ใส่ข้อมูลเริ่มต้น (เรียกครั้งเดียวตอน cold start ของ function, ทำซ้ำได้อย่างปลอดภัย)
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS restaurant_tables (
        number INTEGER PRIMARY KEY
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS menu_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price NUMERIC NOT NULL DEFAULT 0,
        unit TEXT DEFAULT '',
        category TEXT DEFAULT 'food',
        image TEXT DEFAULT ''
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS app_users (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'staff'
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        table_number INTEGER NOT NULL,
        items JSONB NOT NULL DEFAULT '[]',
        total NUMERIC NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        paid BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    const [{ count: menuCount }] = await sql`SELECT COUNT(*)::int AS count FROM menu_items`;
    if (Number(menuCount) === 0) {
      for (const m of DEFAULT_MENU) {
        await sql`
          INSERT INTO menu_items (id, name, price, unit, category, image)
          VALUES (${m.id}, ${m.name}, ${m.price}, ${m.unit}, ${m.category}, ${m.image})
          ON CONFLICT (id) DO NOTHING
        `;
      }
    }

    const [{ count: userCount }] = await sql`SELECT COUNT(*)::int AS count FROM app_users`;
    if (Number(userCount) === 0) {
      for (const u of DEFAULT_USERS) {
        await sql`
          INSERT INTO app_users (username, password, role)
          VALUES (${u.username}, ${u.password}, ${u.role})
          ON CONFLICT (username) DO NOTHING
        `;
      }
    }

    const [{ count: tableCount }] = await sql`SELECT COUNT(*)::int AS count FROM restaurant_tables`;
    if (Number(tableCount) === 0) {
      for (const t of DEFAULT_TABLES) {
        await sql`INSERT INTO restaurant_tables (number) VALUES (${t}) ON CONFLICT (number) DO NOTHING`;
      }
    }
  })();
  return schemaReady;
}

module.exports = { sql, ensureSchema };
