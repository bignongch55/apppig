/**
 * Code.gs — Backend ของระบบสั่งอาหารหมูกระทะ รันเป็น Google Apps Script Web App
 * ผูกกับ Google Sheet โดยตรง ไม่ต้องสร้าง Service Account / เปิด API เอง
 * วิธีติดตั้ง: ดู README-APPS-SCRIPT.md
 */

const SS = SpreadsheetApp.getActiveSpreadsheet();

const SHEETS = {
  MENU: { name: "Menu", headers: ["id", "name", "price", "unit", "category", "image"] },
  TABLES: { name: "Tables", headers: ["number"] },
  USERS: { name: "Users", headers: ["username", "password", "role"] },
  ORDERS: { name: "Orders", headers: ["id", "table", "items", "total", "status", "paid", "createdAt"] },
};

function getSheet_(key) {
  const def = SHEETS[key];
  let sheet = SS.getSheetByName(def.name);
  if (!sheet) {
    sheet = SS.insertSheet(def.name);
    sheet.appendRow(def.headers);
  }
  return sheet;
}

// สร้างข้อมูลเริ่มต้น (เมนู/โต๊ะ/ผู้ใช้) ถ้ายังไม่มีเลย — เรียกซ้ำได้อย่างปลอดภัย
function ensureSeed_() {
  const menu = getSheet_("MENU");
  if (menu.getLastRow() < 2) {
    [
      ["set1", "หมูกระทะเซ็ต (2 ท่าน)", 199, "ชุด", "food", ""],
      ["pork", "หมูสามชั้น (จานเพิ่ม)", 89, "จาน", "food", ""],
      ["veg", "ผักรวม (จานเพิ่ม)", 49, "จาน", "food", ""],
      ["jaew", "แจ่วฮ้อน", 59, "ถ้วย", "food", ""],
      ["water", "น้ำเปล่า", 15, "ขวด", "drink", ""],
      ["pepsi", "เป๊ปซี่", 20, "ขวด", "drink", ""],
      ["ice", "น้ำแข็ง", 10, "ถุง", "drink", ""],
    ].forEach((r) => menu.appendRow(r));
  }
  const users = getSheet_("USERS");
  if (users.getLastRow() < 2) users.appendRow(["owner", "owner123", "owner"]);
  const tables = getSheet_("TABLES");
  if (tables.getLastRow() < 2) [1, 2, 3, 4].forEach((n) => tables.appendRow([n]));
}

// อ่านทุกแถวของชีตเป็น array ของ object ตามหัวตาราง พร้อมเลขแถวจริง (__row) ไว้ใช้แก้/ลบ
function readRows_(key) {
  const sheet = getSheet_(key);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map((row, i) => {
    const obj = { __row: i + 2 };
    headers.forEach((h, idx) => (obj[h] = row[idx]));
    return obj;
  });
}

function writeRow_(key, rowNumber, obj, headers) {
  const sheet = getSheet_(key);
  const values = headers.map((h) => (obj[h] !== undefined ? obj[h] : ""));
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
}

function appendRow_(key, obj) {
  const def = SHEETS[key];
  const sheet = getSheet_(key);
  const values = def.headers.map((h) => (obj[h] !== undefined ? obj[h] : ""));
  sheet.appendRow(values);
}

function deleteRow_(key, rowNumber) {
  getSheet_(key).deleteRow(rowNumber);
}

function toMenuItem_(r) {
  return {
    id: String(r.id),
    name: r.name,
    price: Number(r.price) || 0,
    unit: r.unit || "",
    category: r.category || "food",
    image: r.image || "",
  };
}

function toOrder_(r) {
  let items = [];
  try {
    items = JSON.parse(r.items || "[]");
  } catch (e) {
    items = [];
  }
  return {
    id: String(r.id),
    table: Number(r.table),
    items: items,
    total: Number(r.total) || 0,
    status: r.status || "pending",
    paid: String(r.paid).toLowerCase() === "true",
    createdAt: r.createdAt,
    __row: r.__row,
  };
}

