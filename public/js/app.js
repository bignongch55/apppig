/* ==========================================================
   หมูกระทะ — Node.js ระบบสั่งอาหาร (frontend, vanilla JS)
   ========================================================== */
(function () {
  "use strict";

  const CATEGORIES = [
    { id: "food", label: "อาหาร", icon: "🍖" },
    { id: "drink", label: "เครื่องดื่ม", icon: "🥤" },
  ];
  const ROLES = [
    { id: "owner", label: "เจ้าของร้าน (ทุกสิทธิ์)" },
    { id: "manager", label: "ผู้จัดการ (ครัว+บิล+เมนู)" },
    { id: "staff", label: "พนักงานครัว (ครัวเท่านั้น)" },
  ];
  const ITEM_EMOJI = {
    set1: "🍖", pork: "🥓", veg: "🥬", jaew: "🍲",
    water: "💧", pepsi: "🥤", ice: "🧊",
  };

  const params = new URLSearchParams(window.location.search);
  const paramTable = parseInt(params.get("table"), 10);
  // สแกน QR แล้วมีเลขโต๊ะแนบมา -> ล็อกไว้ที่หน้าลูกค้าเลย ไม่ต้องรอโหลดรายชื่อโต๊ะจากเซิร์ฟเวอร์ก่อน
  const lockedTable = Number.isFinite(paramTable) && paramTable > 0 ? paramTable : null;

  const state = {
    mode: "customer",
    menu: [], users: [], orders: [], tables: [],
    session: null,
    table: lockedTable || null,
    cat: "food",
    cart: {},
    sent: false,
    myOrderIds: [],
    staffTab: "kitchen",
    billingTable: null,
    editingMenuId: null,
    menuDraft: {},
    newMenuItem: { name: "", price: "", unit: "", category: "food", image: "" },
    imageUploading: false,
    editImageUploading: false,
    newUser: { username: "", password: "", role: "staff" },
    userError: "",
    loginUsername: "", loginPassword: "", loginError: "", loginLoading: false,
    newTableError: "",
    reports: null, reportsFrom: "", reportsTo: "", reportsLoading: false,
  };

  /* ---------------- helpers ---------------- */
  function money(n) { return Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 0 }); }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function itemEmoji(m) { return ITEM_EMOJI[m.id] || (m.category === "drink" ? "🥤" : "🍖"); }
  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  }
  async function api(path, opts) {
    // กัน "หน้าค้าง" เวลาเซิร์ฟเวอร์ตอบช้าหรือไม่ตอบเลย: ตัดการเชื่อมต่อเองหลัง 12 วินาที
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    let res;
    try {
      res = await fetch("/api" + path, {
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        ...opts,
      });
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error("การเชื่อมต่อล้าช้าเกินไป กรุณาลองใหม่อีกครั้ง");
      }
      throw new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต");
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "เกิดข้อผิดพลาด");
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function isOnLoginScreen() {
    return !lockedTable && state.mode === "staff" && !state.session;
  }

  async function loadMenu() { state.menu = await api("/menu"); if (!isOnLoginScreen()) render(); }
  async function loadUsers() { state.users = await api("/users"); if (!isOnLoginScreen()) render(); }
  async function loadOrders() { state.orders = await api("/orders"); if (!isOnLoginScreen()) render(); }
  async function loadTables() {
    state.tables = await api("/tables");
    if (state.table === null && !lockedTable) state.table = state.tables[0] ?? null;
    if (state.billingTable === null) state.billingTable = state.tables[0] ?? null;
    if (!isOnLoginScreen()) render();
  }
  async function loadReports() {
    state.reportsLoading = true;
    render();
    const qs = new URLSearchParams();
    if (state.reportsFrom) qs.set("from", state.reportsFrom);
    if (state.reportsTo) qs.set("to", state.reportsTo);
    try {
      state.reports = await api("/reports/summary" + (qs.toString() ? `?${qs}` : ""));
    } catch (e) {
      console.error(e);
    } finally {
      state.reportsLoading = false;
      render();
    }
  }

  function statusMeta(status) {
    switch (status) {
      case "pending": return { label: "ออเดอร์ใหม่", cls: "flame-dim", next: "cooking", nextLabel: "เริ่มทำ", nextIcon: "🔥" };
      case "cooking": return { label: "กำลังทำ", cls: "flame-hot", next: "served", nextLabel: "เสิร์ฟแล้ว", nextIcon: "✅" };
      case "served": return { label: "เสิร์ฟแล้ว", cls: "flame-done", next: null, nextLabel: null, nextIcon: "" };
      default: return { label: status, cls: "flame-dim", next: null, nextLabel: null, nextIcon: "" };
    }
  }

  /* ---------------- root render ---------------- */
  const root = document.getElementById("app");

  function render() {
    root.innerHTML = `
      <div class="app-shell">
        ${renderBrandBar()}
        <div class="view-body">${renderCurrentView()}</div>
      </div>
    `;
    attachHandlers();
  }

  function renderBrandBar() {
    // สแกนจาก QR โค้ด (มีเลขโต๊ะแนบมากับลิงก์) -> ซ่อนส่วนสลับโหมด/แอดมินทั้งหมด โชว์แต่หน้าเมนูลูกค้า
    if (lockedTable) {
      return `
        <div class="brand-bar">
          <div class="brand-row">
            <div class="brand-id">
              <div class="brand-badge">🐷🔥</div>
              <div>
                <div class="brand-name">หมูกระทะ ร้านเรา</div>
                <div class="brand-sub">สั่งอาหารง่าย ๆ ผ่านมือถือ</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }
    return `
      <div class="brand-bar">
        <div class="brand-row">
          <div class="brand-id">
            <div class="brand-badge">🐷🔥</div>
            <div>
              <div class="brand-name">หมูกระทะ ร้านเรา</div>
              <div class="brand-sub">สั่งอาหารง่าย ๆ ผ่านมือถือ</div>
            </div>
          </div>
        </div>
        <div class="mode-pills no-print">
          <button class="pill ${state.mode === "customer" ? "pill-active" : ""}" data-mode="customer">🛒 หน้าลูกค้า</button>
          <button class="pill ${state.mode === "staff" ? "pill-active" : ""}" data-mode="staff">🔒 พนักงาน</button>
          <button class="pill ${state.mode === "qr" ? "pill-active" : ""}" data-mode="qr">📱 QR โต๊ะ</button>
        </div>
      </div>
    `;
  }

  function renderCurrentView() {
    // ล็อกโหมดลูกค้าไว้เสมอเมื่อมาจาก QR โค้ด ไม่ให้เข้าหน้าแอดมิน/พนักงานได้
    if (lockedTable) return renderCustomerView();
    if (state.mode === "customer") return renderCustomerView();
    if (state.mode === "qr") return renderQRView();
    if (state.mode === "staff") {
      return state.session ? renderStaffShell() : renderLoginView();
    }
    return "";
  }

  /* ---------------- CUSTOMER VIEW ---------------- */
  function cartItemsList() {
    return Object.entries(state.cart).map(([id, q]) => {
      const m = state.menu.find((x) => x.id === id);
      if (!m) return null;
      return { id, name: m.name, unit: m.unit, price: m.price, qty: q };
    }).filter(Boolean);
  }

  function renderCustomerView() {
    const items = state.menu.filter((m) => m.category === state.cat);
    const cartItems = cartItemsList();
    const cartTotal = cartItems.reduce((s, i) => s + i.price * i.qty, 0);
    const myOrders = state.orders.filter((o) => state.myOrderIds.includes(o.id));
    const myGrandTotal = myOrders.reduce((s, o) => s + o.total, 0);

    return `
      <div class="customer-view">
        <span class="table-badge">👥 โต๊ะ ${state.table ?? "-"}</span>
        ${!lockedTable ? `
          <div class="table-select no-print">
            <span>เลือกโต๊ะ (เดโม):</span>
            ${state.tables.length ? state.tables.map((t) => `<button class="table-chip ${t === state.table ? "table-chip-active" : ""}" data-table="${t}">${t}</button>`).join("") : `<span>ยังไม่มีโต๊ะ กรุณาตั้งค่าที่หน้าพนักงาน</span>`}
          </div>` : ""}

        <div class="divider-sizzle"></div>
        <h1 class="view-title">เมนูร้าน</h1>
        <p class="view-sub">เลือกหมวดหมู่ เลือกเมนู แล้วกดส่งออเดอร์</p>

        <div class="cat-tabs">
          ${CATEGORIES.map((c) => `<button class="cat-tab ${state.cat === c.id ? "cat-tab-active" : ""}" data-cat="${c.id}">${c.icon} ${c.label}</button>`).join("")}
        </div>

        <div class="menu-grid">
          ${items.length ? items.map((m) => {
            const q = state.cart[m.id] || 0;
            return `
              <div class="menu-card">
                <div class="menu-img">${m.image ? `<img src="${esc(m.image)}" alt="${esc(m.name)}"/>` : itemEmoji(m)}</div>
                <div class="menu-card-top">
                  <span class="menu-name">${esc(m.name)}</span>
                  <span class="menu-price">฿${money(m.price)}</span>
                </div>
                <div class="menu-card-bottom">
                  <span class="menu-unit">ต่อ${esc(m.unit)}</span>
                  <div class="stepper">
                    <button data-qty="-1" data-id="${m.id}" ${q === 0 ? "disabled" : ""}>−</button>
                    <span class="stepper-qty">${q}</span>
                    <button class="add" data-qty="1" data-id="${m.id}">+</button>
                  </div>
                </div>
              </div>`;
          }).join("") : `<p class="empty-note">ยังไม่มีเมนูในหมวดนี้</p>`}
        </div>

        ${myOrders.length ? `
          <div class="my-orders">
            <h2 class="my-orders-title">รายการที่สั่งไปแล้ว</h2>
            ${myOrders.map((o) => `
              <div class="my-order-card">
                <div class="my-order-head">
                  <span>${fmtTime(o.createdAt)}</span>
                  <span class="status-pill ${statusMeta(o.status).cls}">${statusMeta(o.status).label}</span>
                </div>
                ${o.items.map((it) => `<div class="my-order-line"><span>${esc(it.name)} x${it.qty}</span><span>฿${money(it.price * it.qty)}</span></div>`).join("")}
              </div>`).join("")}
            <div class="my-order-total"><span>ยอดรวมทั้งหมด</span><span>฿${money(myGrandTotal)}</span></div>
          </div>` : ""}
      </div>

      <div class="cart-bar no-print">
        <div class="cart-info">
          <span class="cart-count">${cartItems.reduce((s, i) => s + i.qty, 0)} รายการ</span>
          <span class="cart-total">฿${money(cartTotal)}</span>
        </div>
        <button class="btn-send" id="submitOrderBtn" ${cartItems.length === 0 || !state.table ? "disabled" : ""}>🔥 ส่งออเดอร์</button>
      </div>
      ${state.sent ? `<div class="toast">ส่งออเดอร์แล้ว! กำลังรอครัวทำ 🔥</div>` : ""}
    `;
  }

  async function submitOrder() {
    const cartItems = cartItemsList();
    if (cartItems.length === 0) return;
    const total = cartItems.reduce((s, i) => s + i.price * i.qty, 0);
    try {
      const order = await api("/orders", { method: "POST", body: JSON.stringify({ table: state.table, items: cartItems, total }) });
      state.myOrderIds.push(order.id);
      state.cart = {};
      state.sent = true;
      await loadOrders();
      setTimeout(() => { state.sent = false; render(); }, 2200);
    } catch (e) {
      alert(e.message);
    }
  }

  /* ---------------- QR VIEW ---------------- */
  function renderQRView() {
    const base = window.location.href.split("?")[0];
    return `
      <h1 class="view-title">📱 QR สำหรับแปะโต๊ะ</h1>
      <div class="divider-sizzle"></div>
      <p class="empty-note wide qr-note">ลิงก์นี้อ้างอิงหน้าปัจจุบัน เมื่อนำแอปไปเผยแพร่ในโดเมนจริงแล้ว ให้สร้าง QR จากโดเมนนั้นแปะที่โต๊ะแทน</p>
      <div class="qr-grid">
        ${state.tables.length ? state.tables.map((t) => {
          const url = `${base}?table=${t}`;
          const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
          return `<div class="qr-card"><img src="${qrImg}" alt="QR โต๊ะ ${t}" width="140" height="140"/><span class="qr-table">โต๊ะ ${t}</span><span class="qr-url">${esc(url)}</span></div>`;
        }).join("") : `<p class="empty-note wide">ยังไม่มีโต๊ะ ไปเพิ่มโต๊ะที่หน้าพนักงาน &gt; จัดการโต๊ะ ก่อน</p>`}
      </div>
      <p class="empty-note wide qr-note">เมื่อลูกค้าสแกน QR ของโต๊ะแล้ว ระบบจะพาไปหน้าเมนูของลูกค้าทันที โดยไม่แสดงส่วนของแอดมิน/พนักงาน</p>
    `;
  }

  /* ---------------- LOGIN ---------------- */
  function renderLoginView() {
    return `
      <div class="login-wrap">
        <div class="login-card">
          <span class="login-icon">🔒</span>
          <h1 class="view-title">เข้าสู่ระบบพนักงาน</h1>
          <input class="in" id="loginUsername" placeholder="ชื่อผู้ใช้" value="${esc(state.loginUsername)}" ${state.loginLoading ? "disabled" : ""} />
          <input class="in" id="loginPassword" type="password" placeholder="รหัสผ่าน" value="${esc(state.loginPassword)}" ${state.loginLoading ? "disabled" : ""} />
          <button class="btn-send" style="justify-content:center;width:100%;" id="loginSubmit" ${state.loginLoading ? "disabled" : ""}>
            ${state.loginLoading ? "⏳ กำลังเข้าสู่ระบบ..." : "➡️ เข้าสู่ระบบ"}
          </button>
          ${state.loginError ? `<p class="form-error">${esc(state.loginError)}</p>` : ""}
          <p class="login-hint">ครั้งแรกใช้ผู้ใช้ทดสอบ: owner / owner123 (แนะนำให้เปลี่ยนทันทีในหน้าจัดการผู้ใช้งาน)</p>
        </div>
      </div>
    `;
  }

  async function doLogin() {
    if (state.loginLoading) return; // กันกดซ้ำจนดูเหมือนหน้าค้าง
    if (!state.loginUsername || !state.loginPassword) {
      state.loginError = "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน";
      render();
      return;
    }
    state.loginLoading = true;
    state.loginError = "";
    render();
    try {
      const u = await api("/login", { method: "POST", body: JSON.stringify({ username: state.loginUsername, password: state.loginPassword }) });
      state.session = u;
      state.loginError = "";
      state.loginUsername = ""; state.loginPassword = "";
      state.loginLoading = false;
      await Promise.all([loadMenu(), loadUsers(), loadOrders(), loadTables()]);
      render();
    } catch (e) {
      state.loginLoading = false;
      state.loginError = e.message;
      render();
    }
  }

  /* ---------------- STAFF SHELL ---------------- */
  function renderStaffShell() {
    const tabs = [{ id: "kitchen", label: "ครัว", icon: "👨‍🍳" }];
    if (state.session.role === "owner" || state.session.role === "manager") {
      tabs.push(
        { id: "billing", label: "เช็คบิล", icon: "🧾" },
        { id: "reports", label: "สรุปยอดขาย", icon: "📊" },
        { id: "menu", label: "จัดการเมนู", icon: "⚙️" },
        { id: "tables", label: "จัดการโต๊ะ", icon: "🪑" }
      );
    }
    if (state.session.role === "owner") tabs.push({ id: "users", label: "ผู้ใช้งาน", icon: "🛡️" });

    return `
      <div class="staff-topbar no-print">
        <div class="staff-tabs">
          ${tabs.map((t) => `<button class="pill ${state.staffTab === t.id ? "pill-active" : ""}" data-stab="${t.id}">${t.icon} ${t.label}</button>`).join("")}
        </div>
        <div class="staff-user">
          <span>${esc(state.session.username)} · ${esc(ROLES.find((r) => r.id === state.session.role)?.label || "")}</span>
          <button class="btn-ghost" id="logoutBtn">🚪 ออกจากระบบ</button>
        </div>
      </div>
      ${state.staffTab === "kitchen" ? renderKitchenView() : ""}
      ${state.staffTab === "billing" ? renderBillingView() : ""}
      ${state.staffTab === "reports" ? renderReportsView() : ""}
      ${state.staffTab === "menu" ? renderMenuManageView() : ""}
      ${state.staffTab === "tables" ? renderTablesManageView() : ""}
      ${state.staffTab === "users" ? renderUsersManageView() : ""}
    `;
  }

  /* ---------------- KITCHEN ---------------- */
  function renderKitchenView() {
    const active = state.orders.filter((o) => o.status !== "served" || !o.paid);
    const sorted = [...active].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return `
      <div class="kitchen-head">
        <h1 class="view-title">👨‍🍳 ออเดอร์เข้าครัว</h1>
        <button class="btn-refresh no-print" id="refreshOrders">🔄 รีเฟรช</button>
      </div>
      <div class="divider-sizzle"></div>
      ${sorted.length === 0 ? `<p class="empty-note wide">ยังไม่มีออเดอร์เข้ามา — เตาว่าง รอลูกค้าสั่ง</p>` : ""}
      <div class="ticket-grid">
        ${sorted.map((o) => {
          const meta = statusMeta(o.status);
          return `
            <div class="ticket ${meta.cls}">
              <div class="ticket-head"><span>โต๊ะ ${o.table}</span><span class="ticket-time">${fmtTime(o.createdAt)}</span></div>
              <ul class="ticket-items">${o.items.map((it) => `<li><span>${esc(it.name)}</span><span>x${it.qty}</span></li>`).join("")}</ul>
              <div class="ticket-foot">
                <span class="status-pill ${meta.cls}">🔥 ${meta.label}</span>
                ${meta.next ? `<button class="btn-advance" data-advance="${o.id}">${meta.nextIcon} ${meta.nextLabel}</button>` : ""}
              </div>
            </div>`;
        }).join("")}
      </div>
    `;
  }

  async function advanceOrder(id) {
    const o = state.orders.find((x) => x.id === id);
    const meta = statusMeta(o.status);
    if (!meta.next) return;
    await api(`/orders/${id}`, { method: "PUT", body: JSON.stringify({ status: meta.next }) });
    await loadOrders();
  }

  /* ---------------- BILLING ---------------- */
  function renderBillingView() {
    const table = state.billingTable;
    const tableOrders = state.orders.filter((o) => o.table === table && !o.paid);
    const total = tableOrders.reduce((s, o) => s + o.total, 0);
    const merged = {};
    tableOrders.flatMap((o) => o.items).forEach((it) => {
      if (!merged[it.id]) merged[it.id] = { ...it }; else merged[it.id].qty += it.qty;
    });
    const lines = Object.values(merged);
    return `
      <h1 class="view-title">🧾 เช็คบิล</h1>
      <div class="divider-sizzle"></div>
      <div class="table-select no-print">
        <span>เลือกโต๊ะ:</span>
        ${state.tables.map((t) => `<button class="table-chip ${t === table ? "table-chip-active" : ""}" data-billtable="${t}">${t}</button>`).join("")}
        <button class="btn-refresh" id="refreshBilling">🔄</button>
      </div>
      ${lines.length === 0 ? `<p class="empty-note wide">โต๊ะ ${table} ยังไม่มีบิลค้างชำระ</p>` : `
        <div class="receipt-wrap">
          <div class="receipt">
            <div class="receipt-head">
              <div class="receipt-shop">หมูกระทะ ร้านเรา</div>
              <div class="receipt-sub">ใบสรุปรายการ · โต๊ะ ${table}</div>
              <div class="receipt-sub">${new Date().toLocaleString("th-TH")}</div>
            </div>
            <div class="receipt-dash"></div>
            <div class="receipt-lines">${lines.map((it) => `<div class="receipt-line"><span>${esc(it.name)}</span><span>x${it.qty}</span><span>฿${money(it.price * it.qty)}</span></div>`).join("")}</div>
            <div class="receipt-dash"></div>
            <div class="receipt-total"><span>ยอดรวม</span><span>฿${money(total)}</span></div>
            <div class="receipt-foot">ขอบคุณที่ใช้บริการค่ะ 🔥</div>
          </div>
        </div>
        <div class="billing-actions no-print">
          <button class="btn-refresh" id="printBill">🖨️ พิมพ์สลิป</button>
          <button class="btn-send" id="closeBill">✅ ปิดบิล</button>
        </div>`}
    `;
  }

  async function closeBill() {
    await api("/orders/close-bill", { method: "POST", body: JSON.stringify({ table: state.billingTable }) });
    await loadOrders();
  }

  /* ---------------- รายงานสรุปยอดขาย ---------------- */
  function renderReportsView() {
    const r = state.reports;
    const maxDaily = r && r.dailyRevenue.length ? Math.max(...r.dailyRevenue.map((d) => d.revenue)) : 0;
    return `
      <div class="kitchen-head">
        <h1 class="view-title">📊 สรุปยอดขาย</h1>
        <button class="btn-refresh no-print" id="refreshReports">🔄 รีเฟรช</button>
      </div>
      <div class="divider-sizzle"></div>
      <div class="form-grid no-print" style="margin-bottom:16px;">
        <label class="report-date-label">จากวันที่ <input class="in in-sm" type="date" id="reportsFrom" value="${esc(state.reportsFrom)}" /></label>
        <label class="report-date-label">ถึงวันที่ <input class="in in-sm" type="date" id="reportsTo" value="${esc(state.reportsTo)}" /></label>
        <button class="btn-send" id="applyReportsRange">🔍 ดูรายงาน</button>
      </div>
      ${state.reportsLoading ? `<p class="empty-note wide">กำลังโหลดข้อมูล...</p>` : !r ? `<p class="empty-note wide">ไม่มีข้อมูล</p>` : `
        <div class="report-cards">
          <div class="report-card">
            <span class="report-card-label">ยอดขายรวม (บิลที่ปิดแล้ว)</span>
            <span class="report-card-value">฿${money(r.totalRevenue)}</span>
          </div>
          <div class="report-card">
            <span class="report-card-label">จำนวนบิลที่ปิดแล้ว</span>
            <span class="report-card-value">${money(r.paidOrderCount)}</span>
          </div>
          <div class="report-card">
            <span class="report-card-label">ยอดเฉลี่ยต่อบิล</span>
            <span class="report-card-value">฿${money(Math.round(r.avgOrderValue))}</span>
          </div>
          <div class="report-card">
            <span class="report-card-label">ยอดค้างชำระ (${money(r.pendingOrderCount)} บิล)</span>
            <span class="report-card-value">฿${money(r.pendingRevenue)}</span>
          </div>
        </div>

        <h3 class="manage-cat-title" style="margin-top:22px;">ยอดขายรายวัน</h3>
        ${r.dailyRevenue.length === 0 ? `<p class="empty-note wide">ยังไม่มียอดขายในช่วงที่เลือก</p>` : `
          <div class="report-bars">
            ${r.dailyRevenue.map((d) => `
              <div class="report-bar-row">
                <span class="report-bar-date">${esc(d.date)}</span>
                <div class="report-bar-track"><div class="report-bar-fill" style="width:${maxDaily ? Math.max(4, (d.revenue / maxDaily) * 100) : 0}%"></div></div>
                <span class="report-bar-value">฿${money(d.revenue)}</span>
              </div>`).join("")}
          </div>`}

        <h3 class="manage-cat-title" style="margin-top:22px;">เมนูขายดี</h3>
        ${r.topItems.length === 0 ? `<p class="empty-note wide">ยังไม่มีข้อมูลเมนูขายดี</p>` : `
          <div class="manage-section">
            ${r.topItems.map((it, i) => `
              <div class="item-row">
                <span class="item-row-name">${i + 1}. ${esc(it.name)}</span>
                <span class="item-row-price">ขาย ${money(it.qty)} · ฿${money(it.revenue)}</span>
              </div>`).join("")}
          </div>`}
      `}
    `;
  }

  /* ---------------- MENU MANAGEMENT ---------------- */
  function renderMenuManageView() {
    return `
      <h1 class="view-title">⚙️ จัดการเมนู</h1>
      <div class="divider-sizzle"></div>
      ${CATEGORIES.map((c) => `
        <div class="manage-section">
          <h3 class="manage-cat-title">${c.icon} ${c.label}</h3>
          ${state.menu.filter((m) => m.category === c.id).map((m) => {
            if (state.editingMenuId === m.id) {
              const d = state.menuDraft;
              return `
                <div class="item-row" data-edit-row="${m.id}">
                  <input class="in" data-draft="name" value="${esc(d.name)}" />
                  <input class="in in-sm" data-draft="price" type="number" value="${esc(d.price)}" />
                  <input class="in in-sm" data-draft="unit" value="${esc(d.unit)}" placeholder="หน่วย" />
                  <select class="in in-sm" data-draft="category">
                    ${CATEGORIES.map((cc) => `<option value="${cc.id}" ${d.category === cc.id ? "selected" : ""}>${cc.label}</option>`).join("")}
                  </select>
                  <input class="in" data-draft="image" id="editItemImage" value="${esc(d.image)}" placeholder="ลิงก์รูปภาพ (ไม่บังคับ)" />
                  <label class="btn-ghost upload-btn">📷 ${state.editImageUploading ? "กำลังอัปโหลด..." : "อัปโหลดจากเครื่อง"}
                    <input type="file" accept="image/*" id="editItemImageFile" style="display:none;" ${state.editImageUploading ? "disabled" : ""}/>
                  </label>
                  ${d.image ? `<div class="img-preview"><img src="${esc(d.image)}" alt="preview"/></div>` : ""}
                  <button class="btn-advance" id="commitEdit">💾 บันทึก</button>
                  <button class="btn-ghost" id="cancelEdit">ยกเลิก</button>
                </div>`;
            }
            return `
              <div class="item-row">
                <span class="item-row-name">${esc(m.name)}</span>
                <span class="item-row-price">฿${money(m.price)}/${esc(m.unit)}</span>
                <button class="btn-ghost" data-startedit="${m.id}">✏️</button>
                <button class="btn-danger" data-removeitem="${m.id}">🗑️</button>
              </div>`;
          }).join("")}
        </div>`).join("")}

      <div class="manage-section">
        <h3 class="manage-cat-title">➕ เพิ่มเมนูใหม่</h3>
        <div class="form-grid">
          <input class="in" id="newItemName" placeholder="ชื่อเมนู" value="${esc(state.newMenuItem.name)}" />
          <input class="in" id="newItemPrice" type="number" placeholder="ราคา" value="${esc(state.newMenuItem.price)}" />
          <input class="in" id="newItemUnit" placeholder="หน่วย เช่น จาน/ขวด" value="${esc(state.newMenuItem.unit)}" />
          <select class="in" id="newItemCategory">
            ${CATEGORIES.map((cc) => `<option value="${cc.id}" ${state.newMenuItem.category === cc.id ? "selected" : ""}>${cc.label}</option>`).join("")}
          </select>
          <input class="in" id="newItemImage" placeholder="ลิงก์รูปภาพ (ไม่บังคับ)" value="${esc(state.newMenuItem.image)}" />
          <label class="btn-ghost upload-btn">📷 ${state.imageUploading ? "กำลังอัปโหลด..." : "อัปโหลดจากเครื่อง"}
            <input type="file" accept="image/*" id="newItemImageFile" style="display:none;" ${state.imageUploading ? "disabled" : ""}/>
          </label>
          ${state.newMenuItem.image ? `<div class="img-preview"><img src="${esc(state.newMenuItem.image)}" alt="preview"/></div>` : ""}
          <button class="btn-send" id="addMenuItem">➕ เพิ่มเมนู</button>
        </div>
      </div>
    `;
  }

  /* ---------------- อัปโหลดรูปภาพจากเครื่อง ---------------- */
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("อ่านไฟล์รูปภาพไม่สำเร็จ"));
      reader.readAsDataURL(file);
    });
  }
  async function uploadImageFile(file, onDone) {
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      alert("ไฟล์รูปภาพใหญ่เกินไป (สูงสุด 5MB)");
      return;
    }
    try {
      const dataUrl = await fileToDataURL(file);
      const res = await api("/upload-image", {
        method: "POST",
        body: JSON.stringify({ data: dataUrl, filename: file.name.replace(/\.[^.]+$/, "") }),
      });
      onDone(res.url);
    } catch (e) {
      alert(e.message);
    }
  }

  function syncDraftFromInputs() {
    document.querySelectorAll("[data-draft]").forEach((el) => {
      state.menuDraft[el.dataset.draft] = el.value;
    });
  }
  function syncNewItemFromInputs() {
    state.newMenuItem.name = document.getElementById("newItemName")?.value ?? state.newMenuItem.name;
    state.newMenuItem.price = document.getElementById("newItemPrice")?.value ?? state.newMenuItem.price;
    state.newMenuItem.unit = document.getElementById("newItemUnit")?.value ?? state.newMenuItem.unit;
    state.newMenuItem.category = document.getElementById("newItemCategory")?.value ?? state.newMenuItem.category;
    state.newMenuItem.image = document.getElementById("newItemImage")?.value ?? state.newMenuItem.image;
  }

  async function commitMenuEdit() {
    syncDraftFromInputs();
    await api(`/menu/${state.editingMenuId}`, { method: "PUT", body: JSON.stringify(state.menuDraft) });
    state.editingMenuId = null;
    await loadMenu();
  }
  async function addMenuItem() {
    syncNewItemFromInputs();
    if (!state.newMenuItem.name || !state.newMenuItem.price) return;
    try {
      await api("/menu", { method: "POST", body: JSON.stringify(state.newMenuItem) });
      state.newMenuItem = { name: "", price: "", unit: "", category: "food", image: "" };
      await loadMenu();
    } catch (e) { alert(e.message); }
  }
  async function removeMenuItem(id) {
    await api(`/menu/${id}`, { method: "DELETE" });
    await loadMenu();
  }

  /* ---------------- จัดการโต๊ะ (เพิ่ม/ลดโต๊ะ) ---------------- */
  function renderTablesManageView() {
    return `
      <h1 class="view-title">🪑 จัดการโต๊ะ</h1>
      <div class="divider-sizzle"></div>
      <div class="manage-section">
        ${state.tables.length === 0 ? `<p class="empty-note wide">ยังไม่มีโต๊ะ กรุณาเพิ่มโต๊ะด้านล่าง</p>` : `
          <div class="table-manage-grid">
            ${state.tables.map((t) => `
              <div class="table-manage-chip">
                <span>โต๊ะ ${t}</span>
                <button class="btn-danger" data-removetable="${t}" title="ลบโต๊ะ">🗑️</button>
              </div>`).join("")}
          </div>`}
      </div>
      <div class="manage-section">
        <h3 class="manage-cat-title">➕ เพิ่มโต๊ะใหม่</h3>
        <div class="form-grid">
          <input class="in in-sm" id="newTableNumber" type="number" min="1" placeholder="เลขโต๊ะ (ไม่ใส่ = เรียงอัตโนมัติ)" />
          <button class="btn-send" id="addTableBtn">➕ เพิ่มโต๊ะ</button>
        </div>
        ${state.newTableError ? `<p class="form-error">${esc(state.newTableError)}</p>` : ""}
      </div>
      <p class="empty-note wide qr-note">เมื่อเพิ่ม/ลบโต๊ะแล้ว อย่าลืมไปสร้าง QR โค้ดใหม่ที่แท็บ "📱 QR โต๊ะ" เพื่อแปะที่โต๊ะ</p>
    `;
  }

  async function addTable() {
    const val = document.getElementById("newTableNumber").value;
    state.newTableError = "";
    try {
      await api("/tables", { method: "POST", body: JSON.stringify({ number: val || undefined }) });
      await loadTables();
    } catch (e) {
      state.newTableError = e.message;
      render();
    }
  }
  async function removeTable(t) {
    state.newTableError = "";
    try {
      await api(`/tables/${t}`, { method: "DELETE" });
      await loadTables();
    } catch (e) {
      state.newTableError = e.message;
      render();
    }
  }

  /* ---------------- USER MANAGEMENT ---------------- */
  function renderUsersManageView() {
    return `
      <h1 class="view-title">🛡️ จัดการผู้ใช้งาน</h1>
      <div class="divider-sizzle"></div>
      <div class="manage-section">
        ${state.users.map((u) => `
          <div class="item-row">
            <span class="item-row-name">${esc(u.username)}</span>
            <span class="role-badge">${esc(ROLES.find((r) => r.id === u.role)?.label || u.role)}</span>
            ${u.username !== state.session.username ? `<button class="btn-danger" data-removeuser="${esc(u.username)}">🗑️</button>` : `<span class="role-badge">คุณ</span>`}
          </div>`).join("")}
      </div>
      <div class="manage-section">
        <h3 class="manage-cat-title">➕ เพิ่มผู้ใช้งานใหม่</h3>
        <div class="form-grid">
          <input class="in" id="newUserName" placeholder="ชื่อผู้ใช้" value="${esc(state.newUser.username)}" />
          <input class="in" id="newUserPassword" type="password" placeholder="รหัสผ่าน" value="${esc(state.newUser.password)}" />
          <select class="in" id="newUserRole">
            ${ROLES.map((r) => `<option value="${r.id}" ${state.newUser.role === r.id ? "selected" : ""}>${r.label}</option>`).join("")}
          </select>
          <button class="btn-send" id="addUserBtn">👤➕ เพิ่มผู้ใช้</button>
        </div>
        ${state.userError ? `<p class="form-error">${esc(state.userError)}</p>` : ""}
      </div>
      <p class="empty-note wide qr-note">
        หมายเหตุ: ระบบล็อกอินนี้เป็นการกันเข้าถึงแบบพื้นฐานสำหรับต้นแบบ (รหัสผ่านเก็บเป็นข้อความธรรมดาในไฟล์ข้อมูลฝั่งเซิร์ฟเวอร์)
        ยังไม่เหมาะกับการใช้งานจริงที่ต้องการความปลอดภัยระดับสูง หากจะใช้งานจริงควรเพิ่มการเข้ารหัสรหัสผ่านและระบบยืนยันตัวตนที่รัดกุมกว่านี้
      </p>
    `;
  }

  async function addUser() {
    const username = document.getElementById("newUserName").value;
    const password = document.getElementById("newUserPassword").value;
    const role = document.getElementById("newUserRole").value;
    state.userError = "";
    if (!username || !password) { state.userError = "กรอกชื่อผู้ใช้และรหัสผ่านให้ครบ"; render(); return; }
    try {
      await api("/users", { method: "POST", body: JSON.stringify({ username, password, role }) });
      state.newUser = { username: "", password: "", role: "staff" };
      await loadUsers();
    } catch (e) {
      state.userError = e.message;
      render();
    }
  }
  async function removeUser(username) {
    if (username === state.session.username) return;
    await api(`/users/${encodeURIComponent(username)}`, { method: "DELETE" });
    await loadUsers();
  }

  /* ---------------- event wiring ---------------- */
  function attachHandlers() {
    root.querySelectorAll("[data-mode]").forEach((el) => el.addEventListener("click", () => { state.mode = el.dataset.mode; render(); }));
    root.querySelectorAll("[data-table]").forEach((el) => el.addEventListener("click", () => { state.table = Number(el.dataset.table); render(); }));
    root.querySelectorAll("[data-cat]").forEach((el) => el.addEventListener("click", () => { state.cat = el.dataset.cat; render(); }));
    root.querySelectorAll("[data-qty]").forEach((el) => el.addEventListener("click", () => {
      const id = el.dataset.id, delta = Number(el.dataset.qty);
      const next = Math.max(0, (state.cart[id] || 0) + delta);
      if (next === 0) delete state.cart[id]; else state.cart[id] = next;
      render();
    }));
    const submitBtn = document.getElementById("submitOrderBtn");
    if (submitBtn) submitBtn.addEventListener("click", submitOrder);

    const loginSubmit = document.getElementById("loginSubmit");
    if (loginSubmit) {
      const uEl = document.getElementById("loginUsername"), pEl = document.getElementById("loginPassword");
      uEl.addEventListener("input", () => { state.loginUsername = uEl.value; });
      pEl.addEventListener("input", () => { state.loginPassword = pEl.value; });
      pEl.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
      loginSubmit.addEventListener("click", doLogin);
    }

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", () => { state.session = null; state.mode = "customer"; render(); });

    root.querySelectorAll("[data-stab]").forEach((el) => el.addEventListener("click", () => {
      state.staffTab = el.dataset.stab;
      render();
      if (state.staffTab === "reports" && !state.reports) loadReports();
    }));

    const refreshOrders = document.getElementById("refreshOrders");
    if (refreshOrders) refreshOrders.addEventListener("click", loadOrders);
    root.querySelectorAll("[data-advance]").forEach((el) => el.addEventListener("click", () => advanceOrder(el.dataset.advance)));

    root.querySelectorAll("[data-billtable]").forEach((el) => el.addEventListener("click", () => { state.billingTable = Number(el.dataset.billtable); render(); }));
    const refreshBilling = document.getElementById("refreshBilling");
    if (refreshBilling) refreshBilling.addEventListener("click", loadOrders);
    const printBill = document.getElementById("printBill");
    if (printBill) printBill.addEventListener("click", () => window.print());
    const closeBillBtn = document.getElementById("closeBill");
    if (closeBillBtn) closeBillBtn.addEventListener("click", closeBill);

    root.querySelectorAll("[data-startedit]").forEach((el) => el.addEventListener("click", () => {
      const item = state.menu.find((m) => m.id === el.dataset.startedit);
      state.editingMenuId = item.id;
      state.menuDraft = { ...item };
      render();
    }));
    root.querySelectorAll("[data-removeitem]").forEach((el) => el.addEventListener("click", () => removeMenuItem(el.dataset.removeitem)));
    const commitEdit = document.getElementById("commitEdit");
    if (commitEdit) commitEdit.addEventListener("click", commitMenuEdit);
    const cancelEdit = document.getElementById("cancelEdit");
    if (cancelEdit) cancelEdit.addEventListener("click", () => { state.editingMenuId = null; render(); });
    const addMenuBtn = document.getElementById("addMenuItem");
    if (addMenuBtn) addMenuBtn.addEventListener("click", addMenuItem);

    root.querySelectorAll("[data-removeuser]").forEach((el) => el.addEventListener("click", () => removeUser(el.dataset.removeuser)));
    const addUserBtn = document.getElementById("addUserBtn");
    if (addUserBtn) addUserBtn.addEventListener("click", addUser);

    // สรุปยอดขาย
    const refreshReports = document.getElementById("refreshReports");
    if (refreshReports) refreshReports.addEventListener("click", loadReports);
    const applyReportsRange = document.getElementById("applyReportsRange");
    if (applyReportsRange) applyReportsRange.addEventListener("click", () => {
      state.reportsFrom = document.getElementById("reportsFrom")?.value || "";
      state.reportsTo = document.getElementById("reportsTo")?.value || "";
      loadReports();
    });

    // จัดการโต๊ะ
    const addTableBtn = document.getElementById("addTableBtn");
    if (addTableBtn) addTableBtn.addEventListener("click", addTable);
    root.querySelectorAll("[data-removetable]").forEach((el) => el.addEventListener("click", () => removeTable(el.dataset.removetable)));

    // อัปโหลดรูปภาพเมนูจากเครื่อง (เมนูใหม่)
    const newItemImageFile = document.getElementById("newItemImageFile");
    if (newItemImageFile) newItemImageFile.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      syncNewItemFromInputs();
      state.imageUploading = true;
      render();
      await uploadImageFile(file, (url) => { state.newMenuItem.image = url; });
      state.imageUploading = false;
      render();
    });

    // อัปโหลดรูปภาพเมนูจากเครื่อง (แก้ไขเมนู)
    const editItemImageFile = document.getElementById("editItemImageFile");
    if (editItemImageFile) editItemImageFile.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      syncDraftFromInputs();
      state.editImageUploading = true;
      render();
      await uploadImageFile(file, (url) => { state.menuDraft.image = url; });
      state.editImageUploading = false;
      render();
    });
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    render();
    try {
      await loadMenu();
    } catch (e) { console.error(e); }
    try {
      await loadTables();
    } catch (e) { console.error(e); }
    try {
      await loadOrders();
    } catch (e) { console.error(e); }
    setInterval(() => { if (!isOnLoginScreen()) loadOrders().catch(() => {}); }, 4000);
    setInterval(() => { if (!isOnLoginScreen()) loadMenu().catch(() => {}); }, 8000);
    setInterval(() => { if (!isOnLoginScreen()) loadTables().catch(() => {}); }, 15000);
  }

  boot();
})();
