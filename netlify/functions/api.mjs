// ============================================================================
// CHATEAU DESSERTS - BACKEND API
// ============================================================================
// This file runs privately on Netlify. It connects the storefront and admin
// portal to Google Sheets, validates orders, and uploads images to GitHub.
// All passwords and tokens stay in Netlify environment variables.
//
// DATA MODEL
// - DessertTypes: the menu sections created by the owner (Brownies, Cookies,
//   Drinks, or any new section added in Admin. Standalone items have no type).
// - Items: products/flavours that belong to a dessert type. Every item has
//   its own full price. There is no base price or extra-charge calculation.
// - Orders: one row per distinct item/flavour line. Customer/order details are
//   repeated on each line; Order Subtotal appears only on the first line.
// - Products and Flavours: older tabs are retained as backups.
// ============================================================================

import { google } from "googleapis";
import crypto from "node:crypto";

// ============================================================================
// 1. STORE SETTINGS
// Change delivery slots or default starter items here if required.
// Box sizes are stored with each dessert type in Google Sheets and can be
// edited through Admin. Prices are stored separately on every item.
// ============================================================================
const STORE = {
  deliverySlots: [
    "12:00 PM to 2:00 PM",
    "2:00 PM to 4:00 PM",
    "4:00 PM to 6:00 PM"
  ]
};

const STARTER_DESSERT_TYPES = [
  { id: "brownies", name: "Brownies", orderMode: "box", boxSizes: "4,6,9", active: true },
  { id: "cookies", name: "Cookies", orderMode: "box", boxSizes: "2,4", active: true },
  { id: "drinks", name: "Drinks", orderMode: "individual", boxSizes: "", active: true }
];

const STARTER_ITEMS = [
  { id: "classic-brownie", dessertTypeId: "brownies", name: "Classic Brownie", description: "Product description coming soon.", price: 199, imageUrl: "", active: true },
  { id: "nutella-brownie", dessertTypeId: "brownies", name: "Nutella Brownie", description: "Product description coming soon.", price: 199, imageUrl: "", active: true },
  { id: "choco-chip-cookie", dessertTypeId: "cookies", name: "Choco Chip Cookie", description: "Product description coming soon.", price: 199, imageUrl: "", active: true },
  { id: "red-velvet-cookie", dessertTypeId: "cookies", name: "Red Velvet Cookie", description: "Product description coming soon.", price: 199, imageUrl: "", active: true }
];

const DESSERT_TYPE_COLUMNS = ["id", "name", "orderMode", "boxSizes", "active", "createdAt"];
const ITEM_COLUMNS = ["id", "dessertTypeId", "name", "description", "price", "imageUrl", "active", "createdAt"];
const MENU_SETTINGS_COLUMNS = ["key", "value"];
const MENU_ORDER_KEY = "sectionOrder";
const STANDALONE_SECTION_ID = "__standalone__";
const ORDER_COLUMNS = [
  "orderId", "createdAt", "customerName", "phone", "address", "deliveryDate", "timeSlot",
  "item", "flavour", "rate", "quantity", "itemTotal", "orderSubtotal", "status", "fulfilmentType"
];

// Cache schema checks and public menu data in warm Netlify function instances.
// The browser also keeps a short session cache so returning customers see the
// menu immediately while a fresh copy is checked in the background.
let schemaReadyUntil = 0;
let schemaSetupPromise = null;
let publicMenuCache = { expiresAt: 0, data: null };

// ============================================================================
// 2. COMMON HELPERS
// Small functions shared by the backend sections below.
// ============================================================================
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders
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

function makeId(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "item";
}

function uniqueId(value) {
  return `${makeId(value)}-${crypto.randomBytes(3).toString("hex")}`;
}

function todayInIndia() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function readableCreatedAt(date = new Date()) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

function passwordsMatch(suppliedPassword, savedPassword) {
  const supplied = Buffer.from(String(suppliedPassword || ""));
  const saved = Buffer.from(String(savedPassword || ""));
  return supplied.length === saved.length && crypto.timingSafeEqual(supplied, saved);
}

function requireAdmin(request) {
  const suppliedPassword = request.headers.get("x-admin-password") || "";
  const savedPassword = requiredEnvironmentVariable("ADMIN_PASSWORD");
  if (!passwordsMatch(suppliedPassword, savedPassword)) throw new Error("Admin access denied.");
}

