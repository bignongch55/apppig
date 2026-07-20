// netlify/functions/lib/sheets.js
// ใช้ Google Sheets เป็นฐานข้อมูล — เก็บเมนู/โต๊ะ/ผู้ใช้ทุกคนของเว็บ/ออเดอร์ เป็น 4 แท็บในสเปรดชีตเดียว
// รูปภาพเมนูยังฝากไว้ที่ Netlify Blobs เหมือนเดิม (Sheets เก็บไฟล์ไบนารีโดยตรงไม่ได้) แล้วเก็บแค่ "ลิงก์รูป" ไว้ในคอลัมน์ image
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

const DEFAULT_MENU = [
  { id: "set1", name: "หมูกระทะเซ็ต (2 ท่าน)", price: 199, unit: "ชุด", category: "food", image: "" },
  { id: "pork", name: "หมูสามชั้น (จานเพิ่ม)", price: 89, unit: "จาน", category: "food", image: "" },
  { id: "veg", name: "ผักรวม (จานเพิ่ม)", price: 49, unit: "จาน", category: "food", image: "" },
  { id: "jaew", name: "แจ่วฮ้อน", price: 59, unit: "ถ้วย", category: "food", image: "" },
  { id: "water", name: "น้ำเปล่า", price: 15, unit: "ขวด", category: "drink", image: "" },
  { id: "pepsi", name: "เป๊ปซี่", price: 20, unit: "ขวด", category: "drink", image: "" },
  { id: "ice", name: "น้ำแข็ง", price: 10, unit: "ถุง", category: "drink", image: "" },
];
const DEFAULT_USERS = [{ username: "owner", password: "owner123", role: "owner" }];
const DEFAULT_TABLES = [1, 2, 3, 4];

let docPromise = null;

