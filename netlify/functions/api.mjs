// ============================================================================
// CHATEAU DESSERTS - BACKEND API (BOX CUSTOMIZATION UPDATE FOR VERSION 5)
// ============================================================================
// This file runs on Netlify's servers. It connects to Google Sheets, validates
// brownie/cookie box selections, records orders and uploads flavour photos to
// GitHub. Private credentials stay in Netlify environment variables.
//
// IMPORTANT:
// - Keep GOOGLE_SERVICE_ACCOUNT_JSON, ADMIN_PASSWORD and GITHUB_TOKEN private.
// - Existing Products and Orders tabs are preserved.
// - The new Flavours tab stores the individual brownie and cookie flavours.
// ============================================================================

import { google } from "googleapis";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// 1. STORE SETTINGS
// Edit these settings if box sizes, base price or delivery slots change.
// The base price is per piece. A flavour's extra charge is ALSO per piece.
// Example: base INR 199 + Nutella extra INR 30 = INR 229 per Nutella piece.
// ---------------------------------------------------------------------------
const STORE = {
  basePricePerPiece: 199,
  boxSizes: {
    Brownies: [4, 6, 9],
    Cookies: [2, 4]
  },
  deliverySlots: [
    "12:00 PM to 2:00 PM",
    "2:00 PM to 4:00 PM",
    "4:00 PM to 6:00 PM"
  ]
};

// These flavours are added only when the new Flavours sheet has no entries.
// You can later add, edit or remove flavours through /admin.html.
const STARTER_FLAVOURS = [
  { id: "classic-brownie", dessertType: "Brownies", name: "Classic Brownie", description: "Product description coming soon.", extraPrice: 0, imageUrl: "", active: true },
  { id: "nutella-brownie", dessertType: "Brownies", name: "Nutella Brownie", description: "Product description coming soon.", extraPrice: 0, imageUrl: "", active: true },
  { id: "choco-chip-cookie", dessertType: "Cookies", name: "Choco Chip Cookie", description: "Product description coming soon.", extraPrice: 0, imageUrl: "", active: true },
  { id: "red-velvet-cookie", dessertType: "Cookies", name: "Red Velvet Cookie", description: "Product description coming soon.", extraPrice: 0, imageUrl: "", active: true }
];

// Column headings for the Google Sheets tabs.
const LEGACY_PRODUCT_COLUMNS = ["id", "name", "category", "description", "price", "imageUrl", "active", "createdAt"];
const FLAVOUR_COLUMNS = ["id", "dessertType", "name", "description", "extraPrice", "imageUrl", "active", "createdAt"];
const ORDER_COLUMNS = ["orderId", "createdAt", "customerName", "phone", "address", "deliveryDate", "timeSlot", "items", "subtotal", "status"];

// ---------------------------------------------------------------------------
// 2. COMMON HELPERS
// Small reusable functions used by different backend sections.
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
  if (!value) throw new Error(`Missing Netlify environment variable: ${name}`);
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
    .slice(0, 48) || "flavour";
}

function todayInIndia() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

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
// Creates Flavours if needed and keeps the old Products and Orders tabs.
// The old Products tab is deliberately not deleted or overwritten with menu
// flavour information. New menu data goes into the separate Flavours tab.
// ---------------------------------------------------------------------------
function getSpreadsheetId() {
  return requiredEnvironmentVariable("GOOGLE_SPREADSHEET_ID");
}

async function getGoogleSheetsClient() {
  const credentials = JSON.parse(requiredEnvironmentVariable("GOOGLE_SERVICE_ACCOUNT_JSON"));
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

  const existingNames = new Set((metadata.data.sheets || []).map(sheet => sheet.properties.title));
  const requests = [];
  for (const tabName of ["Products", "Orders", "Flavours"]) {
    if (!existingNames.has(tabName)) {
      requests.push({ addSheet: { properties: { title: tabName } } });
    }
  }
  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  }

  // Keep the old Products tab's existing structure as a backup.
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: "Products!A1:H1", valueInputOption: "RAW",
    requestBody: { values: [LEGACY_PRODUCT_COLUMNS] }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: "Flavours!A1:H1", valueInputOption: "RAW",
    requestBody: { values: [FLAVOUR_COLUMNS] }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: "Orders!A1:J1", valueInputOption: "RAW",
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

function rowToFlavour(row) {
  return {
    id: String(row[0] || ""),
    dessertType: String(row[1] || ""),
    name: String(row[2] || ""),
    description: String(row[3] || ""),
    extraPrice: Number(row[4] || 0),
    imageUrl: String(row[5] || ""),
    active: String(row[6]).toLowerCase() !== "false",
    createdAt: String(row[7] || "")
  };
}

