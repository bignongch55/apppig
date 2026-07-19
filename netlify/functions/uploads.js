// netlify/functions/uploads.js
// เสิร์ฟรูปภาพเมนูที่อัปโหลดไว้ ซึ่งเก็บอยู่ใน Netlify Blobs (แทนการเก็บไฟล์บนดิสก์)
const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  // path จะเป็นรูปแบบ /.netlify/functions/uploads/<key> หรือ /uploads/<key>
  const parts = event.path.split("/uploads/");
  const key = decodeURIComponent(parts[parts.length - 1] || "");
  if (!key) {
    return { statusCode: 400, body: "missing file key" };
  }

  const store = getStore("menu-images");
  const result = await store.getWithMetadata(key, { type: "arrayBuffer" });
  if (!result) {
    return { statusCode: 404, body: "not found" };
  }

  const { data, metadata } = result;
  return {
    statusCode: 200,
    headers: {
      "Content-Type": (metadata && metadata.contentType) || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
    body: Buffer.from(data).toString("base64"),
    isBase64Encoded: true,
  };
};
