// netlify/functions/api.js
// เวอร์ชัน Google Sheets: API ทั้งหมดอ่าน/เขียนข้อมูล เมนู/โต๊ะ/ผู้ใช้/ออเดอร์ ลงใน Google Sheet
// รูปภาพเมนูเก็บที่ Netlify Blobs เหมือนเดิม แล้วเก็บลิงก์รูปไว้ในคอลัมน์ image ของชีต Menu
const express = require("express");
const serverless = require("serverless-http");
const { getStore } = require("@netlify/blobs");
const db = require("./lib/sheets");

const app = express();
app.use(express.json({ limit: "8mb" }));

const router = express.Router();

// ครอบทุก route ด้วย try/catch เพื่อดักข้อผิดพลาดจาก Google Sheets (เช่น ยังไม่ได้ตั้งค่า)
// แล้วตอบเป็นข้อความภาษาไทยที่เข้าใจง่าย แทนที่จะให้ function ล่มเฉยๆ
function ah(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์" });
    }
  };
}

/* ---------------- เมนู ---------------- */
router.get("/menu", ah(async (req, res) => {
  res.json(await db.listMenu());
}));

router.post("/menu", ah(async (req, res) => {
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
  await db.addMenuItem(item);
  res.status(201).json(item);
}));

router.put("/menu/:id", ah(async (req, res) => {
  const patch = {};
  ["name", "price", "unit", "category", "image"].forEach((k) => {
    if (req.body[k] !== undefined) patch[k] = k === "price" ? Number(req.body[k]) : req.body[k];
  });
  const updated = await db.updateMenuItem(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "ไม่พบเมนูนี้" });
  res.json(updated);
}));

router.delete("/menu/:id", ah(async (req, res) => {
  await db.deleteMenuItem(req.params.id);
  res.json({ ok: true });
}));

/* ---------------- โต๊ะ ---------------- */
router.get("/tables", ah(async (req, res) => {
  res.json(await db.listTables());
}));

router.post("/tables", ah(async (req, res) => {
  let { number } = req.body || {};
  const tables = await db.listTables();
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
  await db.addTable(number);
  res.status(201).json({ tables: [...tables, number].sort((a, b) => a - b) });
}));

router.delete("/tables/:number", ah(async (req, res) => {
  const num = Number(req.params.number);
  const orders = await db.listOrders();
  const hasOpen = orders.some((o) => o.table === num && !o.paid);
  if (hasOpen) {
    return res.status(409).json({ error: "โต๊ะนี้ยังมีบิลค้างชำระอยู่ ปิดบิลก่อนจึงจะลบโต๊ะได้" });
  }
  await db.deleteTable(num);
  res.json({ tables: await db.listTables() });
}));

/* ---------------- อัปโหลดรูปภาพเมนู (เก็บใน Netlify Blobs แทนดิสก์) ---------------- */
router.post("/upload-image", ah(async (req, res) => {
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
}));

/* ---------------- รายงานสรุปยอดขาย ---------------- */
router.get("/reports/summary", ah(async (req, res) => {
  const { from, to } = req.query || {};
  const fromDate = from ? `${from}T00:00:00Z` : "1970-01-01T00:00:00Z";
  const toDate = to ? `${to}T23:59:59Z` : "9999-12-31T23:59:59Z";

  const all = await db.listOrders();
  const inRange = all.filter((o) => o.createdAt >= fromDate && o.createdAt <= toDate);
  const paidOrders = inRange.filter((o) => o.paid);
  const pendingOrders = inRange.filter((o) => !o.paid);

  const totalRevenue = paidOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const pendingRevenue = pendingOrders.reduce((s, o) => s + Number(o.total || 0), 0);

  const byDay = {};
  paidOrders.forEach((o) => {
    const day = (o.createdAt || "").slice(0, 10);
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
}));

/* ---------------- ผู้ใช้ทุกคนของเว็บ ---------------- */
router.get("/users", ah(async (req, res) => {
  res.json(await db.listUsers());
}));

router.post("/users", ah(async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "กรอกชื่อผู้ใช้และรหัสผ่านให้ครบ" });
  if (await db.userExists(username)) return res.status(409).json({ error: "มีชื่อผู้ใช้นี้อยู่แล้ว" });
  await db.addUser({ username, password, role: role || "staff" });
  res.status(201).json({ username, role: role || "staff" });
}));

router.delete("/users/:username", ah(async (req, res) => {
  await db.deleteUser(req.params.username);
  res.json({ ok: true });
}));

router.post("/login", ah(async (req, res) => {
  const { username, password } = req.body || {};
  const user = await db.findUser(username, password);
  if (!user) return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
  res.json(user);
}));

/* ---------------- ออเดอร์ ---------------- */
router.get("/orders", ah(async (req, res) => {
  res.json(await db.listOrders());
}));

router.post("/orders", ah(async (req, res) => {
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
  await db.addOrder(order);
  res.status(201).json(order);
}));

router.put("/orders/:id", ah(async (req, res) => {
  const updated = await db.updateOrder(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "ไม่พบออเดอร์นี้" });
  res.json(updated);
}));

// ลบรายการอาหารรายการเดียวออกจากออเดอร์ (เช่น ลูกค้ายกเลิกรายการนั้น)
router.delete("/orders/:id/items/:index", ah(async (req, res) => {
  const itemIndex = Number(req.params.index);
  const updated = await db.deleteOrderItem(req.params.id, itemIndex);
  if (!updated) return res.status(404).json({ error: "ไม่พบออเดอร์หรือรายการอาหารนี้" });
  res.json(updated);
}));

router.post("/orders/close-bill", ah(async (req, res) => {
  const { table } = req.body || {};
  await db.closeBill(table);
  res.json({ ok: true });
}));

app.use("/api", router);
app.use("/", router); // เผื่อกรณี Netlify ส่ง path มาแบบตัด prefix ออกแล้ว

module.exports.handler = serverless(app);
