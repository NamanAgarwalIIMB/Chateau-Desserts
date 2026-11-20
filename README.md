# Chateau Desserts Website - Version 3

This version uses GitHub for the source repository and product image storage, Netlify for website hosting and server-side functions, and Google Sheets as the live product and order database. It does not use Google Apps Script to host the website or run its backend.

## What is included

- Public storefront with menu, About Us and Contact Us sections
- Initial orderable products, all priced at INR 199
  - Brownies: Classic Brownie, Nutella Brownie
  - Cookies: Choco Chip Cookie, Red Velvet Cookie
  - Drinks: Hot Chocolate
- No Other Desserts section is shown until a product is added to that category in the admin portal
- No product photos are included initially
- Shopping cart and quantity controls
- Server-side minimum quantity checks: 4 per brownie item, 2 per cookie item, 1 for drinks and other desserts
- Checkout with name, phone, address, delivery date and the three requested time slots
- Server checks that the delivery date is tomorrow or later and calculates prices from the live Google Sheets catalogue
- Checkout saves the order to the Orders tab and then opens WhatsApp with the full message prefilled
- Separate admin page at `/admin.html`, not linked from the customer storefront
- Admin Products tab: add, edit and delete products
- Admin Orders tab: view customer orders and update order status
- Admin image upload: uploads JPG, PNG, WEBP or GIF files up to 3 MB to `site/assets/products/` in the connected GitHub repository

## Project layout

- `site/index.html` - public storefront
- `site/admin.html` - separate admin portal
- `site/assets/products/` - product image folder; uploaded images are committed here
- `netlify/functions/api.mjs` - secure backend for Sheets, orders and GitHub image upload
- `netlify.toml` - Netlify publish and function settings
- `package.json` - backend dependency

## Recommended hosting arrangement

Use a GitHub repository as the source of truth and image store, connected to Netlify for hosting. Netlify deploys the public files and runs the backend functions. GitHub Pages alone is not suitable for this version because the project needs server-side functions to keep the Google service account and GitHub upload token secret.

## Setup part 1 - GitHub repository

1. Create a new repository in your GitHub account. Make it **public** if you want the uploaded product pictures to be displayed using their raw GitHub image addresses.
2. Upload the complete contents of this project to the repository root. Keep the folders as they are.
3. The repository branch should be `main`, or set the actual branch name in Netlify as `GITHUB_BRANCH`.
4. Do not put any API keys, passwords, service-account JSON files or personal access tokens in the repository.

## Setup part 2 - Google Sheets API access

This setup uses the Google Sheets API directly. You do not need to open Apps Script.

1. Create or choose a Google Sheet for the store's records.
2. Copy the spreadsheet ID from its URL. It is the part between `/d/` and `/edit`.
3. In Google Cloud Console, create a project and enable the **Google Sheets API**.
4. Create a service account and create a JSON key for it.
5. Open the JSON key file privately and copy the entire JSON contents. Do not upload the JSON key to GitHub or share it publicly.
6. Copy the `client_email` value from that JSON. Share the Google Sheet with this email address and give it Editor access.
7. The backend will create the `Products` and `Orders` tabs and their column headings when the website is first opened. It will also add the five starter products if the Products tab contains no products.

The live workbook stays in Google Sheets. You can export an Excel copy from Google Sheets using File, Download, Microsoft Excel.

## Setup part 3 - GitHub image upload permission

1. In GitHub, create a fine-grained personal access token.
2. Limit it to only the Chateau Desserts repository.
3. Grant **Contents: Read and write** permission. No workflow permission is needed for this app.
4. Save the token privately. Do not put it in the website files or GitHub repository.

When you upload a product photo in the admin portal, the Netlify function writes the image into `site/assets/products/` using the GitHub Contents API. The file becomes a commit in your repository. The product image URL is saved in the Google Sheets Products tab. Uploaded image files are not automatically removed when you delete a product; you can clean unused images from the repository later.

## Setup part 4 - Netlify deployment

1. Create a Netlify account.
2. From the Netlify dashboard choose Add new project, then Import an existing project.
3. Connect GitHub and select your Chateau Desserts repository.
4. The included `netlify.toml` sets the publish directory to `site` and the functions directory to `netlify/functions`. Leave the build command blank.
5. Before the first public test, open the site's environment variable settings and add these variables. Make sure they are available to **Functions** at runtime.

| Variable | Value |
|---|---|
| `GOOGLE_SPREADSHEET_ID` | The ID copied from your Google Sheet URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The entire service-account JSON key contents |
| `ADMIN_PASSWORD` | A strong, private admin password |
| `GITHUB_TOKEN` | The fine-grained GitHub token |
| `GITHUB_OWNER` | Your GitHub username or repository owner |
| `GITHUB_REPO` | The repository name |
| `GITHUB_BRANCH` | `main`, or your repository's branch |

6. Save the variables and trigger a fresh deploy. Netlify applies changed environment variables to new deploys.
7. Open the Netlify site URL. The public storefront is the home page. The admin portal is at `https://YOUR-SITE.netlify.app/admin.html`.

## First test

1. Open the public page and confirm that all five starter products appear at INR 199.
2. Add one Classic Brownie. The cart should add the minimum 4 pieces. The minus button cannot reduce the quantity below 4; it removes the item instead.
3. Add one Choco Chip Cookie. The cart should add the minimum 2 pieces.
4. Try selecting today's date. The date picker starts tomorrow, and the server also rejects today's date.
5. Complete the checkout form and choose one of the three delivery slots.
6. Continue to WhatsApp. The order should be saved in the Google Sheets Orders tab, and WhatsApp should open with an order summary. You must press Send in WhatsApp yourself.
7. Open `/admin.html`, log in, and confirm the order appears under Orders.
8. Add a test product in the Products tab. It should appear on the public website after saving.
9. Try uploading a small JPG or PNG to a product. The file should appear in `site/assets/products/` in GitHub, and the product photo should appear on the website.

## Important notes

- The starter menu is seeded only when the Products tab has no product rows. If you are reusing a spreadsheet that already has product rows, remove old test rows from the Products tab first if you want the five starter products to be inserted.
- The public menu reads product names, categories, descriptions, prices and image URLs from Google Sheets. Product updates from the admin portal are written to that sheet.
- The admin password is checked by the backend. The password is sent over HTTPS for admin operations but is never stored in the public website source. Use a unique password and do not share the `/admin.html` URL or password unnecessarily.
- The GitHub token and Google service-account credentials are stored as Netlify environment variables and are only read by the server-side function. Never add them to the repository.
- A public GitHub repository means its source code and uploaded product images are public. Never upload private customer data, order details or secrets into it. Order and customer data are stored only in the private Google Sheet.
- A customer order is recorded when they click Continue to WhatsApp, before they press Send in WhatsApp. Treat the Sheet record as an order enquiry until you see the customer's WhatsApp message and confirm availability.
- The initial version does not take online payments, calculate delivery fees or validate individual Surat PIN codes.
- Netlify's free plan has monthly usage limits. Check the current plan limits in your Netlify dashboard before relying on it for a large amount of traffic.
- Image upload is limited to 3 MB per file so the request stays within the hosting function's request-size limits.
