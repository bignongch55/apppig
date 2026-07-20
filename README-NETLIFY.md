# Deploy ขึ้น Netlify (ฐานข้อมูล: Google Sheets)

> **อัปเดต**: ตอนนี้โปรเจกต์ใช้วิธี **Google Apps Script** เป็น backend หลักแล้ว (ดู
> `README-APPS-SCRIPT.md`) ซึ่งง่ายกว่าวิธีด้านล่างนี้มาก เพราะไม่ต้องสร้าง Service Account เลย
> หน้าเว็บ (`public/js/app.js`) เรียกไปที่ Apps Script Web App โดยตรง — Netlify ในกรณีนี้ทำหน้าที่
> โฮสต์ไฟล์หน้าเว็บ (static) เท่านั้น ไม่จำเป็นต้องใช้ Netlify Functions ในโฟลเดอร์นี้อีกต่อไป
> (แต่ยังเก็บไว้ในโปรเจกต์เผื่ออยากใช้วิธีนี้แทนในอนาคต)

โปรเจกต์นี้ถูกแปลงให้รันบน Netlify ได้แล้ว โดยเปลี่ยนที่เก็บข้อมูลจากไฟล์ `.json`
บนดิสก์ (ซึ่งจะหายทุกครั้งที่ deploy ใหม่บน serverless) มาเป็น:

- **Google Sheets** — เก็บเมนู / โต๊ะ / ผู้ใช้ทุกคนของเว็บ / ออเดอร์ (แยกเป็น 4 แท็บในสเปรดชีตเดียว) เปิดดู/แก้ข้อมูลตรงในชีตได้เลย
- **Netlify Blobs** — เก็บรูปภาพเมนูที่อัปโหลด แล้วเก็บแค่ "ลิงก์รูป" ไว้ในคอลัมน์ `image` ของชีต Menu
- **Netlify Functions** — แปลง Express API เดิมให้รันเป็น serverless function

> หมายเหตุ: `server.js` เดิม + ไฟล์ `data/*.json` ยังอยู่ในโปรเจกต์เผื่ออยากรันแบบ
> Node ปกติบนเครื่อง แต่เวอร์ชันที่ใช้จริงบน Netlify คือไฟล์ในโฟลเดอร์ `netlify/functions/`

## ขั้นตอนที่ 1: สร้าง Google Sheet + Service Account

1. สร้างสเปรดชีตใหม่ใน Google Sheets (ตั้งชื่ออะไรก็ได้ เช่น "moo-krata-data") — **ไม่ต้องสร้างแท็บหรือใส่หัวตารางเอง ระบบจะสร้างให้อัตโนมัติตอนเรียก API ครั้งแรก**
2. ก๊อบปี้ **Sheet ID** จาก URL ของสเปรดชีต เช่น
   `https://docs.google.com/spreadsheets/d/`**`1AbCдEfGhIjKlMnOpQrStUvWxYz`**`/edit`
   → ส่วนตัวหนาคือ Sheet ID
