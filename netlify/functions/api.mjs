// ============================================================================
// CHATEAU DESSERTS - BACKEND API
// ============================================================================
// This file runs on Netlify's servers, not in the customer's browser.
// It connects to Google Sheets, handles orders and admin actions, uploads
// product photos to GitHub.
//
// IMPORTANT: Keep passwords and API tokens in Netlify environment variables.
// Never paste private credentials into this file or commit them to GitHub.
// ============================================================================

import { google } from "googleapis";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// 1. STORE SETTINGS
// Change the values in this section if you want to change the initial menu,
// categories, minimum quantities or delivery time slots.
// ---------------------------------------------------------------------------

const STORE = {
  categories: ["Brownies", "Cookies", "Drinks", "Other Desserts"],
  deliverySlots: [
    "12:00 PM to 2:00 PM",
    "2:00 PM to 4:00 PM",
    "4:00 PM to 6:00 PM"
  ],
  minimumQuantity: {
    Brownies: 4,
    Cookies: 2,
    Drinks: 1,
    "Other Desserts": 1
  }
};

// These products are inserted only if the Products sheet is completely empty.
// After the first setup, manage your live products from /admin.html instead.
const STARTER_PRODUCTS = [
  { id: "classic-brownie", name: "Classic Brownie", category: "Brownies", description: "Product description coming soon.", price: 199, imageUrl: "", active: true },
  { id: "nutella-brownie", name: "Nutella Brownie", category: "Brownies", description: "Product description coming soon.", price: 199, imageUrl: "", active: true },
  { id: "choco-chip-cookie", name: "Choco Chip Cookie", category: "Cookies", description: "Product description coming soon.", price: 199, imageUrl: "", active: true },
  { id: "red-velvet-cookie", name: "Red Velvet Cookie", category: "Cookies", description: "Product description coming soon.", price: 199, imageUrl: "", active: true },
  { id: "hot-chocolate", name: "Hot Chocolate", category: "Drinks", description: "Product description coming soon.", price: 199, imageUrl: "", active: true }
];

// Column headings used when the backend creates the Google Sheets tabs.
const PRODUCT_COLUMNS = ["id", "name", "category", "description", "price", "imageUrl", "active", "createdAt"];
const ORDER_COLUMNS = ["orderId", "createdAt", "customerName", "phone", "address", "deliveryDate", "timeSlot", "items", "subtotal", "status"];