function parseBoxSizes(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map(part => Number(part.trim()))
    .filter(number => Number.isInteger(number) && number > 0 && number <= 50)
    .filter((number, index, values) => values.indexOf(number) === index)
    .sort((a, b) => a - b);
}

function invalidateMenuCache() {
  publicMenuCache = { expiresAt: 0, data: null };
}

// ============================================================================
// 3. GOOGLE SHEETS CONNECTION AND SAFE DATA MIGRATION
// Creates the new tabs, preserves older tabs, migrates old Flavours into Items,
// and archives the old Orders layout before creating the new detailed layout.
// ============================================================================
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

async function readSheetRows(sheets, range) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range,
    valueRenderOption: "UNFORMATTED_VALUE"
  });
  return result.data.values || [];
}

async function appendSheetRows(sheets, range, values) {
  if (!values.length) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values }
  });
}

async function writeHeaderIfNeeded(sheets, tabName, columns) {
  const row = await readSheetRows(sheets, `${tabName}!A1:${String.fromCharCode(64 + columns.length)}1`);
  const current = row[0] || [];
  const matches = columns.every((column, index) => String(current[index] || "") === column);
  if (!matches) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `${tabName}!A1:${String.fromCharCode(64 + columns.length)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [columns] }
    });
  }
}

async function createMissingTabs(sheets, names) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: getSpreadsheetId(),
    fields: "sheets.properties(sheetId,title)"
  });
  const existing = new Set((metadata.data.sheets || []).map(sheet => sheet.properties.title));
  const requests = names.filter(name => !existing.has(name)).map(name => ({
    addSheet: { properties: { title: name } }
  }));
  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: getSpreadsheetId(), requestBody: { requests } });
  }
}

async function archiveOldOrdersTabIfRequired(sheets) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: getSpreadsheetId(),
    fields: "sheets.properties(sheetId,title)"
  });
  const sheetsInfo = metadata.data.sheets || [];
  const ordersTab = sheetsInfo.find(sheet => sheet.properties.title === "Orders");
  if (!ordersTab) return;

  const headerRows = await readSheetRows(sheets, "Orders!A1:O1");
  const currentHeader = headerRows[0] || [];
  // The previous V7 layout already has columns A:N. If so, preserve all old
  // rows and simply add the new fulfilmentType header in column O.
  const existingCoreLayoutMatches = ORDER_COLUMNS.slice(0, 14).every((column, index) => String(currentHeader[index] || "") === column);
  const fullLayoutMatches = ORDER_COLUMNS.every((column, index) => String(currentHeader[index] || "") === column);
  if (existingCoreLayoutMatches || fullLayoutMatches) return;

  const oldRows = await readSheetRows(sheets, "Orders!A1:Z2");
  const hasOldData = oldRows.some(row => row.some(value => String(value ?? "").trim() !== ""));
  if (!hasOldData) return;

  const usedNames = new Set(sheetsInfo.map(sheet => sheet.properties.title));
  let archiveName = "Orders Archive";
  let suffix = 2;
  while (usedNames.has(archiveName)) {
    archiveName = `Orders Archive ${suffix++}`;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId: ordersTab.properties.sheetId, title: archiveName },
            fields: "title"
          }
        },
        { addSheet: { properties: { title: "Orders" } } }
      ]
    }
  });
}

async function seedDessertTypesIfEmpty(sheets) {
  const rows = await readSheetRows(sheets, "DessertTypes!A2:F");
  if (rows.length) return;
  const createdAt = readableCreatedAt();
  await appendSheetRows(sheets, "DessertTypes!A:F", STARTER_DESSERT_TYPES.map(type => [
    type.id, type.name, type.orderMode, type.boxSizes, type.active, createdAt
  ]));
}

async function seedItemsIfEmpty(sheets) {
  const currentItems = await readSheetRows(sheets, "Items!A2:H");
  if (currentItems.length) return;

  // Upgrade existing Version 5 box-builder data without losing the existing
  // flavour names, photos or descriptions. Old prices are converted to full
  // prices: INR 199 base plus the former extra charge per piece.
  const oldFlavours = await readSheetRows(sheets, "Flavours!A2:H");
  if (oldFlavours.length) {
    const typeRows = await readSheetRows(sheets, "DessertTypes!A2:F");
    const knownTypes = new Set(typeRows.map(row => String(row[1] || "").toLowerCase()));
    const newRows = [];

    for (const row of oldFlavours) {
      const oldTypeName = String(row[1] || "Brownies").trim();
      const typeId = makeId(oldTypeName);
      if (!knownTypes.has(oldTypeName.toLowerCase())) {
        await appendSheetRows(sheets, "DessertTypes!A:F", [[
          typeId, oldTypeName, ["Brownies", "Cookies"].includes(oldTypeName) ? "box" : "individual",
          oldTypeName === "Brownies" ? "4,6,9" : oldTypeName === "Cookies" ? "2,4" : "",
          true, readableCreatedAt()
        ]]);
        knownTypes.add(oldTypeName.toLowerCase());
      }
      newRows.push([
        String(row[0] || uniqueId(row[2] || "item")),
        typeId,
        String(row[2] || "Untitled item"),
        String(row[3] || ""),
        Math.max(0, Math.round(199 + Number(row[4] || 0))),
        String(row[5] || ""),
        String(row[6]).toLowerCase() !== "false",
        String(row[7] || readableCreatedAt())
      ]);
    }
    await appendSheetRows(sheets, "Items!A:H", newRows);
    return;
  }

  await appendSheetRows(sheets, "Items!A:H", STARTER_ITEMS.map(item => [
    item.id, item.dessertTypeId, item.name, item.description, item.price,
    item.imageUrl, item.active, readableCreatedAt()
  ]));
}

async function ensureSpreadsheetTabs(sheets) {
  if (Date.now() < schemaReadyUntil) return;
  if (schemaSetupPromise) return schemaSetupPromise;

  schemaSetupPromise = (async () => {
    await archiveOldOrdersTabIfRequired(sheets);
    await createMissingTabs(sheets, ["Products", "Flavours", "DessertTypes", "Items", "MenuSettings", "Orders"]);
    await writeHeaderIfNeeded(sheets, "DessertTypes", DESSERT_TYPE_COLUMNS);
    await writeHeaderIfNeeded(sheets, "Items", ITEM_COLUMNS);
    await writeHeaderIfNeeded(sheets, "MenuSettings", MENU_SETTINGS_COLUMNS);
    await writeHeaderIfNeeded(sheets, "Orders", ORDER_COLUMNS);
    await seedDessertTypesIfEmpty(sheets);
    await seedMenuOrderIfEmpty(sheets);
    await seedItemsIfEmpty(sheets);
    schemaReadyUntil = Date.now() + 120000;
  })();

  try {
    await schemaSetupPromise;
  } catch (error) {
    schemaReadyUntil = 0;
    throw error;
  } finally {
    schemaSetupPromise = null;
  }
}

// ============================================================================
// 4. CATALOGUE - DESSERT TYPES AND ITEMS
// Items have full independent prices. For box types, item names become the
// flavour choices shown for each piece inside a box. Individual types show
// regular product cards with quantity controls.
// ============================================================================
function defaultMenuOrder(types) {
  const boxTypes = types.filter(type => type.orderMode === "box").map(type => type.id);
  const individualTypes = types.filter(type => type.orderMode !== "box").map(type => type.id);
  return [...boxTypes, STANDALONE_SECTION_ID, ...individualTypes];
}

function normalizeMenuOrder(savedOrder, types) {
  const validIds = new Set([...types.map(type => type.id), STANDALONE_SECTION_ID]);
  const source = Array.isArray(savedOrder) ? savedOrder : defaultMenuOrder(types);
  const normalized = [];
  for (const id of source) {
    const key = String(id);
    if (validIds.has(key) && !normalized.includes(key)) normalized.push(key);
  }
  // Add newly-created menu types without disturbing the order already chosen.
  for (const type of types) if (!normalized.includes(type.id)) normalized.push(type.id);
  if (!normalized.includes(STANDALONE_SECTION_ID)) {
    const firstIndividualIndex = normalized.findIndex(id => types.some(type => type.id === id && type.orderMode !== "box"));
    normalized.splice(firstIndividualIndex < 0 ? normalized.length : firstIndividualIndex, 0, STANDALONE_SECTION_ID);
  }
  return normalized;
}

async function seedMenuOrderIfEmpty(sheets) {
  const rows = await readSheetRows(sheets, "MenuSettings!A2:B");
  if (rows.some(row => String(row[0]) === MENU_ORDER_KEY)) return;
  const typeRows = await readSheetRows(sheets, "DessertTypes!A2:F");
  const types = typeRows.map(rowToDessertType).filter(type => type.id);
  await appendSheetRows(sheets, "MenuSettings!A:B", [[MENU_ORDER_KEY, JSON.stringify(defaultMenuOrder(types))]]);
}

function rowToDessertType(row) {
  return {
    id: String(row[0] || ""),
    name: String(row[1] || ""),
    orderMode: String(row[2] || "individual"),
    boxSizes: parseBoxSizes(row[3]),
    active: String(row[4]).toLowerCase() !== "false",
    createdAt: String(row[5] || "")
  };
}

function normalizeImageUrl(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.hostname === "github.com") {
      const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
      if (match) return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}/${match[4]}`;
    }
    return input;
  } catch (_) {
    return "";
  }
}

