# Chateau Desserts Website - Organized Version 5

This is the organized version of the Chateau Desserts website. It keeps the existing GitHub + Netlify hosting setup, Google Sheets product and order database, admin portal, product photo upload and WhatsApp order-confirmation flow. The code is divided into numbered sections with comments explaining each part.

## What the website does

- Shows the Chateau Desserts storefront, menu, About and Contact sections.
- Starts with five products priced at INR 199 if the Products sheet is empty.
- Supports Brownies, Cookies, Drinks and Other Desserts categories.
- Enforces minimum quantities: 4 per brownie item, 2 per cookie item and 1 for other categories.
- Uses pre-orders only and requires a delivery date from tomorrow onwards.
- Offers delivery slots of 12 PM to 2 PM, 2 PM to 4 PM and 4 PM to 6 PM.
- Saves each checkout request in Google Sheets.
- Opens WhatsApp with a prefilled, readable order message. The customer must press Send so the owner receives the request and can confirm availability and payment.
- Provides a separate password-protected admin page at `/admin.html` to manage products, images and order statuses.
- Uploads product photos to `site/assets/products/` in the GitHub repository.

There is no separate phone-alert service in this version. The customer sends the order to the business through WhatsApp, and the business receives that WhatsApp message to confirm the order and arrange payment.

## Project structure

```text
chateau-desserts-website/
  site/
    index.html                 Customer-facing website
    admin.html                 Separate admin portal
    assets/products/           Product photos uploaded from Admin
  netlify/
    functions/
      api.mjs                  Google Sheets, orders, GitHub uploads and admin backend
  netlify.toml                 Netlify hosting configuration
  package.json                 Backend dependency list
  .env.example                 Names of required settings only
  CODE_GUIDE.md                Code map and instructions for common edits
  README.md                    Setup and deployment guide
```

## 1. Update your existing GitHub repository

This is an update to your existing website project, not a new website. Keep using the same GitHub repository connected to your Netlify site.

1. Download and extract this ZIP file.
2. Open your existing GitHub repository.
3. Choose **Add file**, then **Upload files**.
4. Upload the contents of the extracted folder, keeping the folder structure exactly as shown above. The files should sit at the top level of the repository. Do not upload an extra enclosing folder around them.
5. Replace the old copies of `site/index.html`, `site/admin.html`, `netlify/functions/api.mjs`, `netlify.toml`, `package.json`, `.env.example`, `README.md` and `CODE_GUIDE.md`.
6. Commit the changes to the same branch Netlify deploys, usually `main`.

Netlify should start a new deployment after the GitHub commit. Existing environment variables saved in Netlify remain saved when you update website files.

## 2. Required Netlify environment variables

The backend needs these settings in your Chateau Desserts Netlify project under **Manage → Keys and secrets**. Add them as server-side function variables (Functions scope, or All scopes if that is the available option).

| Variable name | What to enter |
|---|---|
| `GOOGLE_SPREADSHEET_ID` | The ID from the middle of your Google Sheets URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The complete contents of the Google service account JSON key file |
| `ADMIN_PASSWORD` | A strong password you choose for the admin portal |
| `GITHUB_TOKEN` | A GitHub fine-grained token with access to repository contents |
| `GITHUB_OWNER` | Your GitHub username or organization name |
| `GITHUB_REPO` | The name of the connected website repository |
| `GITHUB_BRANCH` | The branch Netlify deploys, usually `main` |

Do not paste actual secrets into this README, a website file, GitHub, or a public support message. The `.env.example` file contains placeholder values only.

## 3. Google Sheets connection

1. Create or open your private Google spreadsheet.
2. In Google Cloud, select the project where you enabled the Google Sheets API.
3. Create a service account and download its JSON key.
4. Copy the `client_email` value from the JSON file.
5. Share only the Chateau Desserts spreadsheet with that email address and give it Editor permission.
6. Add the spreadsheet ID and the complete JSON file contents to Netlify using the variable names in Section 2.

The backend creates the `Products` and `Orders` tabs automatically if they do not already exist. It adds starter products only if the Products tab has no product rows.

## 4. GitHub product photo uploads

The admin page accepts JPG, PNG, WEBP and GIF images up to 3 MB. The backend uses the GitHub token stored in Netlify to upload the selected photo to `site/assets/products/` in the repository. The product's image address is saved in the Products sheet.

Create a GitHub fine-grained personal access token with access only to the website repository and permission to read and write repository contents. Store it only in Netlify as `GITHUB_TOKEN`. Do not put it in the front-end code or commit it to GitHub.

## 5. WhatsApp order confirmation flow

1. Customer adds items and enters their name, phone number, delivery address, delivery date and time slot.
2. The website sends the order to the backend.
3. The backend checks product availability, prices, minimum quantities and delivery rules.
4. The order request is saved to the Google Sheets `Orders` tab as `Pending WhatsApp confirmation`.
5. WhatsApp opens with a prefilled message containing the order reference, items, total and customer details.
6. The customer presses **Send**. You receive the message in your WhatsApp and can confirm the order and payment directly.

**Important:** The Google Sheets row is created when the customer clicks Continue to WhatsApp, before they press Send. This means an entry can exist even if the customer closes WhatsApp without sending. Confirm the customer's WhatsApp message before accepting or processing the order.

## 6. Admin portal

Open `https://YOUR-SITE.netlify.app/admin.html` and sign in with the password saved as `ADMIN_PASSWORD` in Netlify.

The portal has:
- Products: add, edit, delete and upload product photos.
- Orders: review customer details and change order statuses.

The admin page is not linked in the storefront navigation. Keep the admin password private.

## 7. Deploy updates

After uploading changed files to GitHub and committing them to the deploy branch, Netlify normally starts a new deployment automatically. Wait until the deployment is marked Published before testing the website.

If you change a Netlify environment variable, trigger a new deployment so the server functions use the updated value.

## 8. First test checklist

- Open the customer storefront and confirm the five starter products appear (if the Products sheet was empty).
- Open `/admin.html` and sign in.
- Add a temporary test product and check that it appears on the storefront and in the Products sheet.
- Test an order with dummy customer details and a delivery date from tomorrow onwards.
- Confirm the order appears in the Orders sheet with `Pending WhatsApp confirmation`.
- Confirm WhatsApp opens with the prefilled message and press Send from your own test device/account as appropriate.
- Confirm the admin Orders tab displays the test order.
- Delete the temporary test product and test order if you do not want them retained.

## 9. Important limitations

- This starter does not collect online payments. Payment and order confirmation happen directly with the customer on WhatsApp.
- The website does not automatically know whether the customer pressed Send in WhatsApp. Check the message before confirming an order.
- Google Sheets, Netlify and GitHub free usage is subject to each provider's limits and policies.
- Test the complete flow before sharing the website publicly.

Development branch created for Chateau Desserts website updates.