// ---------------------------------------------------------------------------
// 2. COMMON HELPERS
// Small reusable functions used by different parts of the backend.
// ---------------------------------------------------------------------------

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function requiredEnvironmentVariable(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing Netlify environment variable: ${name}`);
  }
  return value;
}

function optionalEnvironmentVariable(name) {
  return String(process.env[name] || "").trim();
}

function makeId(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "product";
}

function todayInIndia() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function minimumForCategory(category) {
  return STORE.minimumQuantity[category] || 1;
}

// Compare passwords without immediately exiting on the first different byte.
function passwordsMatch(suppliedPassword, savedPassword) {
  const supplied = Buffer.from(String(suppliedPassword || ""));
  const saved = Buffer.from(String(savedPassword || ""));
  return supplied.length === saved.length && crypto.timingSafeEqual(supplied, saved);
}

function requireAdmin(request) {
  const suppliedPassword = request.headers.get("x-admin-password") || "";
  const savedPassword = requiredEnvironmentVariable("ADMIN_PASSWORD");
  if (!passwordsMatch(suppliedPassword, savedPassword)) {
    throw new Error("Admin access denied.");
  }
}

// ---------------------------------------------------------------------------
// 3. GOOGLE SHEETS CONNECTION
// This is the only section that creates the Google Sheets connection and tabs.
// ---------------------------------------------------------------------------

function getSpreadsheetId() {
  return requiredEnvironmentVariable("GOOGLE_SPREADSHEET_ID");
}

async function getGoogleSheetsClient() {
  const serviceAccountJson = requiredEnvironmentVariable("GOOGLE_SERVICE_ACCOUNT_JSON");
  const credentials = JSON.parse(serviceAccountJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

async function ensureSpreadsheetTabs(sheets) {
  const spreadsheetId = getSpreadsheetId();
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title"
  });

  const existingTabNames = new Set(
    (metadata.data.sheets || []).map(sheet => sheet.properties.title)
  );
  const requests = [];

  for (const tabName of ["Products", "Orders"]) {
    if (!existingTabNames.has(tabName)) {
      requests.push({ addSheet: { properties: { title: tabName } } });
    }
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests }
    });
  }

  // Ensure the first row contains the expected column headings.
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Products!A1:H1",
    valueInputOption: "RAW",
    requestBody: { values: [PRODUCT_COLUMNS] }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Orders!A1:J1",
    valueInputOption: "RAW",
    requestBody: { values: [ORDER_COLUMNS] }
  });
}

async function readSheetRows(sheets, range) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range
  });
  return result.data.values || [];
}

// Convert one Google Sheets row into a normal JavaScript product object.
function rowToProduct(row) {
  return {
    id: String(row[0] || ""),
    name: String(row[1] || ""),
    category: String(row[2] || ""),
    description: String(row[3] || ""),
    price: Number(row[4] || 0),
    imageUrl: String(row[5] || ""),
    active: String(row[6]).toLowerCase() !== "false",
    createdAt: String(row[7] || "")
  };
}

// ---------------------------------------------------------------------------
// 4. PRODUCT CATALOGUE
// Reads products for the storefront and seeds the five initial products once.
// ---------------------------------------------------------------------------

async function getProducts(sheets, includeInactive = false) {
  await ensureSpreadsheetTabs(sheets);
  let rows = await readSheetRows(sheets, "Products!A2:H");

  // Add starter products only if there are no product rows at all.
  if (rows.length === 0) {
    const initialRows = STARTER_PRODUCTS.map(product => [
      product.id,
      product.name,
      product.category,
      product.description,
      product.price,
      product.imageUrl,
      true,
      new Date().toISOString()
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: "Products!A:H",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: initialRows }
    });
    rows = initialRows;
  }

  return rows
    .map(rowToProduct)
    .filter(product => product.id && (includeInactive || product.active));
}

// ---------------------------------------------------------------------------
// 5. CUSTOMER ORDER CHECKOUT
// Validates the cart on the server, calculates the real total from Sheets,
// and saves the order with a pending WhatsApp confirmation status.
// ---------------------------------------------------------------------------

async function createOrder(request, sheets) {
  const body = await request.json();
  const requiredFields = ["customerName", "phone", "address", "deliveryDate", "timeSlot"];

  for (const field of requiredFields) {
    if (!String(body[field] || "").trim()) {
      throw new Error(`Please provide ${field}.`);
    }
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new Error("Your cart is empty.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.deliveryDate) || body.deliveryDate <= todayInIndia()) {
    throw new Error("Delivery date must be tomorrow or later.");
  }
  if (!STORE.deliverySlots.includes(body.timeSlot)) {
    throw new Error("Please choose one of the available delivery time slots.");
  }
  if (!/^[0-9+()\s-]{8,16}$/.test(String(body.phone))) {
    throw new Error("Please enter a valid phone number.");
  }

  // Never trust prices sent by a customer's browser. Look up current prices.
  const availableProducts = await getProducts(sheets, false);
  const orderItems = [];
  let subtotal = 0;

  for (const cartItem of body.items) {
    const product = availableProducts.find(item => item.id === String(cartItem.id));
    if (!product) {
      throw new Error("A product in your cart is no longer available.");
    }

    const quantity = Number(cartItem.quantity);
    const minimum = minimumForCategory(product.category);
    if (!Number.isInteger(quantity) || quantity < minimum) {
      throw new Error(`${product.name} requires a minimum order quantity of ${minimum}.`);
    }

    const lineTotal = product.price * quantity;
    subtotal += lineTotal;
    orderItems.push({
      id: product.id,
      name: product.name,
      category: product.category,
      quantity,
      price: product.price,
      lineTotal
    });
  }

  const orderId = `CD-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  const itemSummary = orderItems
    .map(item => `${item.name} x ${item.quantity} at INR ${item.price} each = INR ${item.lineTotal}`)
    .join(" | ");

  const order = {
    orderId,
    customerName: String(body.customerName).trim(),
    phone: String(body.phone).trim(),
    address: String(body.address).trim(),
    deliveryDate: body.deliveryDate,
    timeSlot: body.timeSlot,
    items: orderItems,
    subtotal,
    createdAt: new Date().toISOString()
  };

  // First save the order to Google Sheets. This is the main order record.
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: "Orders!A:J",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        order.orderId,
        order.createdAt,
        order.customerName,
        order.phone,
        order.address,
        order.deliveryDate,
        order.timeSlot,
        itemSummary,
        order.subtotal,
        "Pending WhatsApp confirmation"
      ]]
    }
  });

  // The customer is redirected to WhatsApp by the storefront after this
  // response. They must press Send so you receive their confirmation message.
  return {
    ok: true,
    orderId: order.orderId,
    items: order.items,
    subtotal: order.subtotal
  };
}

