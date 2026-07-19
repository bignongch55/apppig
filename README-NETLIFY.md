# Deploy ขึ้น Netlify

โปรเจกต์นี้ถูกแปลงให้รันบน Netlify ได้แล้ว โดยเปลี่ยนจากการเก็บข้อมูลเป็นไฟล์ `.json`
บนดิสก์ (ซึ่งจะหายทุกครั้งที่ deploy ใหม่บน serverless) มาเป็น:

- **Netlify Database** (Postgres ขับเคลื่อนโดย Neon) — เก็บเมนู/โต๊ะ/ผู้ใช้/ออเดอร์
- **Netlify Blobs** — เก็บรูปภาพเมนูที่อัปโหลด
- **Netlify Functions** — แปลง Express API เดิมให้รันเป็น serverless function

> หมายเหตุ: `server.js` เดิม + ไฟล์ `data/*.json` ยังอยู่ในโปรเจกต์เผื่ออยากรันแบบ
> Node ปกติบนเครื่อง/บนโฮสต์ที่มี disk ถาวร (Render, Railway, VPS ฯลฯ) แต่เวอร์ชันที่ใช้
> จริงบน Netlify คือไฟล์ในโฟลเดอร์ `netlify/functions/`

## ขั้นตอน Deploy

### 1. ติดตั้ง Netlify CLI และล็อกอิน
```bash
npm install
npx netlify login
```

### 2. เชื่อมโปรเจกต์กับ Netlify site
```bash
npx netlify init
```
เลือก "Create & configure a new site" (หรือเชื่อมกับ site เดิมถ้ามีแล้ว)

### 3. เปิดใช้งาน Netlify Database (Postgres)
วิธีที่ง่ายที่สุดคือผ่าน CLI:
```bash
npx netlify db init
```
หรือเข้า Netlify dashboard → เลือกโปรเจกต์ → แท็บ **Database** → กด "Create database"
ระบบจะสร้างฐานข้อมูล Postgres ให้อัตโนมัติ และฉีดตัวแปรแวดล้อม
`NETLIFY_DATABASE_URL` ให้ function ใช้เอง **ไม่ต้องตั้งค่าอะไรเพิ่ม**

ตารางในฐานข้อมูล (`menu_items`, `restaurant_tables`, `app_users`, `orders`) จะถูกสร้าง
และใส่ข้อมูลเริ่มต้นให้อัตโนมัติในการเรียก API ครั้งแรก (ดูใน `netlify/functions/lib/db.js`)

### 4. ทดสอบบนเครื่องก่อน deploy จริง (ไม่บังคับ)
```bash
npx netlify dev
```
คำสั่งนี้จะรันทั้งหน้าเว็บ static และ Netlify Functions พร้อมเชื่อมกับฐานข้อมูลจริงที่ผูกไว้

### 5. Deploy
```bash
npx netlify deploy --prod
```

## สิ่งที่เปลี่ยนไปจากเวอร์ชันเดิม

| เดิม | ใหม่ (บน Netlify) |
|---|---|
| `data/*.json` บนดิสก์ | ตาราง Postgres ใน Netlify Database |
| `public/uploads/*` บนดิสก์ | Netlify Blobs (store ชื่อ `menu-images`) |
| `server.js` รันค้างตลอดเวลา | `netlify/functions/api.js` (serverless, รันตามคำขอ) |

หน้าเว็บ (`public/`) และ endpoint API (`/api/...`) เรียกใช้งานเหมือนเดิมทุกอย่าง
ไม่ต้องแก้โค้ดฝั่งหน้าเว็บ (`public/js/app.js`) เลย

## ข้อควรระวัง
- Netlify Database เป็นฟีเจอร์ของแผนแบบ **Credit-based plan** เท่านั้น พื้นที่เก็บข้อมูลฟรีถึง 1 ก.ค. 2569 หลังจากนั้นจะเริ่มคิดตามการใช้งานจริง ตรวจสอบราคาปัจจุบันได้ที่ Netlify dashboard
- ถ้าต้องการย้ายฐานข้อมูลออกไปเป็นบัญชี Neon ของตัวเอง สามารถกด "Claim database" ได้จาก dashboard โดยข้อมูลจะไม่หาย
