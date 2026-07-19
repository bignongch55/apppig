// server.js — หมูกระทะ ระบบสั่งอาหาร (Node.js + Express)
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(__dirname, "public", "uploads");

app.use(express.json({ limit: "8mb" })); // เผื่อรูปภาพที่แปลงเป็น base64 ตอนอัปโหลด
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- ค่าเริ่มต้น ---------------- */
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
const DEFAULT_ORDERS = [];
const DEFAULT_TABLES = [1, 2, 3, 4];

const FILES = {
  menu: path.join(DATA_DIR, "menu.json"),
  users: path.join(DATA_DIR, "users.json"),
  orders: path.join(DATA_DIR, "orders.json"),
  tables: path.join(DATA_DIR, "tables.json"),
};

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(FILES.menu)) fs.writeFileSync(FILES.menu, JSON.stringify(DEFAULT_MENU, null, 2));
  if (!fs.existsSync(FILES.users)) fs.writeFileSync(FILES.users, JSON.stringify(DEFAULT_USERS, null, 2));
  if (!fs.existsSync(FILES.orders)) fs.writeFileSync(FILES.orders, JSON.stringify(DEFAULT_ORDERS, null, 2));
  if (!fs.existsSync(FILES.tables)) fs.writeFileSync(FILES.tables, JSON.stringify(DEFAULT_TABLES, null, 2));
}
ensureDataFiles();

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    return [];
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return data;
}

/* ---------------- เมนู ---------------- */
app.get("/api/menu", (req, res) => {
  res.json(readJSON(FILES.menu));
});

app.post("/api/menu", (req, res) => {
  const { name, price, unit, category, image } = req.body || {};
  if (!name || price === undefined || price === "") {
    return res.status(400).json({ error: "กรุณากรอกชื่อเมนูและราคา" });
  }
  const menu = readJSON(FILES.menu);
  const item = {
    id: `item-${Date.now()}`,
    name,
    price: Number(price),
    unit: unit || "",
    category: category || "food",
    image: image || "",
  };
  menu.push(item);
  writeJSON(FILES.menu, menu);
  res.status(201).json(item);
});

app.put("/api/menu/:id", (req, res) => {
  const menu = readJSON(FILES.menu);
  const idx = menu.findIndex((m) => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "ไม่พบเมนูนี้" });
  menu[idx] = { ...menu[idx], ...req.body, price: Number(req.body.price ?? menu[idx].price) };
  writeJSON(FILES.menu, menu);
  res.json(menu[idx]);
});

app.delete("/api/menu/:id", (req, res) => {
  const menu = readJSON(FILES.menu);
  const next = menu.filter((m) => m.id !== req.params.id);
  writeJSON(FILES.menu, next);
  res.json({ ok: true });
});

/* ---------------- โต๊ะ (เพิ่ม/ลบเองได้) ---------------- */
app.get("/api/tables", (req, res) => {
  res.json(readJSON(FILES.tables));
});

