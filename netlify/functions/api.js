// netlify/functions/api.js
// เวอร์ชัน Netlify: API เดิมทั้งหมดจาก server.js แต่เปลี่ยนที่เก็บข้อมูลจากไฟล์ .json
// มาเป็น Netlify Database (Postgres) และเก็บรูปภาพด้วย Netlify Blobs แทนดิสก์
// เพื่อไม่ให้ข้อมูล/รูปหายเวลา deploy ใหม่หรือ function เย็นตัวลง (cold start)
const express = require("express");
const serverless = require("serverless-http");
const { getStore } = require("@netlify/blobs");
const { sql, ensureSchema } = require("./lib/db");

const app = express();
app.use(express.json({ limit: "8mb" }));

// ทุก route ในไฟล์นี้จะถูก mount ที่ /api/* ผ่าน redirect ใน netlify.toml
const router = express.Router();

router.use(async (req, res, next) => {
  try {
    await ensureSchema();
    next();
  } catch (e) {
    console.error("DB schema error:", e);
    res.status(500).json({ error: "เชื่อมต่อฐานข้อมูลไม่ได้ ตรวจสอบว่าเปิดใช้งาน Netlify Database แล้วหรือยัง" });
  }
});

function rowToOrder(r) {
  return {
    id: r.id,
    table: r.table_number,
    items: r.items,
    total: Number(r.total),
    status: r.status,
    paid: r.paid,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

/* ---------------- เมนู ---------------- */
router.get("/menu", async (req, res) => {
  const rows = await sql`SELECT * FROM menu_items ORDER BY name`;
  res.json(rows.map((m) => ({ ...m, price: Number(m.price) })));
});

router.post("/menu", async (req, res) => {
  const { name, price, unit, category, image } = req.body || {};
  if (!name || price === undefined || price === "") {
    return res.status(400).json({ error: "กรุณากรอกชื่อเมนูและราคา" });
  }
  const item = {
    id: `item-${Date.now()}`,
    name,
    price: Number(price),
    unit: unit || "",
    category: category || "food",
    image: image || "",
  };
  await sql`
    INSERT INTO menu_items (id, name, price, unit, category, image)
    VALUES (${item.id}, ${item.name}, ${item.price}, ${item.unit}, ${item.category}, ${item.image})
  `;
  res.status(201).json(item);
});

router.put("/menu/:id", async (req, res) => {
  const existing = await sql`SELECT * FROM menu_items WHERE id = ${req.params.id}`;
  if (!existing.length) return res.status(404).json({ error: "ไม่พบเมนูนี้" });
  const cur = existing[0];
  const next = {
    name: req.body.name ?? cur.name,
    price: Number(req.body.price ?? cur.price),
    unit: req.body.unit ?? cur.unit,
    category: req.body.category ?? cur.category,
    image: req.body.image ?? cur.image,
  };
  await sql`
    UPDATE menu_items SET name=${next.name}, price=${next.price}, unit=${next.unit},
      category=${next.category}, image=${next.image} WHERE id=${req.params.id}
  `;
  res.json({ id: req.params.id, ...next });
});

router.delete("/menu/:id", async (req, res) => {
  await sql`DELETE FROM menu_items WHERE id = ${req.params.id}`;
  res.json({ ok: true });
});

/* ---------------- โต๊ะ ---------------- */
router.get("/tables", async (req, res) => {
  const rows = await sql`SELECT number FROM restaurant_tables ORDER BY number`;
  res.json(rows.map((r) => r.number));
});

router.post("/tables", async (req, res) => {
  let { number } = req.body || {};
  const existing = await sql`SELECT number FROM restaurant_tables ORDER BY number`;
  const tables = existing.map((r) => r.number);
  if (number === undefined || number === null || number === "") {
    number = (tables.length ? Math.max(...tables) : 0) + 1;
  } else {
    number = Number(number);
  }
  if (!Number.isFinite(number) || number <= 0) {
    return res.status(400).json({ error: "เลขโต๊ะไม่ถูกต้อง" });
  }
  if (tables.includes(number)) {
    return res.status(409).json({ error: "มีโต๊ะนี้อยู่แล้ว" });
  }
  await sql`INSERT INTO restaurant_tables (number) VALUES (${number})`;
  const next = [...tables, number].sort((a, b) => a - b);
  res.status(201).json({ tables: next });
});

router.delete("/tables/:number", async (req, res) => {
  const num = Number(req.params.number);
  const openOrders = await sql`
    SELECT id FROM orders WHERE table_number = ${num} AND paid = false LIMIT 1
  `;
  if (openOrders.length) {
    return res.status(409).json({ error: "โต๊ะนี้ยังมีบิลค้างชำระอยู่ ปิดบิลก่อนจึงจะลบโต๊ะได้" });
  }
  await sql`DELETE FROM restaurant_tables WHERE number = ${num}`;
  const rows = await sql`SELECT number FROM restaurant_tables ORDER BY number`;
  res.json({ tables: rows.map((r) => r.number) });
});

/* ---------------- อัปโหลดรูปภาพเมนู (เก็บใน Netlify Blobs แทนดิสก์) ---------------- */
router.post("/upload-image", async (req, res) => {
  const { data, filename } = req.body || {};
  if (!data || typeof data !== "string") {
    return res.status(400).json({ error: "ไม่พบข้อมูลรูปภาพ" });
  }
  const match = /^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/.exec(data);
  if (!match) {
    return res.status(400).json({ error: "รองรับเฉพาะไฟล์รูปภาพ (PNG, JPG, WEBP, GIF)" });
  }
  const mime = match[1];
  const ext = match[2] === "jpeg" ? "jpg" : match[2];
  const buffer = Buffer.from(match[3], "base64");
  const MAX_BYTES = 5 * 1024 * 1024;
  if (buffer.length > MAX_BYTES) {
    return res.status(413).json({ error: "ไฟล์รูปภาพใหญ่เกินไป (สูงสุด 5MB)" });
  }
  const safeBase = (filename || "menu-image").replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 40) || "menu-image";
  const key = `${Date.now()}-${safeBase}.${ext}`;
  const store = getStore("menu-images");
  await store.set(key, buffer, { metadata: { contentType: mime } });
  res.status(201).json({ url: `/uploads/${key}` });
});

/* ---------------- รายงานสรุปยอดขาย ---------------- */
router.get("/reports/summary", async (req, res) => {
  const { from, to } = req.query || {};
  const fromDate = from ? `${from}T00:00:00Z` : "1970-01-01T00:00:00Z";
  const toDate = to ? `${to}T23:59:59Z` : "9999-12-31T23:59:59Z";

  const rows = await sql`
    SELECT * FROM orders WHERE created_at >= ${fromDate} AND created_at <= ${toDate}
  `;
  const inRange = rows.map(rowToOrder);
  const paidOrders = inRange.filter((o) => o.paid);
  const pendingOrders = inRange.filter((o) => !o.paid);

  const totalRevenue = paidOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const pendingRevenue = pendingOrders.reduce((s, o) => s + Number(o.total || 0), 0);

  const byDay = {};
  paidOrders.forEach((o) => {
    const day = o.createdAt.slice(0, 10);
    byDay[day] = (byDay[day] || 0) + Number(o.total || 0);
  });
  const dailyRevenue = Object.entries(byDay)
    .map(([date, revenue]) => ({ date, revenue }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const itemStats = {};
  paidOrders.forEach((o) => {
    (o.items || []).forEach((it) => {
      if (!itemStats[it.id]) itemStats[it.id] = { id: it.id, name: it.name, qty: 0, revenue: 0 };
      itemStats[it.id].qty += Number(it.qty || 0);
      itemStats[it.id].revenue += Number(it.price || 0) * Number(it.qty || 0);
    });
  });
  const topItems = Object.values(itemStats).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  res.json({
    totalRevenue,
    pendingRevenue,
    paidOrderCount: paidOrders.length,
    pendingOrderCount: pendingOrders.length,
    avgOrderValue: paidOrders.length ? totalRevenue / paidOrders.length : 0,
    dailyRevenue,
    topItems,
  });
});

/* ---------------- ผู้ใช้งาน / เข้าสู่ระบบ ---------------- */
router.get("/users", async (req, res) => {
  const rows = await sql`SELECT username, role FROM app_users ORDER BY username`;
  res.json(rows);
});

router.post("/users", async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "กรอกชื่อผู้ใช้และรหัสผ่านให้ครบ" });
  const existing = await sql`SELECT username FROM app_users WHERE username = ${username}`;
  if (existing.length) return res.status(409).json({ error: "มีชื่อผู้ใช้นี้อยู่แล้ว" });
  await sql`INSERT INTO app_users (username, password, role) VALUES (${username}, ${password}, ${role || "staff"})`;
  res.status(201).json({ username, role: role || "staff" });
});