// ---------------------------------------------------------------------------
// 6. PRODUCT PHOTO UPLOADS TO GITHUB
// The admin portal sends the selected image here. The image is saved in
// site/assets/products/ in your GitHub repository. The token stays on server.
// ---------------------------------------------------------------------------

async function uploadProductImageToGitHub(image, productName) {
  if (!image) return "";
  if (!image.base64 || !image.mimeType || !image.name) {
    throw new Error("Invalid image upload.");
  }

  const fileTypes = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif"
  };
  const extension = fileTypes[image.mimeType];
  if (!extension) {
    throw new Error("Upload a JPG, PNG, WEBP or GIF image.");
  }

  const imageBuffer = Buffer.from(image.base64, "base64");
  if (imageBuffer.length > 3 * 1024 * 1024) {
    throw new Error("Image must be 3 MB or smaller.");
  }

  const owner = requiredEnvironmentVariable("GITHUB_OWNER");
  const repository = requiredEnvironmentVariable("GITHUB_REPO");
  const branch = optionalEnvironmentVariable("GITHUB_BRANCH") || "main";
  const token = requiredEnvironmentVariable("GITHUB_TOKEN");
  const fileName = `${makeId(productName)}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.${extension}`;
  const filePath = `site/assets/products/${fileName}`;
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath}`;

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: `Add product image ${fileName}`,
      content: imageBuffer.toString("base64"),
      branch
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GitHub image upload failed: ${result.message || response.statusText}`);
  }

  return `https://raw.githubusercontent.com/${owner}/${repository}/${branch}/${filePath}`;
}

// ---------------------------------------------------------------------------
// 7. ADMIN PRODUCT MANAGEMENT
// Add, edit and delete products. All changes are saved in Google Sheets.
// ---------------------------------------------------------------------------

