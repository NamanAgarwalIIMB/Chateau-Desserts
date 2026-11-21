# Chateau Desserts code guide

This guide explains which file and section to edit for common changes. The project is split into the customer website, the admin portal and the server-side backend.

## 1. Project map

| File or folder | What it controls |
|---|---|
| `site/index.html` | Customer-facing website: page layout, menu, cart, checkout form and WhatsApp message |
| `site/admin.html` | Separate password-protected admin page: product management, image upload and order management |
| `netlify/functions/api.mjs` | Server-side functions: Google Sheets, order validation, GitHub photo upload and admin operations |
| `site/assets/products/` | Folder where product photos uploaded through the admin portal are stored in GitHub |
| `netlify.toml` | Tells Netlify where the public site and server functions are located |
| `package.json` | Lists the backend package used to connect to Google Sheets |
| `.env.example` | Names of required settings only; it must not contain real credentials |
| `README.md` | Setup and deployment instructions |

## 2. Main website: `site/index.html`

| Section | What it controls |
|---|---|
| 1 | Page information and document setup |
| 2 | Brand colours and global styling |
| 3 | Navigation bar |
| 4 | Introductory / hero section |
| 5 | Product menu and category sections |
| 6 | About and contact sections |
| 7 onward | Cart panel and responsive layout |
| 16 | Website settings, including WhatsApp number and minimum quantities |
| 17 | Page state and common helper functions |
| 18 | Loading and displaying products |
| 19 | Shopping cart and quantity controls |
| 20 | Delivery date rules |
| 21 | Checkout, Google Sheets order submission and WhatsApp message |
| 22 | Initial page startup |

### Change the WhatsApp number

Find Section 16, `WEBSITE SETTINGS`. Change `WHATSAPP_NUMBER` to the country code and phone number using digits only. For India, start with `91` and then the ten-digit mobile number. Also update the displayed contact details in the Contact section so both places match.

### Change minimum quantities

Change the values in Section 16, `MINIMUM_QUANTITY`. The same rules are enforced on the server in `netlify/functions/api.mjs`, Section 1, `STORE.minimumQuantity`. Keep both copies identical.

### Change the website colours

Find Section 2 and edit the CSS variables such as `--ink`, `--muted`, `--paper`, `--accent` and `--line`.

### Change delivery time slots

Update the time-slot options in the checkout form in `site/index.html`. Also update `STORE.deliverySlots` in `netlify/functions/api.mjs`, Section 1. The two lists must match exactly because the server validates the submitted slot.

## 3. Admin portal: `site/admin.html`

| Section | What it controls |
|---|---|
| 1-5 | Page details, colours, buttons, panels and mobile layout |
| 6-8 | Admin page header, password login and dashboard tabs |
| 9 | Add, edit, delete and list products |
| 10 | View customer orders and change order statuses |
| 11 onward | Admin page state, backend request helper, login, tabs, product loading, image selection and order display |

Use the admin page at `/admin.html` for ordinary menu changes. The page is not linked in the customer navigation. Customers do not need an admin account to place orders.

## 4. Backend: `netlify/functions/api.mjs`

| Section | What it controls |
|---|---|
| 1 | Store settings, categories, minimum quantities, delivery slots and starter products |
| 2 | Shared helper functions and admin password checks |
| 3 | Google Sheets connection and creation of the Products and Orders tabs |
| 4 | Reading and displaying the product catalogue |
| 5 | Customer checkout validation and saving orders to Google Sheets |
| 6 | Uploading product photos into the GitHub repository |
| 7 | Adding, editing and deleting products |
| 8 | Reading orders and updating order statuses |
| 9 | API router: directs website requests to the correct backend function |

## 5. Add, edit or remove a product

Use `/admin.html`. Product information is stored in the Google Sheets `Products` tab. Product images selected in the admin page are uploaded by the backend to `site/assets/products/` in the GitHub repository.

The starter products in Section 1 of `api.mjs` are added only when the Products sheet is empty. Once you have products in the sheet, make routine catalogue changes through the admin portal rather than editing the starter list.

## 6. How customer orders work

1. The customer adds products to the cart and enters their contact and delivery details.
2. The website sends the order details to the backend.
3. The backend validates current products, quantities, prices, delivery date and time slot.
4. The backend saves the order in the Google Sheets `Orders` tab with the status `Pending WhatsApp confirmation`.
5. The website opens WhatsApp with the order summary and customer details already written in the message.
6. The customer must press **Send** in WhatsApp. You receive their message in your own WhatsApp and can confirm availability and payment directly with them.

Important: a row is created in Google Sheets when the customer clicks checkout, before they press Send in WhatsApp. Check WhatsApp before confirming the order. A saved row by itself does not prove the customer sent the message.

## 7. Important security and editing rules

- Never put Google service account JSON, GitHub tokens or the admin password in a website file.
- Never commit a real `.env` file or private credentials to GitHub.
- Keep `netlify/functions/` outside the public `site/` folder.
- Keep customer orders in the private Google Sheet. Do not put customer details in the public GitHub repository.
- When changing a Netlify environment variable, redeploy the site so the backend uses the new value.
- When making code changes, preserve the folder structure and commit the updated files to the branch Netlify deploys, usually `main`.
