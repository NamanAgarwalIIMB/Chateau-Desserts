import { google } from "googleapis";
import crypto from "node:crypto";

const PRODUCT_HEADERS = ["id", "name", "category", "description", "price", "imageUrl", "active", "createdAt"];
const ORDER_HEADERS = ["orderId", "createdAt", "customerName", "phone", "address", "deliveryDate", "timeSlot", "items", "subtotal", "status"];
const CATEGORIES = ["Brownies", "Cookies", "Drinks", "Other Desserts"];
const ALLOWED_SLOTS = ["12:00 PM to 2:00 PM", "2:00 PM to 4:00 PM", "4:00 PM to 6:00 PM"];
const DEFAULT_PRODUCTS = [
  { id: "classic-brownie", name: "Classic Brownie", category: "Brownies", description: "Product description coming soon.", price: 199, imageUrl: "", active: true },
  { id: "nutella-brownie", name: "Nutella Brownie", category: "Brownies", description: "Product description coming soon.", price: 199, imageUrl: "", active: true },
  { id: "choco-chip-cookie", name: "Choco Chip Cookie", category: "Cookies", description: "Product description coming soon.", price: 199, imageUrl: "", active: true },
  { id: "red-velvet-cookie", name: "Red Velvet Cookie", category: "Cookies", description: "Product description coming soon.", price: 199, imageUrl: "", active: true },
  { id: "hot-chocolate", name: "Hot Chocolate", category: "Drinks", description: "Product description coming soon.", price: 199, imageUrl: "", active: true }
];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing Netlify environment variable: ${name}`);
  return value;
}

async function sheetsClient() {
  const credentials = JSON.parse(requiredEnv("GOOGLE_SERVICE_ACCOUNT_JSON"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

const spreadsheetId = () => requiredEnv("GOOGLE_SPREADSHEET_ID");

async function ensureTabs(sheets) {
  const id = spreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties.title" });
  const titles = new Set((meta.data.sheets || []).map(s => s.properties.title));
  const requests = [];
  for (const title of ["Products", "Orders"]) {
    if (!titles.has(title)) requests.push({ addSheet: { properties: { title } } });
  }
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });
  await sheets.spreadsheets.values.update({ spreadsheetId: id, range: "Products!A1:H1", valueInputOption: "RAW", requestBody: { values: [PRODUCT_HEADERS] } });
  await sheets.spreadsheets.values.update({ spreadsheetId: id, range: "Orders!A1:J1", valueInputOption: "RAW", requestBody: { values: [ORDER_HEADERS] } });
}

async function readRows(sheets, range) {
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: spreadsheetId(), range });
  return result.data.values || [];
}

function mapProduct(row) {
  return {
    id: String(row[0] || ""), name: String(row[1] || ""), category: String(row[2] || ""),
    description: String(row[3] || ""), price: Number(row[4] || 0), imageUrl: String(row[5] || ""),
    active: String(row[6]).toLowerCase() !== "false", createdAt: String(row[7] || "")
  };
}

async function getProducts(sheets, includeInactive = false) {
  await ensureTabs(sheets);
  let rows = await readRows(sheets, "Products!A2:H");
  if (!rows.length) {
    const seed = DEFAULT_PRODUCTS.map(p => [p.id, p.name, p.category, p.description, p.price, p.imageUrl, true, new Date().toISOString()]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId(), range: "Products!A:H", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
      requestBody: { values: seed }
    });
    rows = seed;
  }
  const products = rows.map(mapProduct).filter(p => p.id && (includeInactive || p.active));
  return products;
}

function requireAdmin(request) {
  const supplied = request.headers.get("x-admin-password") || "";
  const saved = requiredEnv("ADMIN_PASSWORD");
  const a = Buffer.from(supplied);
  const b = Buffer.from(saved);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("Admin access denied.");
}

function todayInIndia() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

function minQty(category) {
  if (category === "Brownies") return 4;
  if (category === "Cookies") return 2;
  return 1;
}

async function createOrder(request, sheets) {
  const body = await request.json();
  const required = ["customerName", "phone", "address", "deliveryDate", "timeSlot"];
  for (const key of required) if (!String(body[key] || "").trim()) throw new Error(`Please provide ${key}.`);
  if (!Array.isArray(body.items) || body.items.length === 0) throw new Error("Your cart is empty.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.deliveryDate) || body.deliveryDate <= todayInIndia()) throw new Error("Delivery date must be tomorrow or later.");
  if (!ALLOWED_SLOTS.includes(body.timeSlot)) throw new Error("Please choose one of the available delivery time slots.");
  if (!/^[0-9+()\s-]{8,16}$/.test(String(body.phone))) throw new Error("Please enter a valid phone number.");

  const products = await getProducts(sheets, false);
  const normalizedItems = [];
  let subtotal = 0;
  for (const item of body.items) {
    const product = products.find(p => p.id === String(item.id));
    if (!product) throw new Error("A product in your cart is no longer available.");
    const quantity = Number(item.quantity);
    const minimum = minQty(product.category);
    if (!Number.isInteger(quantity) || quantity < minimum) throw new Error(`${product.name} requires a minimum order quantity of ${minimum}.`);
    const lineTotal = product.price * quantity;
    subtotal += lineTotal;
    normalizedItems.push({ id: product.id, name: product.name, category: product.category, quantity, price: product.price, lineTotal });
  }

  const orderId = `CD-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  const itemText = normalizedItems.map(i => `${i.name} x ${i.quantity} at INR ${i.price} each = INR ${i.lineTotal}`).join(" | ");
  const values = [[
    orderId, new Date().toISOString(), String(body.customerName).trim(), String(body.phone).trim(),
    String(body.address).trim(), body.deliveryDate, body.timeSlot, itemText, subtotal, "Pending WhatsApp confirmation"
  ]];
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(), range: "Orders!A:J", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
    requestBody: { values }
  });
  return { ok: true, orderId, items: normalizedItems, subtotal };
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "product";
}