function stripRow_(o) {
  const c = Object.assign({}, o);
  delete c.__row;
  return c;
}

function ApiError_(status, message) {
  this.status = status;
  this.message = message;
}
ApiError_.prototype = Object.create(Error.prototype);

/* ---------------- อัปโหลดรูปภาพเมนู (เก็บที่ Google Drive) ---------------- */
function uploadImage_(body) {
  const data = body.data;
  if (!data || typeof data !== "string") throw new ApiError_(400, "ไม่พบข้อมูลรูปภาพ");
  const match = /^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/.exec(data);
  if (!match) throw new ApiError_(400, "รองรับเฉพาะไฟล์รูปภาพ (PNG, JPG, WEBP, GIF)");
  const mime = match[1];
  const base64 = match[3];
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > 5 * 1024 * 1024) throw new ApiError_(413, "ไฟล์รูปภาพใหญ่เกินไป (สูงสุด 5MB)");
  const blob = Utilities.newBlob(bytes, mime, "menu-image-" + Date.now());
  const folder = getOrCreateFolder_("moo-krata-menu-images");
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: "https://lh3.googleusercontent.com/d/" + file.getId() };
}

function getOrCreateFolder_(name) {
  const folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

/* ---------------- รายงานสรุปยอดขาย ---------------- */
function reportSummary_(from, to) {
  const fromDate = from ? from + "T00:00:00Z" : "1970-01-01T00:00:00Z";
  const toDate = to ? to + "T23:59:59Z" : "9999-12-31T23:59:59Z";
  const all = readRows_("ORDERS").map(toOrder_);
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
  const dailyRevenue = Object.keys(byDay).sort().map((date) => ({ date: date, revenue: byDay[date] }));
  const itemStats = {};
  paidOrders.forEach((o) => {
    (o.items || []).forEach((it) => {
      if (!itemStats[it.id]) itemStats[it.id] = { id: it.id, name: it.name, qty: 0, revenue: 0 };
      itemStats[it.id].qty += Number(it.qty || 0);
      itemStats[it.id].revenue += Number(it.price || 0) * Number(it.qty || 0);
    });
  });
  const topItems = Object.keys(itemStats).map((k) => itemStats[k]).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  return {
    totalRevenue: totalRevenue,
    pendingRevenue: pendingRevenue,
    paidOrderCount: paidOrders.length,
    pendingOrderCount: pendingOrders.length,
    avgOrderValue: paidOrders.length ? totalRevenue / paidOrders.length : 0,
    dailyRevenue: dailyRevenue,
    topItems: topItems,
  };
}

/* ---------------- Router: จำลอง REST endpoint เดิมทั้งหมดของ server.js ---------------- */
function route_(method, rawPath, body) {
  const path = rawPath.split("?")[0];
  const parts = path.split("/").filter(Boolean);
  const query = {};
  const qIdx = rawPath.indexOf("?");
  if (qIdx >= 0) {
    rawPath.slice(qIdx + 1).split("&").forEach((pair) => {
      const kv = pair.split("=");
      if (kv[0]) query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
    });
  }

  ensureSeed_();

  /* ---- เมนู ---- */
  if (parts[0] === "menu" && parts.length === 1) {
    if (method === "GET") return readRows_("MENU").map(toMenuItem_);
    if (method === "POST") {
      if (!body.name || body.price === undefined || body.price === "") {
        throw new ApiError_(400, "กรุณากรอกชื่อเมนูและราคา");
      }
      const item = {
        id: "item-" + Date.now(),
        name: body.name,
        price: Number(body.price),
        unit: body.unit || "",
        category: body.category || "food",
        image: body.image || "",
      };
      appendRow_("MENU", item);
      return item;
    }
  }
  if (parts[0] === "menu" && parts.length === 2) {
    const id = parts[1];
    const row = readRows_("MENU").find((r) => String(r.id) === id);
    if (method === "PUT") {
      if (!row) throw new ApiError_(404, "ไม่พบเมนูนี้");
      const next = {
        id: row.id,
        name: body.name !== undefined ? body.name : row.name,
        price: body.price !== undefined ? Number(body.price) : row.price,
        unit: body.unit !== undefined ? body.unit : row.unit,
        category: body.category !== undefined ? body.category : row.category,
        image: body.image !== undefined ? body.image : row.image,
      };
      writeRow_("MENU", row.__row, next, SHEETS.MENU.headers);
      return next;
    }
    if (method === "DELETE") {
      if (row) deleteRow_("MENU", row.__row);
      return { ok: true };
    }
  }

  /* ---- โต๊ะ ---- */
  if (parts[0] === "tables" && parts.length === 1) {
    if (method === "GET") return readRows_("TABLES").map((r) => Number(r.number)).sort((a, b) => a - b);
    if (method === "POST") {
      const existing = readRows_("TABLES").map((r) => Number(r.number));
      let number = body.number;
      if (number === undefined || number === null || number === "") {
        number = (existing.length ? Math.max.apply(null, existing) : 0) + 1;
      } else {
        number = Number(number);
      }
      if (!isFinite(number) || number <= 0) throw new ApiError_(400, "เลขโต๊ะไม่ถูกต้อง");
      if (existing.indexOf(number) !== -1) throw new ApiError_(409, "มีโต๊ะนี้อยู่แล้ว");
      appendRow_("TABLES", { number: number });
      return { tables: existing.concat([number]).sort((a, b) => a - b) };
    }
  }
  if (parts[0] === "tables" && parts.length === 2 && method === "DELETE") {
    const num = Number(parts[1]);
    const hasOpen = readRows_("ORDERS").map(toOrder_).some((o) => o.table === num && !o.paid);
    if (hasOpen) throw new ApiError_(409, "โต๊ะนี้ยังมีบิลค้างชำระอยู่ ปิดบิลก่อนจึงจะลบโต๊ะได้");
    const row = readRows_("TABLES").find((r) => Number(r.number) === num);
    if (row) deleteRow_("TABLES", row.__row);
    return { tables: readRows_("TABLES").map((r) => Number(r.number)).sort((a, b) => a - b) };
  }

  /* ---- อัปโหลดรูปภาพ ---- */
  if (parts[0] === "upload-image" && parts.length === 1 && method === "POST") {
    return uploadImage_(body);
  }

  /* ---- รายงาน ---- */
  if (parts[0] === "reports" && parts[1] === "summary") {
    return reportSummary_(query.from, query.to);
  }

  /* ---- ผู้ใช้ทุกคนของเว็บ ---- */
  if (parts[0] === "users" && parts.length === 1) {
    if (method === "GET") return readRows_("USERS").map((r) => ({ username: r.username, role: r.role || "staff" }));
    if (method === "POST") {
      if (!body.username || !body.password) throw new ApiError_(400, "กรอกชื่อผู้ใช้และรหัสผ่านให้ครบ");
      if (readRows_("USERS").some((r) => r.username === body.username)) throw new ApiError_(409, "มีชื่อผู้ใช้นี้อยู่แล้ว");
      appendRow_("USERS", { username: body.username, password: body.password, role: body.role || "staff" });
      return { username: body.username, role: body.role || "staff" };
    }
  }
  if (parts[0] === "users" && parts.length === 2 && method === "DELETE") {
    const row = readRows_("USERS").find((r) => r.username === decodeURIComponent(parts[1]));
    if (row) deleteRow_("USERS", row.__row);
    return { ok: true };
  }

  /* ---- เข้าสู่ระบบ ---- */
  if (parts[0] === "login" && method === "POST") {
    const row = readRows_("USERS").find((r) => r.username === body.username && String(r.password) === String(body.password));
    if (!row) throw new ApiError_(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
    return { username: row.username, role: row.role || "staff" };
  }

  /* ---- ออเดอร์ ---- */
  if (parts[0] === "orders" && parts[1] === "close-bill" && method === "POST") {
    readRows_("ORDERS")
      .filter((r) => Number(r.table) === Number(body.table) && String(r.paid).toLowerCase() !== "true")
      .forEach((r) => {
        r.paid = true;
        writeRow_("ORDERS", r.__row, r, SHEETS.ORDERS.headers);
      });
    return { ok: true };
  }
  if (parts[0] === "orders" && parts.length === 1) {
    if (method === "GET") return readRows_("ORDERS").map(toOrder_).map(stripRow_);
    if (method === "POST") {
      if (!body.table || !Array.isArray(body.items) || body.items.length === 0) {
        throw new ApiError_(400, "ข้อมูลออเดอร์ไม่ครบถ้วน");
      }
      const order = {
        id: Date.now() + "-" + Math.floor(Math.random() * 1000),
        table: Number(body.table),
        items: JSON.stringify(body.items),
        total: Number(body.total) || body.items.reduce((s, i) => s + i.price * i.qty, 0),
        status: "pending",
        paid: false,
        createdAt: new Date().toISOString(),
      };
      appendRow_("ORDERS", order);
      return stripRow_(toOrder_(Object.assign({}, order, { __row: 0 })));
    }
  }
  if (parts[0] === "orders" && parts.length === 2 && method === "PUT") {
    const row = readRows_("ORDERS").find((r) => String(r.id) === parts[1]);
    if (!row) throw new ApiError_(404, "ไม่พบออเดอร์นี้");
    const current = toOrder_(row);
    const next = Object.assign({}, current, body);
    writeRow_(
      "ORDERS",
      row.__row,
      { id: next.id, table: next.table, items: JSON.stringify(next.items), total: next.total, status: next.status, paid: next.paid, createdAt: next.createdAt },
      SHEETS.ORDERS.headers
    );
    return stripRow_(next);
  }
  if (parts[0] === "orders" && parts.length === 4 && parts[2] === "items" && method === "DELETE") {
    const row = readRows_("ORDERS").find((r) => String(r.id) === parts[1]);
    if (!row) throw new ApiError_(404, "ไม่พบออเดอร์หรือรายการอาหารนี้");
    const order = toOrder_(row);
    const idx = Number(parts[3]);
    if (idx < 0 || idx >= order.items.length) throw new ApiError_(404, "ไม่พบออเดอร์หรือรายการอาหารนี้");
    order.items = order.items.filter((_, i) => i !== idx);
    order.total = order.items.reduce((s, it) => s + Number(it.price || 0) * Number(it.qty || 0), 0);
    writeRow_(
      "ORDERS",
      row.__row,
      { id: order.id, table: order.table, items: JSON.stringify(order.items), total: order.total, status: order.status, paid: order.paid, createdAt: order.createdAt },
      SHEETS.ORDERS.headers
    );
    return stripRow_(order);
  }

  throw new ApiError_(404, "ไม่พบ endpoint นี้: " + method + " " + path);
}

/* ---------------- จุดเข้า Web App ---------------- */
function doGet(e) {
  return handle_("GET", e);
}
function doPost(e) {
  return handle_("POST", e);
}

function handle_(defaultMethod, e) {
  let method = defaultMethod;
  let path = "/";
  let body = {};
  try {
    if (defaultMethod === "GET") {
      path = (e && e.parameter && e.parameter.p) || "/";
    } else {
      const raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
      const payload = JSON.parse(raw);
      method = payload.method || "POST";
      path = payload.path || "/";
      body = payload.body || {};
    }
    const result = route_(method, path, body);
    return jsonOut_(result);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return jsonOut_({ error: message });
  }
}

// หมายเหตุ: Apps Script Web App ไม่สามารถกำหนด HTTP status code เองได้ (ตอบ 200 เสมอ)
// ฝั่งหน้าเว็บ (app.js) จึงเช็คว่าสำเร็จ/ผิดพลาดจากฟิลด์ "error" ใน JSON แทนการเช็ค HTTP status
function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