3. ไปที่ [Google Cloud Console](https://console.cloud.google.com/) → สร้างโปรเจกต์ใหม่ (หรือใช้โปรเจกต์เดิม)
4. เปิดใช้งาน **Google Sheets API**: เมนู "APIs & Services" → "Library" → ค้นหา "Google Sheets API" → กด Enable
5. สร้าง **Service Account**: "APIs & Services" → "Credentials" → "Create Credentials" → "Service account" → ตั้งชื่ออะไรก็ได้ → Create
6. เข้าไปที่ Service Account ที่สร้าง → แท็บ "Keys" → "Add Key" → "Create new key" → เลือก **JSON** → ระบบจะดาวน์โหลดไฟล์ `.json` มาให้ (เก็บไฟล์นี้ไว้ดีๆ **ห้ามอัปขึ้น GitHub**)
7. เปิดไฟล์ JSON ที่ดาวน์โหลดมา จะเห็น 2 ค่าที่ต้องใช้:
   - `client_email` → เช่น `xxxx@yyyy.iam.gserviceaccount.com`
   - `private_key` → ข้อความยาวๆ ที่ขึ้นต้นด้วย `-----BEGIN PRIVATE KEY-----`
8. กลับไปที่สเปรดชีตที่สร้างไว้ในข้อ 1 → กด **"Share"** → ใส่อีเมลจาก `client_email` ข้างต้น → ให้สิทธิ์ **Editor** → Share

## ขั้นตอนที่ 2: ตั้งค่าตัวแปรแวดล้อมใน Netlify

เข้า Netlify dashboard → เลือก site → **Site configuration** → **Environment variables** → Add a variable ทีละตัว:

| ชื่อตัวแปร | ค่า |
|---|---|
| `GOOGLE_SHEET_ID` | Sheet ID จากข้อ 2 ด้านบน |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ค่า `client_email` จากไฟล์ JSON |
| `GOOGLE_PRIVATE_KEY` | ค่า `private_key` ทั้งหมด (ก๊อบรวมเครื่องหมาย `-----BEGIN...-----END PRIVATE KEY-----` มาด้วย) |

ตั้งเสร็จแล้วไปที่แท็บ **Deploys** → **Trigger deploy** → **Deploy site** เพื่อให้ function อ่านค่าตัวแปรใหม่

## ขั้นตอนที่ 3: Deploy (ถ้ายังไม่เคยทำ)

```bash
npm install
npx netlify login
npx netlify init
npx netlify deploy --prod
```

หรือถ้าเชื่อมกับ GitHub repo ไว้แล้ว แค่ `git push` ก็ deploy ให้อัตโนมัติ

## ทดสอบว่าเชื่อมสำเร็จ

เปิดเว็บ → ล็อกอินหน้าพนักงาน (owner / owner123) → ถ้าเข้าได้และเห็นเมนู/โต๊ะเริ่มต้น แปลว่าเชื่อม Google Sheet
สำเร็จแล้ว (ระบบจะสร้างแท็บ `Menu`, `Tables`, `Users`, `Orders` พร้อมข้อมูลตั้งต้นให้อัตโนมัติในสเปรดชีตที่สร้างไว้)

## สิ่งที่เปลี่ยนไปจากเวอร์ชันเดิม

| เดิม | ใหม่ (บน Netlify) |
|---|---|
| `data/*.json` บนดิสก์ | 4 แท็บใน Google Sheet (`Menu`, `Tables`, `Users`, `Orders`) |
| `public/uploads/*` บนดิสก์ | Netlify Blobs (store ชื่อ `menu-images`) + เก็บลิงก์ไว้ในชีต |
| `server.js` รันค้างตลอดเวลา | `netlify/functions/api.js` (serverless, รันตามคำขอ) |

หน้าเว็บ (`public/`) และ endpoint API (`/api/...`) เรียกใช้งานเหมือนเดิมทุกอย่าง
ไม่ต้องแก้โค้ดฝั่งหน้าเว็บ (`public/js/app.js`) เลย

## ข้อควรระวัง
- ทุกครั้งที่ API ถูกเรียก ระบบจะอ่าน/เขียนข้อมูลผ่าน Google Sheets API ซึ่งมี rate limit ของ Google (ปกติเพียงพอสำหรับร้านขนาดเล็ก-กลาง แต่ถ้าออเดอร์เข้าถี่มากพร้อมกันหลายสิบครั้งต่อวินาทีอาจเจอ error ชั่วคราวได้)
- ห้ามลบหรือแก้ชื่อหัวตาราง (แถวที่ 1) ในแต่ละแท็บ ไม่งั้นระบบจะอ่านข้อมูลผิดคอลัมน์
- ถ้าเคยเปิด Netlify Database (Postgres) ไว้ก่อนหน้านี้และไม่ได้ใช้แล้ว สามารถเข้าไปลบทิ้งได้จากแท็บ Database เพื่อไม่ให้มีค่าใช้จ่ายเกินจำเป็น