app.post("/api/tables", (req, res) => {
  const tables = readJSON(FILES.tables);
  let { number } = req.body || {};
  if (number === undefined || number === null || number === "") {
    // ไม่ระบุเลขโต๊ะ -> ใช้เลขถัดไปอัตโนมัติ
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
  tables.push(number);
  tables.sort((a, b) => a - b);
  writeJSON(FILES.tables, tables);
  res.status(201).json({ tables });
});

app.delete("/api/tables/:number", (req, res) => {
  const num = Number(req.params.number);
  const tables = readJSON(FILES.tables);
  const orders = readJSON(FILES.orders);
  const hasOpenOrders = orders.some((o) => o.table === num && !o.paid);
  if (hasOpenOrders) {
    return res.status(409).json({ error: "โต๊ะนี้ยังมีบิลค้างชำระอยู่ ปิดบิลก่อนจึงจะลบโต๊ะได้" });
  }
  const next = tables.filter((t) => t !== num);
  writeJSON(FILES.tables, next);
  res.json({ tables: next });
});

/* ---------------- อัปโหลดรูปภาพเมนูจากเครื่อง ---------------- */
app.post("/api/upload-image", (req, res) => {
  const { data, filename } = req.body || {};
  if (!data || typeof data !== "string") {
    return res.status(400).json({ error: "ไม่พบข้อมูลรูปภาพ" });
  }
  const match = /^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/.exec(data);
  if (!match) {
    return res.status(400).json({ error: "รองรับเฉพาะไฟล์รูปภาพ (PNG, JPG, WEBP, GIF)" });
  }
  const ext = match[2] === "jpeg" ? "jpg" : match[2];
  const base64 = match[3];
  const buffer = Buffer.from(base64, "base64");
  const MAX_BYTES = 5 * 1024 * 1024; // 5MB
  if (buffer.length > MAX_BYTES) {
    return res.status(413).json({ error: "ไฟล์รูปภาพใหญ่เกินไป (สูงสุด 5MB)" });
  }
  const safeBase = (filename || "menu-image").replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 40) || "menu-image";
  const outName = `${Date.now()}-${safeBase}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, outName), buffer);
  res.status(201).json({ url: `/uploads/${outName}` });
});

/* ---------------- รายงานสรุปยอดขาย ---------------- */
app.get("/api/reports/summary", (req, res) => {
  const { from, to } = req.query || {};
  const orders = readJSON(FILES.orders);

  const fromDate = from ? new Date(from + "T00:00:00") : null;
  const toDate = to ? new Date(to + "T23:59:59") : null;

  const inRange = orders.filter((o) => {
    const d = new Date(o.createdAt);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });

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
app.get("/api/users", (req, res) => {
  const users = readJSON(FILES.users);
  res.json(users.map((u) => ({ username: u.username, role: u.role })));
});

app.post("/api/users", (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "กรอกชื่อผู้ใช้และรหัสผ่านให้ครบ" });
  const users = readJSON(FILES.users);
  if (users.some((u) => u.username === username)) {
    return res.status(409).json({ error: "มีชื่อผู้ใช้นี้อยู่แล้ว" });
  }
  users.push({ username, password, role: role || "staff" });
  writeJSON(FILES.users, users);
  res.status(201).json({ username, role: role || "staff" });
});

app.delete("/api/users/:username", (req, res) => {
  const users = readJSON(FILES.users);
  const next = users.filter((u) => u.username !== req.params.username);
  writeJSON(FILES.users, next);
  res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const users = readJSON(FILES.users);
  const u = users.find((x) => x.username === username && x.password === password);
  if (!u) return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
  res.json({ username: u.username, role: u.role });
});

/* ---------------- ออเดอร์ ---------------- */
app.get("/api/orders", (req, res) => {
  res.json(readJSON(FILES.orders));
});

app.post("/api/orders", (req, res) => {
  const { table, items, total } = req.body || {};
  if (!table || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "ข้อมูลออเดอร์ไม่ครบถ้วน" });
  }
  const orders = readJSON(FILES.orders);
  const order = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    table,
    items,
    total: Number(total) || items.reduce((s, i) => s + i.price * i.qty, 0),
    status: "pending",
    paid: false,
    createdAt: new Date().toISOString(),
  };
  orders.push(order);
  writeJSON(FILES.orders, orders);
  res.status(201).json(order);
});

app.put("/api/orders/:id", (req, res) => {
  const orders = readJSON(FILES.orders);
  const idx = orders.findIndex((o) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "ไม่พบออเดอร์นี้" });
  orders[idx] = { ...orders[idx], ...req.body };
  writeJSON(FILES.orders, orders);
  res.json(orders[idx]);
});

app.post("/api/orders/close-bill", (req, res) => {
  const { table } = req.body || {};
  const orders = readJSON(FILES.orders);
  const next = orders.map((o) => (o.table === table && !o.paid ? { ...o, paid: true } : o));
  writeJSON(FILES.orders, next);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`🔥 ร้านหมูกระทะ กำลังทำงานที่ http://localhost:${PORT}`);
});