async function saveProduct(request, sheets) {
  requireAdmin(request);
  const body = await request.json();

  if (!String(body.name || "").trim() || !STORE.categories.includes(body.category)) {
    throw new Error("Enter a product name and choose a valid category.");
  }

  const price = Number(body.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Enter a valid price greater than zero.");
  }

  const rows = await readSheetRows(sheets, "Products!A2:H");
  const productId = String(body.id || `${makeId(body.name)}-${crypto.randomBytes(3).toString("hex")}`);
  const existingIndex = rows.findIndex(row => String(row[0]) === productId);
  const existingProduct = existingIndex >= 0 ? rowToProduct(rows[existingIndex]) : null;

  // If no new image was selected, keep the current image URL.
  let imageUrl = String(body.imageUrl || existingProduct?.imageUrl || "");
  if (body.image && body.image.base64) {
    imageUrl = await uploadProductImageToGitHub(body.image, body.name);
  }

  const createdAt = existingProduct?.createdAt || new Date().toISOString();
  const rowValues = [[
    productId,
    String(body.name).trim(),
    body.category,
    String(body.description || "").trim(),
    price,
    imageUrl,
    true,
    createdAt
  ]];

  if (existingIndex >= 0) {
    const sheetRowNumber = existingIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `Products!A${sheetRowNumber}:H${sheetRowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: rowValues }
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: "Products!A:H",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rowValues }
    });
  }

  return { ok: true, product: rowToProduct(rowValues[0]) };
}

async function deleteProduct(request, sheets, url) {
  requireAdmin(request);
  const productId = url.searchParams.get("id");
  if (!productId) throw new Error("Missing product ID.");

  const rows = await readSheetRows(sheets, "Products!A2:H");
  const rowIndex = rows.findIndex(row => String(row[0]) === productId);
  if (rowIndex < 0) throw new Error("Product not found.");

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: getSpreadsheetId(),
    fields: "sheets.properties"
  });
  const productsTab = metadata.data.sheets.find(sheet => sheet.properties.title === "Products");

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: productsTab.properties.sheetId,
            dimension: "ROWS",
            startIndex: rowIndex + 1,
            endIndex: rowIndex + 2
          }
        }
      }]
    }
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// 8. ADMIN ORDER MANAGEMENT
// Read all orders and change an order's status in the Orders sheet.
// ---------------------------------------------------------------------------

async function getOrders(sheets) {
  const rows = await readSheetRows(sheets, "Orders!A2:J");
  return rows.map(row => ({
    orderId: String(row[0] || ""),
    createdAt: String(row[1] || ""),
    customerName: String(row[2] || ""),
    phone: String(row[3] || ""),
    address: String(row[4] || ""),
    deliveryDate: String(row[5] || ""),
    timeSlot: String(row[6] || ""),
    items: String(row[7] || ""),
    subtotal: Number(row[8] || 0),
    status: String(row[9] || "")
  })).reverse();
}

async function updateOrderStatus(request, sheets) {
  requireAdmin(request);
  const body = await request.json();
  const allowedStatuses = [
    "Pending WhatsApp confirmation",
    "Confirmed",
    "Preparing",
    "Out for delivery",
    "Delivered",
    "Cancelled"
  ];

  if (!body.orderId || !allowedStatuses.includes(body.status)) {
    throw new Error("Invalid order status update.");
  }

  const rows = await readSheetRows(sheets, "Orders!A2:J");
  const rowIndex = rows.findIndex(row => String(row[0]) === String(body.orderId));
  if (rowIndex < 0) throw new Error("Order not found.");

  const sheetRowNumber = rowIndex + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `Orders!J${sheetRowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [[body.status]] }
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// 9. API ROUTER
// This is the entry point. It reads the action requested by the website and
// sends the request to the correct function above.
// ---------------------------------------------------------------------------

export default async function handler(request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";

  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    // Admin login is checked before opening a Google Sheets connection.
    if (action === "login" && request.method === "POST") {
      const body = await request.json();
      const savedPassword = requiredEnvironmentVariable("ADMIN_PASSWORD");
      return jsonResponse({ ok: passwordsMatch(body.password, savedPassword) });
    }


    // All remaining actions need a working Google Sheets connection.
    const sheets = await getGoogleSheetsClient();
    await ensureSpreadsheetTabs(sheets);

    if (action === "products" && request.method === "GET") {
      return jsonResponse({ products: await getProducts(sheets, false) });
    }
    if (action === "order" && request.method === "POST") {
      return jsonResponse(await createOrder(request, sheets));
    }
    if (action === "products" && request.method === "POST") {
      return jsonResponse(await saveProduct(request, sheets));
    }
    if (action === "products" && request.method === "DELETE") {
      return jsonResponse(await deleteProduct(request, sheets, url));
    }
    if (action === "orders" && request.method === "GET") {
      requireAdmin(request);
      return jsonResponse({ orders: await getOrders(sheets) });
    }
    if (action === "order-status" && request.method === "PATCH") {
      return jsonResponse(await updateOrderStatus(request, sheets));
    }

    return jsonResponse({ error: "API action not found." }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const status = message === "Admin access denied." ? 401 : 400;
    console.error("Chateau Desserts API error:", message);
    return jsonResponse({ error: message }, status);
  }
}