// ---------------------------------------------------------------------------
// 4. FLAVOUR MENU
// The storefront asks for active flavours. The admin page can request all
// flavours, including inactive ones, after providing the admin password.
// ---------------------------------------------------------------------------
async function getFlavours(sheets, includeInactive = false) {
  await ensureSpreadsheetTabs(sheets);
  let rows = await readSheetRows(sheets, "Flavours!A2:H");

  // Seed the four starter flavours only if the new tab has no flavour rows.
  if (rows.length === 0) {
    const starterRows = STARTER_FLAVOURS.map(flavour => [
      flavour.id,
      flavour.dessertType,
      flavour.name,
      flavour.description,
      flavour.extraPrice,
      flavour.imageUrl,
      true,
      new Date().toISOString()
    ]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: "Flavours!A:H",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: starterRows }
    });
    rows = starterRows;
  }

  return rows.map(rowToFlavour)
    .filter(flavour => flavour.id && (includeInactive || flavour.active));
}

// ---------------------------------------------------------------------------
// 5. CUSTOMER BOX ORDER CHECKOUT
// Each box contains a flavour choice for every individual piece. The server
// checks box size and every flavour against Google Sheets, then calculates
// the price itself. Prices sent by the customer's browser are never trusted.
// ---------------------------------------------------------------------------
async function createOrder(request, sheets) {
  const body = await request.json();
  const requiredFields = ["customerName", "phone", "address", "deliveryDate", "timeSlot"];
  for (const field of requiredFields) {
    if (!String(body[field] || "").trim()) throw new Error(`Please provide ${field}.`);
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

  const availableFlavours = await getFlavours(sheets, false);
  const orderItems = [];
  let subtotal = 0;

  for (const cartBox of body.items) {
    const dessertType = String(cartBox.dessertType || "");
    const boxSize = Number(cartBox.boxSize);
    const allowedSizes = STORE.boxSizes[dessertType];
    if (!allowedSizes || !allowedSizes.includes(boxSize)) {
      throw new Error("One of the selected box sizes is not available.");
    }
    if (!Array.isArray(cartBox.flavourIds) || cartBox.flavourIds.length !== boxSize) {
      throw new Error(`A ${dessertType.toLowerCase()} box of ${boxSize} must have exactly ${boxSize} flavour selections.`);
    }

    const selectedFlavours = cartBox.flavourIds.map(flavourId => {
      const flavour = availableFlavours.find(item => item.id === String(flavourId));
      if (!flavour || flavour.dessertType !== dessertType) {
        throw new Error("A flavour in your box is no longer available. Please refresh the menu.");
      }
      const unitPrice = STORE.basePricePerPiece + flavour.extraPrice;
      return {
        id: flavour.id,
        name: flavour.name,
        extraPrice: flavour.extraPrice,
        unitPrice
      };
    });

    const lineTotal = selectedFlavours.reduce((sum, flavour) => sum + flavour.unitPrice, 0);
    subtotal += lineTotal;
    orderItems.push({
      name: `${dessertType} Box of ${boxSize}`,
      dessertType,
      boxSize,
      flavours: selectedFlavours,
      lineTotal
    });
  }

  const orderId = `CD-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  const itemSummary = orderItems.map(box => {
    const counts = new Map();
    for (const flavour of box.flavours) {
      const current = counts.get(flavour.name) || { count: 0, unitPrice: flavour.unitPrice };
      current.count += 1;
      counts.set(flavour.name, current);
    }
    const breakdown = [...counts.entries()]
      .map(([name, detail]) => `${name} x ${detail.count} at INR ${detail.unitPrice} each`)
      .join(", ");
    return `${box.name}: ${breakdown} = INR ${box.lineTotal}`;
  }).join(" | ");

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

  // Save the order request before opening WhatsApp. The customer must still
  // press Send in WhatsApp for you to receive the actual order message.
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

  return {
    ok: true,
    orderId: order.orderId,
    items: order.items,
    subtotal: order.subtotal
  };
}

// ---------------------------------------------------------------------------
// 6. FLAVOUR PHOTO UPLOADS TO GITHUB
// Admin-selected images are stored in site/assets/products/ in the repository.
// The GitHub token is read from Netlify and never sent to the browser.
// ---------------------------------------------------------------------------
async function uploadFlavourImageToGitHub(image, flavourName) {
  if (!image) return "";
  if (!image.base64 || !image.mimeType || !image.name) throw new Error("Invalid image upload.");

  const fileTypes = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif"
  };
  const extension = fileTypes[image.mimeType];
  if (!extension) throw new Error("Upload a JPG, PNG, WEBP or GIF image.");

  const imageBuffer = Buffer.from(image.base64, "base64");
  if (imageBuffer.length > 3 * 1024 * 1024) throw new Error("Image must be 3 MB or smaller.");

  const owner = requiredEnvironmentVariable("GITHUB_OWNER");
  const repository = requiredEnvironmentVariable("GITHUB_REPO");
  const branch = optionalEnvironmentVariable("GITHUB_BRANCH") || "main";
  const token = requiredEnvironmentVariable("GITHUB_TOKEN");
  const fileName = `${makeId(flavourName)}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.${extension}`;
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
      message: `Add flavour image ${fileName}`,
      content: imageBuffer.toString("base64"),
      branch
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GitHub image upload failed: ${result.message || response.statusText}`);

  return `https://raw.githubusercontent.com/${owner}/${repository}/${branch}/${filePath}`;
}