async function saveImageToGitHub(image, productName) {
  if (!image) return "";
  if (!image.base64 || !image.mimeType || !image.name) throw new Error("Invalid image upload.");
  const mimeExtensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  const ext = mimeExtensions[image.mimeType];
  if (!ext) throw new Error("Upload a JPG, PNG, WEBP or GIF image.");
  const buffer = Buffer.from(image.base64, "base64");
  if (buffer.length > 3 * 1024 * 1024) throw new Error("Image must be 3 MB or smaller.");

  const owner = requiredEnv("GITHUB_OWNER");
  const repo = requiredEnv("GITHUB_REPO");
  const branch = process.env.GITHUB_BRANCH || "main";
  const token = requiredEnv("GITHUB_TOKEN");
  const fileName = `${slugify(productName)}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.${ext}`;
  const path = `site/assets/products/${fileName}`;
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message: `Add product image ${fileName}`, content: buffer.toString("base64"), branch })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GitHub image upload failed: ${result.message || response.statusText}`);
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
}

async function saveProduct(request, sheets) {
  requireAdmin(request);
  const body = await request.json();
  if (!String(body.name || "").trim() || !CATEGORIES.includes(body.category)) throw new Error("Enter a product name and choose a valid category.");
  const price = Number(body.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Enter a valid price greater than zero.");
  const rows = await readRows(sheets, "Products!A2:H");
  const id = String(body.id || `${slugify(body.name)}-${crypto.randomBytes(3).toString("hex")}`);
  const existingIndex = rows.findIndex(row => String(row[0]) === id);
  const existing = existingIndex >= 0 ? mapProduct(rows[existingIndex]) : null;
  let imageUrl = String(body.imageUrl || existing?.imageUrl || "");
  if (body.image && body.image.base64) imageUrl = await saveImageToGitHub(body.image, body.name);
  const createdAt = existing?.createdAt || new Date().toISOString();
  const values = [[id, String(body.name).trim(), body.category, String(body.description || "").trim(), price, imageUrl, true, createdAt]];
  if (existingIndex >= 0) {
    const sheetRow = existingIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId(), range: `Products!A${sheetRow}:H${sheetRow}`, valueInputOption: "RAW", requestBody: { values }
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId(), range: "Products!A:H", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values }
    });
  }
  return { ok: true, product: mapProduct(values[0]) };
}

async function deleteProduct(request, sheets, url) {
  requireAdmin(request);
  const id = url.searchParams.get("id");
  if (!id) throw new Error("Missing product ID.");
  const rows = await readRows(sheets, "Products!A2:H");
  const index = rows.findIndex(row => String(row[0]) === id);
  if (index < 0) throw new Error("Product not found.");
  const meta = await sheets.spreadsheets.get({ spreadsheetId: spreadsheetId(), fields: "sheets.properties" });
  const sheet = meta.data.sheets.find(s => s.properties.title === "Products");
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: { requests: [{ deleteDimension: { range: { sheetId: sheet.properties.sheetId, dimension: "ROWS", startIndex: index + 1, endIndex: index + 2 } } }] }
  });
  return { ok: true };
}

async function getOrders(sheets) {
  const rows = await readRows(sheets, "Orders!A2:J");
  return rows.map(row => ({
    orderId: String(row[0] || ""), createdAt: String(row[1] || ""), customerName: String(row[2] || ""),
    phone: String(row[3] || ""), address: String(row[4] || ""), deliveryDate: String(row[5] || ""),
    timeSlot: String(row[6] || ""), items: String(row[7] || ""), subtotal: Number(row[8] || 0), status: String(row[9] || "")
  })).reverse();
}

async function updateOrderStatus(request, sheets) {
  requireAdmin(request);
  const body = await request.json();
  const allowed = ["Pending WhatsApp confirmation", "Confirmed", "Preparing", "Out for delivery", "Delivered", "Cancelled"];
  if (!body.orderId || !allowed.includes(body.status)) throw new Error("Invalid order status update.");
  const rows = await readRows(sheets, "Orders!A2:J");
  const index = rows.findIndex(row => String(row[0]) === String(body.orderId));
  if (index < 0) throw new Error("Order not found.");
  const rowNumber = index + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(), range: `Orders!J${rowNumber}`, valueInputOption: "RAW", requestBody: { values: [[body.status]] }
  });
  return { ok: true };
}

export default async (request) => {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    if (action === "login" && request.method === "POST") {
      const body = await request.json();
      const saved = requiredEnv("ADMIN_PASSWORD");
      const a = Buffer.from(String(body.password || ""));
      const b = Buffer.from(saved);
      const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
      return json({ ok });
    }

    const sheets = await sheetsClient();
    await ensureTabs(sheets);

    if (action === "products" && request.method === "GET") return json({ products: await getProducts(sheets, false) });
    if (action === "order" && request.method === "POST") return json(await createOrder(request, sheets));
    if (action === "products" && request.method === "POST") return json(await saveProduct(request, sheets));
    if (action === "products" && request.method === "DELETE") return json(await deleteProduct(request, sheets, url));
    if (action === "orders" && request.method === "GET") {
      requireAdmin(request);
      return json({ orders: await getOrders(sheets) });
    }
    if (action === "order-status" && request.method === "PATCH") return json(await updateOrderStatus(request, sheets));
    return json({ error: "API action not found." }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const status = message === "Admin access denied." ? 401 : 400;
    return json({ error: message }, status);
  }
};