function rowToItem(row) {
  return {
    id: String(row[0] || ""),
    dessertTypeId: String(row[1] || ""),
    name: String(row[2] || ""),
    description: String(row[3] || ""),
    price: Number(row[4] || 0),
    imageUrl: normalizeImageUrl(row[5]),
    active: String(row[6]).toLowerCase() !== "false",
    createdAt: String(row[7] || "")
  };
}

async function getCatalogue(sheets, includeInactive = false, fresh = false) {
  await ensureSpreadsheetTabs(sheets);
  if (!includeInactive && !fresh && publicMenuCache.data && Date.now() < publicMenuCache.expiresAt) {
    return publicMenuCache.data;
  }

  const [typeRows, itemRows, settingsRows] = await Promise.all([
    readSheetRows(sheets, "DessertTypes!A2:F"),
    readSheetRows(sheets, "Items!A2:H"),
    readSheetRows(sheets, "MenuSettings!A2:B")
  ]);
  const allTypes = typeRows.map(rowToDessertType).filter(type => type.id);
  const typeMap = new Map(allTypes.map(type => [type.id, type]));
  const allItems = itemRows.map(rowToItem).filter(item => item.id).map(item => ({
    ...item,
    dessertType: typeMap.get(item.dessertTypeId)?.name || ""
  }));

  const types = allTypes.filter(type => includeInactive || type.active);
  const allowedTypeIds = new Set(types.map(type => type.id));
  const items = allItems.filter(item =>
    (!item.dessertTypeId || allowedTypeIds.has(item.dessertTypeId)) &&
    (includeInactive || item.active)
  );
  const storedOrderRow = settingsRows.find(row => String(row[0]) === MENU_ORDER_KEY);
  let storedOrder = null;
  try { storedOrder = storedOrderRow ? JSON.parse(String(storedOrderRow[1] || "[]")) : null; } catch (_) { storedOrder = null; }
  const menuOrder = normalizeMenuOrder(storedOrder, types);
  const catalogue = { dessertTypes: types, items, menuOrder };
  if (!includeInactive) publicMenuCache = { data: catalogue, expiresAt: Date.now() + 5 * 60 * 1000 };
  return catalogue;
}