function getDoc() {
  if (!SHEET_ID || !SERVICE_EMAIL || !PRIVATE_KEY) {
    throw new Error(
      "ยังไม่ได้ตั้งค่า Google Sheet — ต้องตั้งตัวแปร GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY ใน Netlify ก่อน (ดูขั้นตอนใน README-NETLIFY.md)"
    );
  }
  if (!docPromise) {
    docPromise = (async () => {
      const auth = new JWT({
        email: SERVICE_EMAIL,
        key: PRIVATE_KEY,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      const doc = new GoogleSpreadsheet(SHEET_ID, auth);
      await doc.loadInfo();
      await ensureSheet(doc, "Menu", ["id", "name", "price", "unit", "category", "image"], DEFAULT_MENU);
      await ensureSheet(doc, "Tables", ["number"], DEFAULT_TABLES.map((n) => ({ number: n })));
      await ensureSheet(doc, "Users", ["username", "password", "role"], DEFAULT_USERS);
      await ensureSheet(doc, "Orders", ["id", "table", "items", "total", "status", "paid", "createdAt"], []);
      return doc;
    })().catch((e) => {
      docPromise = null; // ให้ลองเชื่อมใหม่ได้ในคำขอถัดไปถ้าครั้งนี้พลาด
      throw e;
    });
  }
  return docPromise;
}

async function ensureSheet(doc, title, headers, seed) {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await doc.addSheet({ title, headerValues: headers });
  }
  try {
    await sheet.loadHeaderRow();
  } catch {
    await sheet.setHeaderRow(headers);
  }
  if (seed.length) {
    const rows = await sheet.getRows();
    if (rows.length === 0) {
      await sheet.addRows(seed.map(toSheetRow));
    }
  }
  return sheet;
}

function toSheetRow(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return out;
}

async function sheetByTitle(title) {
  const doc = await getDoc();
  return doc.sheetsByTitle[title];
}

/* ---------------- เมนู ---------------- */
async function listMenu() {
  const sheet = await sheetByTitle("Menu");
  const rows = await sheet.getRows();
  return rows.map((r) => ({
    id: r.get("id"),
    name: r.get("name"),
    price: Number(r.get("price")) || 0,
    unit: r.get("unit") || "",
    category: r.get("category") || "food",
    image: r.get("image") || "",
  }));
}

async function addMenuItem(item) {
  const sheet = await sheetByTitle("Menu");
  await sheet.addRow(toSheetRow(item));
  return item;
}

async function updateMenuItem(id, patch) {
  const sheet = await sheetByTitle("Menu");
  const rows = await sheet.getRows();
  const row = rows.find((r) => r.get("id") === id);
  if (!row) return null;
  Object.entries(patch).forEach(([k, v]) => row.set(k, v === undefined || v === null ? "" : String(v)));
  await row.save();
  return { id, ...patch };
}

async function deleteMenuItem(id) {
  const sheet = await sheetByTitle("Menu");
  const rows = await sheet.getRows();
  const row = rows.find((r) => r.get("id") === id);
  if (row) await row.delete();
}

/* ---------------- โต๊ะ ---------------- */
async function listTables() {
  const sheet = await sheetByTitle("Tables");
  const rows = await sheet.getRows();
  return rows.map((r) => Number(r.get("number"))).sort((a, b) => a - b);
}

async function addTable(number) {
  const sheet = await sheetByTitle("Tables");
  await sheet.addRow({ number: String(number) });
}

async function deleteTable(number) {
  const sheet = await sheetByTitle("Tables");
  const rows = await sheet.getRows();
  const row = rows.find((r) => Number(r.get("number")) === Number(number));
  if (row) await row.delete();
}

/* ---------------- ผู้ใช้ทุกคนของเว็บ ---------------- */
async function listUsers() {
  const sheet = await sheetByTitle("Users");
  const rows = await sheet.getRows();
  return rows.map((r) => ({ username: r.get("username"), role: r.get("role") || "staff" }));
}

async function findUser(username, password) {
  const sheet = await sheetByTitle("Users");
  const rows = await sheet.getRows();
  const row = rows.find((r) => r.get("username") === username && r.get("password") === password);
  return row ? { username: row.get("username"), role: row.get("role") || "staff" } : null;
}

async function userExists(username) {
  const sheet = await sheetByTitle("Users");
  const rows = await sheet.getRows();
  return rows.some((r) => r.get("username") === username);
}

async function addUser(user) {
  const sheet = await sheetByTitle("Users");
  await sheet.addRow(toSheetRow(user));
}

async function deleteUser(username) {
  const sheet = await sheetByTitle("Users");
  const rows = await sheet.getRows();
  const row = rows.find((r) => r.get("username") === username);
  if (row) await row.delete();
}

/* ---------------- ออเดอร์ ---------------- */
function rowToOrder(r) {
  let items = [];
  try {
    items = JSON.parse(r.get("items") || "[]");
  } catch {
    items = [];
  }
  return {
    id: r.get("id"),
    table: Number(r.get("table")),
    items,
    total: Number(r.get("total")) || 0,
    status: r.get("status") || "pending",
    paid: String(r.get("paid")).toLowerCase() === "true",
    createdAt: r.get("createdAt"),
  };
}

async function listOrders() {
  const sheet = await sheetByTitle("Orders");
  const rows = await sheet.getRows();
  return rows.map(rowToOrder);
}

async function addOrder(order) {
  const sheet = await sheetByTitle("Orders");
  await sheet.addRow({
    id: order.id,
    table: String(order.table),
    items: JSON.stringify(order.items),
    total: String(order.total),
    status: order.status,
    paid: String(order.paid),
    createdAt: order.createdAt,
  });
  return order;
}

async function getOrderRow(sheet, id) {
  const rows = await sheet.getRows();
  return rows.find((r) => r.get("id") === id) || null;
}

async function updateOrder(id, patch) {
  const sheet = await sheetByTitle("Orders");
  const row = await getOrderRow(sheet, id);
  if (!row) return null;
  const current = rowToOrder(row);
  const next = { ...current, ...patch };
  row.set("table", String(next.table));
  row.set("items", JSON.stringify(next.items));
  row.set("total", String(next.total));
  row.set("status", next.status);
  row.set("paid", String(next.paid));
  await row.save();
  return next;
}

async function deleteOrderItem(id, itemIndex) {
  const sheet = await sheetByTitle("Orders");
  const row = await getOrderRow(sheet, id);
  if (!row) return null;
  const order = rowToOrder(row);
  if (itemIndex < 0 || itemIndex >= order.items.length) return null;
  order.items = order.items.filter((_, i) => i !== itemIndex);
  order.total = order.items.reduce((s, it) => s + Number(it.price || 0) * Number(it.qty || 0), 0);
  row.set("items", JSON.stringify(order.items));
  row.set("total", String(order.total));
  await row.save();
  return order;
}

async function closeBill(table) {
  const sheet = await sheetByTitle("Orders");
  const rows = await sheet.getRows();
  const unpaid = rows.filter(
    (r) => Number(r.get("table")) === Number(table) && String(r.get("paid")).toLowerCase() !== "true"
  );
  for (const row of unpaid) {
    row.set("paid", "true");
    await row.save();
  }
}

module.exports = {
  listMenu, addMenuItem, updateMenuItem, deleteMenuItem,
  listTables, addTable, deleteTable,
  listUsers, findUser, userExists, addUser, deleteUser,
  listOrders, addOrder, updateOrder, deleteOrderItem, closeBill,
};
