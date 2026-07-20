# วิธีติดตั้ง Backend แบบ Google Apps Script (ง่ายสุด ไม่ต้องใช้ Service Account)

วิธีนี้ใช้ **Google Apps Script** (ไฟล์ `Code.gs`) เป็น backend แทน Netlify Functions
ทั้งหมด — เก็บข้อมูลใน Google Sheet ที่ผูกกับสคริปต์โดยตรง และเก็บรูปภาพเมนูใน Google Drive
**ไม่ต้องสร้าง Google Cloud Project, ไม่ต้องเปิด API เอง, ไม่ต้องมี Service Account** — เหมาะกับ
คนที่ไม่ถนัดสายเทคนิคมากที่สุดในบรรดาทุกวิธีที่เคยแนะนำไป

## ขั้นตอนที่ 1: สร้าง Google Sheet + วางโค้ด

1. เปิด https://sheets.google.com → สร้างสเปรดชีตใหม่ (ตั้งชื่ออะไรก็ได้ เช่น "moo-krata-data")
2. เมนูด้านบน → **Extensions (ส่วนขยาย)** → **Apps Script**
3. จะเจอไฟล์ `Code.gs` เปล่าๆ อยู่แล้ว → **ลบโค้ดเดิมทั้งหมดในนั้นออก**
4. เปิดไฟล์ `google-apps-script/Code.gs` ที่แนบมาในโปรเจกต์นี้ → ก๊อบปี้โค้ดทั้งหมด → วางแทนที่ในหน้า Apps Script
5. กด **บันทึก** (ไอคอนรูปแผ่นดิสก์ หรือ Ctrl+S)

## ขั้นตอนที่ 2: Deploy เป็น Web App

1. ที่มุมขวาบนของหน้า Apps Script → กด **Deploy (ทำให้ใช้งานได้)** → **New deployment (การทำให้ใช้งานได้ใหม่)**
2. ตรงช่อง "Select type" กดไอคอนเฟือง → เลือก **Web app**
3. ตั้งค่า:
   - **Execute as (เรียกใช้ในฐานะ)**: Me (ตัวคุณเอง)
   - **Who has access (ผู้มีสิทธิ์เข้าถึง)**: **Anyone (ทุกคน)** ← สำคัญมาก ต้องเลือกอันนี้ ไม่งั้นลูกค้าเข้าเว็บไม่ได้
4. กด **Deploy** → ระบบจะขอให้ authorize สิทธิ์ (เพราะสคริปต์ต้องเขียนชีตและ Drive แทนคุณ) → กด **Authorize access** → เลือกบัญชี Google ของคุณ → ถ้าเจอหน้าเตือน "Google hasn't verified this app" ให้กด **Advanced (ขั้นสูง)** → **Go to (ชื่อโปรเจกต์) (unsafe)** → **Allow**
5. หลัง deploy เสร็จ จะได้ **Web app URL** หน้าตาประมาณ:
   `https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/exec`
   **ก๊อบปี้ URL นี้เก็บไว้** จะใช้ในขั้นตอนถัดไป

## ขั้นตอนที่ 3: เชื่อม URL เข้ากับหน้าเว็บ

1. เปิดไฟล์ `public/js/app.js` ในโปรเจกต์
2. หาบรรทัดนี้ใกล้ๆ ด้านบนของไฟล์:
   ```js
   const APPS_SCRIPT_URL = "วาง URL ของ Apps Script Web App ตรงนี้";
   ```
3. แทนที่ข้อความ `"วาง URL ของ Apps Script Web App ตรงนี้"` ด้วย URL ที่ได้จากขั้นตอนที่ 2 เช่น:
   ```js
   const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxxxxxxx/exec";
   ```
4. บันทึกไฟล์ → `git add -A && git commit -m "เชื่อม Apps Script URL" && git push`
   (ถ้าเชื่อมกับ Netlify ไว้แล้ว จะ deploy เวอร์ชันใหม่ให้อัตโนมัติ)

## ทดสอบว่าใช้งานได้

เปิดเว็บ → ล็อกอินหน้าพนักงาน (owner / owner123) → ถ้าเข้าได้และเห็นเมนู/โต๊ะเริ่มต้น 4 โต๊ะ
แปลว่าเชื่อมสำเร็จ (สคริปต์จะสร้างแท็บ `Menu`, `Tables`, `Users`, `Orders` พร้อมข้อมูลตั้งต้นให้เองในสเปรดชีตที่สร้างไว้ในขั้นตอนที่ 1)

ลองสั่งอาหาร 1 รายการ แล้วเปิดสเปรดชีตดูแท็บ `Orders` — ควรเห็นแถวใหม่ขึ้นมาทันที

## ข้อดี / ข้อจำกัดของวิธีนี้

**ข้อดี**
- ไม่ต้องสร้าง Google Cloud Project หรือ Service Account เลย
- เปิดสเปรดชีตดู/แก้ข้อมูลได้ตรงๆ ตลอดเวลา
- รูปภาพเมนูเก็บใน Google Drive ของคุณเอง ดูย้อนหลังได้

**ข้อจำกัด**
- Apps Script มีโควตาการเรียกใช้งานต่อวัน (ปกติเพียงพอสำหรับร้านขนาดเล็ก-กลาง)
- ทุกครั้งที่แก้ `Code.gs` ต้อง **Deploy → Manage deployments → แก้ไข (ไอคอนดินสอ) → New version → Deploy** ใหม่ ไม่งั้นเว็บจะยังใช้โค้ดเวอร์ชันเก่าอยู่
- ความเร็วตอบสนองอาจช้ากว่า Netlify Functions เล็กน้อย (โดยเฉพาะตอน cold start)

## ถ้าแก้ Code.gs แล้วอยาก deploy URL เดิม (ไม่ต้องเปลี่ยน URL ในเว็บใหม่)

1. หน้า Apps Script → **Deploy** → **Manage deployments**
2. กดไอคอนดินสอ (แก้ไข) ที่ deployment เดิม
3. ตรง "Version" เลือก **New version**
4. กด **Deploy**

วิธีนี้ URL เดิมจะยังใช้ได้ ไม่ต้องแก้ `app.js` ใหม่