// ============================================================================
// 5. CUSTOMER ORDER VALIDATION AND GOOGLE SHEETS RECORDING
// Creates one spreadsheet row per distinct item/flavour within a box or
// individual product line. Every row has Rate, Quantity and Item Total.
// Order Subtotal is written once on the first row of each order so Excel sums
// the order total only once. Customer fields are repeated on every line.
// ============================================================================
async function getNextOrderId(sheets) {
  const rows = await readSheetRows(sheets, "Orders!A2:A");
  let highest = 0;
  for (const row of rows) {
    const value = Number(row[0]);
    if (Number.isSafeInteger(value) && value > highest) highest = value;
  }
  return highest + 1;
}

function groupBoxSelections(items) {
  const grouped = new Map();
  for (const item of items) {
    const current = grouped.get(item.id) || { id: item.id, name: item.name, rate: item.price, quantity: 0 };
    current.quantity += 1;
    grouped.set(item.id, current);
  }
  return [...grouped.values()].map(item => ({ ...item, itemTotal: item.rate * item.quantity }));
}

async function createOrder(request, sheets) {
  const body = await request.json();
  const requiredFields = ["customerName", "phone", "deliveryDate", "timeSlot"];
  for (const field of requiredFields) {
    if (!String(body[field] || "").trim()) throw new Error(`Please provide ${field}.`);
  }
  if (!Array.isArray(body.items) || body.items.length === 0) throw new Error("Your cart is empty.");

  const fulfilmentType = String(body.fulfilmentType || "delivery").toLowerCase();
  if (!["delivery", "pickup"].includes(fulfilmentType)) throw new Error("Choose pickup or delivery.");
  const address = String(body.address || "").trim();
  if (fulfilmentType === "delivery" && !address) throw new Error("Please provide your delivery address.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.deliveryDate) || body.deliveryDate <= todayInIndia()) {
    throw new Error("The pickup or delivery date must be tomorrow or later.");
  }
  if (!STORE.deliverySlots.includes(body.timeSlot)) throw new Error("Please choose an available pickup or delivery time slot.");
  if (!/^[0-9+()\s-]{8,16}$/.test(String(body.phone))) throw new Error("Please enter a valid phone number.");

  const catalogue = await getCatalogue(sheets, false, true);
  const typeMap = new Map(catalogue.dessertTypes.map(type => [type.id, type]));
  const itemMap = new Map(catalogue.items.map(item => [item.id, item]));
  const whatsappItems = [];
  const orderLines = [];
  const boxNumbersByType = new Map();
  let subtotal = 0;

  for (const cartEntry of body.items) {
    const dessertTypeId = String(cartEntry.dessertTypeId || "");

    // Standalone products have no dessert type and are ordered individually.
    if (!dessertTypeId) {
      const item = itemMap.get(String(cartEntry.itemId || ""));
      const quantity = Number(cartEntry.quantity);
      if (!item || item.dessertTypeId) throw new Error("One standalone item is no longer available. Please refresh the menu.");
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Enter a valid item quantity.");
      const itemTotal = item.price * quantity;
      subtotal += itemTotal;
      orderLines.push({ item: item.name, flavour: "", rate: item.price, quantity, itemTotal });
      whatsappItems.push({ kind: "individual", name: item.name, quantity, rate: item.price, lineTotal: itemTotal });
      continue;
    }

    const type = typeMap.get(dessertTypeId);
    if (!type) throw new Error("A menu section is no longer available. Please refresh the menu.");

    if (type.orderMode === "box") {
      const boxSize = Number(cartEntry.boxSize);
      if (!type.boxSizes.includes(boxSize)) throw new Error(`The selected ${type.name} box size is not available.`);
      if (!Array.isArray(cartEntry.itemIds) || cartEntry.itemIds.length !== boxSize) {
        throw new Error(`${type.name} Box of ${boxSize} must have exactly ${boxSize} item selections.`);
      }
      const selectedItems = cartEntry.itemIds.map(id => {
        const item = itemMap.get(String(id));
        if (!item || item.dessertTypeId !== type.id) throw new Error("One selected flavour is no longer available. Please refresh the menu.");
        return item;
      });
      const groupedLines = groupBoxSelections(selectedItems);
      const boxNumber = (boxNumbersByType.get(type.id) || 0) + 1;
      boxNumbersByType.set(type.id, boxNumber);
      const boxLabel = `${type.name} Box of ${boxSize} - Box ${boxNumber}`;
      const boxTotal = groupedLines.reduce((sum, line) => sum + line.itemTotal, 0);
      subtotal += boxTotal;

      // Each flavour becomes its own sheet row, but all rows carry the same
      // box label so the box can be identified as one grouped item.
      orderLines.push(...groupedLines.map(line => ({
        item: boxLabel,
        flavour: line.name,
        rate: line.rate,
        quantity: line.quantity,
        itemTotal: line.itemTotal
      })));
      whatsappItems.push({
        kind: "box",
        name: boxLabel,
        boxSize,
        lines: groupedLines,
        lineTotal: boxTotal
      });
    } else {
      const item = itemMap.get(String(cartEntry.itemId || ""));
      const quantity = Number(cartEntry.quantity);
      if (!item || item.dessertTypeId !== type.id) throw new Error("One selected item is no longer available. Please refresh the menu.");
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Enter a valid item quantity.");
      const itemTotal = item.price * quantity;
      subtotal += itemTotal;
      orderLines.push({ item: item.name, flavour: "", rate: item.price, quantity, itemTotal });
      whatsappItems.push({ kind: "individual", name: item.name, quantity, rate: item.price, lineTotal: itemTotal });
    }
  }

  const orderId = await getNextOrderId(sheets);
  const createdAt = readableCreatedAt();
  const customer = {
    customerName: String(body.customerName).trim(),
    phone: String(body.phone).trim(),
    address: fulfilmentType === "delivery" ? address : "",
    deliveryDate: body.deliveryDate,
    timeSlot: body.timeSlot,
    fulfilmentType
  };
  const status = "Pending WhatsApp confirmation";
  const values = orderLines.map((line, index) => [
    orderId, createdAt, customer.customerName, customer.phone, customer.address,
    customer.deliveryDate, customer.timeSlot, line.item, line.flavour, line.rate,
    line.quantity, line.itemTotal, index === 0 ? subtotal : "", status, fulfilmentType
  ]);
  await appendSheetRows(sheets, "Orders!A:O", values);

  // orderId is returned for the private Admin dashboard and spreadsheet.
  // The customer-facing WhatsApp message is assembled without this reference.
  return { ok: true, orderId, createdAt, customer, items: whatsappItems, lines: orderLines, subtotal, fulfilmentType };
}