// ---------------------------------------------------------------------------
// 7. ADMIN FLAVOUR MANAGEMENT
// Add, edit, delete and display individual flavours with their per-piece extra.
// The final price per piece is basePricePerPiece + extraPrice.
// ---------------------------------------------------------------------------
async function saveFlavour(request, sheets) {
  requireAdmin(request);
  const body = await request.json();
  const dessertTypes = Object.keys(STORE.boxSizes);
  const name = String(body.name || "").trim();
  const dessertType = String(body.dessertType || "");
  const extraPrice = Number(body.extraPrice);

  if (!name || !dessertTypes.includes(dessertType)) {
    throw new Error("Enter a flavour name and choose Brownies or Cookies.");
  }
  if (!Number.isInteger(extraPrice) || extraPrice < 0) {
    throw new Error("Enter a valid extra charge of INR 0 or more per piece.");
  }

  const rows = await readSheetRows(sheets, "Flavours!A2:H");
  const flavourId = String(body.id || `${makeId(name)}-${crypto.randomBytes(3).toString("hex")}`);
  const existingIndex = rows.findIndex(row => String(row[0]) === flavourId);
  const existingFlavour = existingIndex >= 0 ? rowToFlavour(rows[existingIndex]) : null;

  let imageUrl = String(body.imageUrl || existingFlavour?.imageUrl || "");
  if (body.image && body.image.base64) {
    imageUrl = await uploadFlavourImageToGitHub(body.image, name);
  }

  const rowValues = [[
    flavourId,
    dessertType,
    name,
    String(body.description || "").trim(),
    extraPrice,
    imageUrl,
    true,
    existingFlavour?.createdAt || new Date().toISOString()
  ]];

  if (existingIndex >= 0) {
    const sheetRowNumber = existingIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `Flavours!A${sheetRowNumber}:H${sheetRowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: rowValues }
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: "Flavours!A:H",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rowValues }
    });
  }

  return { ok: true, flavour: rowToFlavour(rowValues[0]) };
}

async function deleteFlavour(request, sheets, url) {
  requireAdmin(request);
  const flavourId = url.searchParams.get("id");
  if (!flavourId) throw new Error("Missing flavour ID.");

  const rows = await readSheetRows(sheets, "Flavours!A2:H");
  const rowIndex = rows.findIndex(row => String(row[0]) === flavourId);
  if (rowIndex < 0) throw new Error("Flavour not found.");

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: getSpreadsheetId(),
    fields: "sheets.properties"
  });
  const flavoursTab = metadata.data.sheets.find(sheet => sheet.properties.title === "Flavours");
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: flavoursTab.properties.sheetId,
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
// Reads saved order requests and updates their status in the Orders tab.
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

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `Orders!J${rowIndex + 2}`,
    valueInputOption: "RAW",
    requestBody: { values: [[body.status]] }
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 9. API ROUTER
// Maps public storefront and protected admin requests to the functions above.
// ---------------------------------------------------------------------------
export default async function handler(request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";

  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });

    // Login can be checked without opening a spreadsheet connection.
    if (action === "login" && request.method === "POST") {
      const body = await request.json();
      const savedPassword = requiredEnvironmentVariable("ADMIN_PASSWORD");
      return jsonResponse({ ok: passwordsMatch(body.password, savedPassword) });
    }

    const sheets = await getGoogleSheetsClient();
    await ensureSpreadsheetTabs(sheets);

    if (action === "flavours" && request.method === "GET") {
      const includeInactive = url.searchParams.get("includeInactive") === "true";
      if (includeInactive) requireAdmin(request);
      const flavours = await getFlavours(sheets, includeInactive);
      return jsonResponse({
        basePricePerPiece: STORE.basePricePerPiece,
        boxSizes: STORE.boxSizes,
        flavours
      });
    }
    if (action === "flavours" && request.method === "POST") {
      return jsonResponse(await saveFlavour(request, sheets));
    }
    if (action === "flavours" && request.method === "DELETE") {
      return jsonResponse(await deleteFlavour(request, sheets, url));
    }
    if (action === "order" && request.method === "POST") {
      return jsonResponse(await createOrder(request, sheets));
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