router.delete("/users/:username", async (req, res) => {
  await sql`DELETE FROM app_users WHERE username = ${req.params.username}`;
  res.json({ ok: true });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const rows = await sql`
    SELECT username, role FROM app_users WHERE username = ${username} AND password = ${password}
  `;
  if (!rows.length) return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
  res.json(rows[0]);
});

/* ---------------- ออเดอร์ ---------------- */
router.get("/orders", async (req, res) => {
  const rows = await sql`SELECT * FROM orders ORDER BY created_at`;
  res.json(rows.map(rowToOrder));
});

router.post("/orders", async (req, res) => {
  const { table, items, total } = req.body || {};
  if (!table || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "ข้อมูลออเดอร์ไม่ครบถ้วน" });
  }
  const order = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    table: Number(table),
    items,
    total: Number(total) || items.reduce((s, i) => s + i.price * i.qty, 0),
    status: "pending",
    paid: false,
    createdAt: new Date().toISOString(),
  };
  await sql`
    INSERT INTO orders (id, table_number, items, total, status, paid, created_at)
    VALUES (${order.id}, ${order.table}, ${JSON.stringify(order.items)}, ${order.total}, ${order.status}, ${order.paid}, ${order.createdAt})
  `;
  res.status(201).json(order);
});

router.put("/orders/:id", async (req, res) => {
  const rows = await sql`SELECT * FROM orders WHERE id = ${req.params.id}`;
  if (!rows.length) return res.status(404).json({ error: "ไม่พบออเดอร์นี้" });
  const cur = rowToOrder(rows[0]);
  const next = { ...cur, ...req.body };
  await sql`
    UPDATE orders SET table_number=${next.table}, items=${JSON.stringify(next.items)},
      total=${next.total}, status=${next.status}, paid=${next.paid} WHERE id=${req.params.id}
  `;
  res.json(next);
});