// ============================================================================
// 6. IMAGE UPLOADS TO GITHUB
// The private GitHub token stays on the server. Images are stored in the
// repository folder site/assets/products/ and the returned URL is saved in
// the Items tab.
// ============================================================================
async function uploadItemImageToGitHub(image, itemName) {
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
  const fileName = `${makeId(itemName)}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.${extension}`;
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
      message: `Add item image ${fileName}`,
      content: imageBuffer.toString("base64"),
      branch
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GitHub image upload failed: ${result.message || response.statusText}`);
  return `https://raw.githubusercontent.com/${owner}/${repository}/${branch}/${filePath}`;
}

// ============================================================================
// 7. ADMIN MANAGEMENT - DESSERT TYPES
// Admin can add, edit, activate/deactivate and delete menu sections. A type
// can use a build-your-own-box flow or individual item ordering.
// ============================================================================
async function saveDessertType(request, sheets) {
  requireAdmin(request);
  const body = await request.json();
  const name = String(body.name || "").trim();
  const orderMode = String(body.orderMode || "individual");
  const boxSizes = parseBoxSizes(body.boxSizes);
  if (!name) throw new Error("Enter a dessert type name.");
  if (!["box", "individual"].includes(orderMode)) throw new Error("Choose a valid ordering format.");
  if (orderMode === "box" && boxSizes.length === 0) throw new Error("Enter at least one box size, for example 4, 6, 9.");

  const rows = await readSheetRows(sheets, "DessertTypes!A2:F");
  const id = String(body.id || uniqueId(name));
  const existingIndex = rows.findIndex(row => String(row[0]) === id);
  const existing = existingIndex >= 0 ? rowToDessertType(rows[existingIndex]) : null;
  const duplicate = rows.some((row, index) => index !== existingIndex && String(row[1] || "").trim().toLowerCase() === name.toLowerCase());
  if (duplicate) throw new Error("A dessert type with this name already exists.");
  const rowValues = [[id, name, orderMode, orderMode === "box" ? boxSizes.join(",") : "", body.active !== false, existing?.createdAt || readableCreatedAt()]];

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(), range: `DessertTypes!A${rowNumber}:F${rowNumber}`,
      valueInputOption: "RAW", requestBody: { values: rowValues }
    });
  } else {
    await appendSheetRows(sheets, "DessertTypes!A:F", rowValues);
  }
  invalidateMenuCache();
  return { ok: true, dessertType: rowToDessertType(rowValues[0]) };
}

async function deleteDessertType(request, sheets, url) {
  requireAdmin(request);
  const id = url.searchParams.get("id");
  if (!id) throw new Error("Missing dessert type ID.");
  const items = await readSheetRows(sheets, "Items!A2:H");
  if (items.some(row => String(row[1]) === id)) {
    throw new Error("This dessert type still has items. Delete or move those items before deleting the type.");
  }
  const rows = await readSheetRows(sheets, "DessertTypes!A2:F");
  const index = rows.findIndex(row => String(row[0]) === id);
  if (index < 0) throw new Error("Dessert type not found.");
  await deleteSheetRow(sheets, "DessertTypes", index);
  invalidateMenuCache();
  return { ok: true };
}

async function saveMenuOrder(request, sheets) {
  requireAdmin(request);
  const body = await request.json();
  if (!Array.isArray(body.menuOrder)) throw new Error("Provide the new menu section order.");

  const typeRows = await readSheetRows(sheets, "DessertTypes!A2:F");
  const types = typeRows.map(rowToDessertType).filter(type => type.id);
  const normalized = normalizeMenuOrder(body.menuOrder, types);
  const settingsRows = await readSheetRows(sheets, "MenuSettings!A2:B");
  const existingIndex = settingsRows.findIndex(row => String(row[0]) === MENU_ORDER_KEY);
  const values = [[MENU_ORDER_KEY, JSON.stringify(normalized)]];
  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(), range: `MenuSettings!A${rowNumber}:B${rowNumber}`,
      valueInputOption: "RAW", requestBody: { values }
    });
  } else {
    await appendSheetRows(sheets, "MenuSettings!A:B", values);
  }
  invalidateMenuCache();
  return { ok: true, menuOrder: normalized };
}