// ลบรายการอาหารรายการเดียวออกจากออเดอร์ (เช่น ลูกค้ายกเลิกรายการนั้น)
router.delete("/orders/:id/items/:index", async (req, res) => {
  const rows = await sql`SELECT * FROM orders WHERE id = ${req.params.id}`;
  if (!rows.length) return res.status(404).json({ error: "ไม่พบออเดอร์นี้" });
  const order = rowToOrder(rows[0]);
  const itemIndex = Number(req.params.index);
  if (!Array.isArray(order.items) || !Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= order.items.length) {
    return res.status(404).json({ error: "ไม่พบรายการอาหารนี้ในออเดอร์" });
  }
  order.items = order.items.filter((_, i) => i !== itemIndex);
  order.total = order.items.reduce((s, it) => s + Number(it.price || 0) * Number(it.qty || 0), 0);
  await sql`
    UPDATE orders SET items=${JSON.stringify(order.items)}, total=${order.total} WHERE id=${req.params.id}
  `;
  res.json(order);
});

router.post("/orders/close-bill", async (req, res) => {
  const { table } = req.body || {};
  await sql`UPDATE orders SET paid = true WHERE table_number = ${table} AND paid = false`;
  res.json({ ok: true });
});

app.use("/api", router);
app.use("/", router); // เผื่อกรณี Netlify ส่ง path มาแบบตัด prefix ออกแล้ว

module.exports.handler = serverless(app);