async function deleteSheetRow(sheets, tabName, dataRowIndexZeroBased) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: getSpreadsheetId(), fields: "sheets.properties(sheetId,title)"
  });
  const tab = (metadata.data.sheets || []).find(sheet => sheet.properties.title === tabName);
  if (!tab) throw new Error(`${tabName} tab not found.`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: tab.properties.sheetId,
            dimension: "ROWS",
            startIndex: dataRowIndexZeroBased + 1,
            endIndex: dataRowIndexZeroBased + 2
          }
        }
      }]
    }
  });
}

// ============================================================================
// 8. ADMIN MANAGEMENT - ITEMS
// Every item has its own full selling price. No base price or extra charge is
// added. For box types, items appear as the flavour choices for each piece.
// For individual types, items appear as normal product cards.
// ============================================================================
async function saveItem(request, sheets) {
  requireAdmin(request);
  const body = await request.json();
  const name = String(body.name || "").trim();
  const dessertTypeId = String(body.dessertTypeId || "");
  const priceText = String(body.price ?? "").trim();
  const price = Number(priceText);
  if (!name) throw new Error("Enter an item name.");
  if (!priceText || !Number.isInteger(price) || price < 0) throw new Error("Enter a valid full item price in INR.");

  const types = (await getCatalogue(sheets, true, true)).dessertTypes;
  // A blank dessertTypeId means standalone. A selected type must be active.
  if (dessertTypeId && !types.some(type => type.id === dessertTypeId && type.active)) {
    throw new Error("Choose an active dessert type or select Standalone item.");
  }

  const rows = await readSheetRows(sheets, "Items!A2:H");
  const id = String(body.id || uniqueId(name));
  const existingIndex = rows.findIndex(row => String(row[0]) === id);
  const existing = existingIndex >= 0 ? rowToItem(rows[existingIndex]) : null;
  let imageUrl = String(body.imageUrl || existing?.imageUrl || "");
  if (body.image && body.image.base64) imageUrl = await uploadItemImageToGitHub(body.image, name);
  const rowValues = [[
    id, dessertTypeId, name, String(body.description || "").trim(), price,
    imageUrl, body.active !== false, existing?.createdAt || readableCreatedAt()
  ]];

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(), range: `Items!A${rowNumber}:H${rowNumber}`,
      valueInputOption: "RAW", requestBody: { values: rowValues }
    });
  } else {
    await appendSheetRows(sheets, "Items!A:H", rowValues);
  }
  invalidateMenuCache();
  return { ok: true, item: rowToItem(rowValues[0]) };
}

async function deleteItem(request, sheets, url) {
  requireAdmin(request);
  const id = url.searchParams.get("id");
  if (!id) throw new Error("Missing item ID.");
  const rows = await readSheetRows(sheets, "Items!A2:H");
  const index = rows.findIndex(row => String(row[0]) === id);
  if (index < 0) throw new Error("Item not found.");
  await deleteSheetRow(sheets, "Items", index);
  invalidateMenuCache();
  return { ok: true };
}

// ============================================================================
// 9. ADMIN ORDER MANAGEMENT
// Orders are grouped by numeric order ID for the admin page. A status change
// updates every spreadsheet line belonging to that order.
// ============================================================================
async function getOrders(sheets) {
  const rows = await readSheetRows(sheets, "Orders!A2:O");
  const ordersById = new Map();
  for (const row of rows) {
    const orderId = String(row[0] ?? "");
    if (!orderId) continue;
    if (!ordersById.has(orderId)) {
      ordersById.set(orderId, {
        orderId,
        createdAt: String(row[1] || ""),
        customerName: String(row[2] || ""),
        phone: String(row[3] || ""),
        address: String(row[4] || ""),
        deliveryDate: String(row[5] || ""),
        timeSlot: String(row[6] || ""),
        subtotal: Number(row[12] || 0),
        status: String(row[13] || ""),
        fulfilmentType: String(row[14] || "delivery").toLowerCase(),
        lines: []
      });
    }
    ordersById.get(orderId).lines.push({
      item: String(row[7] || ""),
      flavour: String(row[8] || ""),
      rate: Number(row[9] || 0),
      quantity: Number(row[10] || 0),
      itemTotal: Number(row[11] || 0)
    });
  }
  return [...ordersById.values()].reverse();
}

async function updateOrderStatus(request, sheets) {
  requireAdmin(request);
  const body = await request.json();
  const allowedStatuses = [
    "Pending WhatsApp confirmation", "Confirmed", "Preparing",
    "Out for delivery", "Delivered", "Cancelled"
  ];
  if (body.orderId === undefined || !allowedStatuses.includes(body.status)) throw new Error("Invalid order status update.");

  const rows = await readSheetRows(sheets, "Orders!A2:N");
  const matchingRows = [];
  rows.forEach((row, index) => {
    if (String(row[0]) === String(body.orderId)) matchingRows.push(index + 2);
  });
  if (!matchingRows.length) throw new Error("Order not found.");

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      valueInputOption: "RAW",
      data: matchingRows.map(rowNumber => ({ range: `Orders!N${rowNumber}`, values: [[body.status]] }))
    }
  });
  return { ok: true };
}

// ============================================================================
// 10. API ROUTER
// Connects the storefront and protected admin portal to the functions above.
// ============================================================================
export default async function handler(request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";

  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });

    // Login checks the password without opening Google Sheets.
    if (action === "login" && request.method === "POST") {
      const body = await request.json();
      const savedPassword = requiredEnvironmentVariable("ADMIN_PASSWORD");
      return jsonResponse({ ok: passwordsMatch(body.password, savedPassword) });
    }

    // Fast path: reuse the warm function-instance catalogue without opening
    // Google Sheets again. The CDN cache below also serves repeat requests
    // across function instances. This cache contains public active catalogue
    // data only; admin and order responses are never cached.
    if (action === "menu" && request.method === "GET" &&
        publicMenuCache.data && Date.now() < publicMenuCache.expiresAt) {
      return jsonResponse(publicMenuCache.data, 200, {
        "cache-control": "public, max-age=0, must-revalidate",
        "netlify-cdn-cache-control": "public, durable, max-age=60, stale-while-revalidate=300",
        "netlify-cache-tag": "chateau-public-menu-v10"
      });
    }

    const sheets = await getGoogleSheetsClient();
    await ensureSpreadsheetTabs(sheets);

    if (action === "menu" && request.method === "GET") {
      const catalogue = await getCatalogue(sheets, false);
      return jsonResponse(catalogue, 200, {
        "cache-control": "public, max-age=0, must-revalidate",
        "netlify-cdn-cache-control": "public, durable, max-age=60, stale-while-revalidate=300",
        "netlify-cache-tag": "chateau-public-menu-v10"
      });
    }
    if (action === "catalogue" && request.method === "GET") {
      requireAdmin(request);
      return jsonResponse(await getCatalogue(sheets, true, true));
    }
    if (action === "items" && request.method === "POST") {
      return jsonResponse(await saveItem(request, sheets));
    }
    if (action === "items" && request.method === "DELETE") {
      return jsonResponse(await deleteItem(request, sheets, url));
    }
    if (action === "dessert-types" && request.method === "POST") {
      return jsonResponse(await saveDessertType(request, sheets));
    }
    if (action === "dessert-types" && request.method === "DELETE") {
      return jsonResponse(await deleteDessertType(request, sheets, url));
    }
    if (action === "menu-order" && request.method === "POST") {
      return jsonResponse(await saveMenuOrder(request, sheets));
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
