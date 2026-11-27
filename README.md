# Chateau Desserts — Clean V1

This is a clean storefront rebuild direction based on the selected design:
- Chocolate / cocoa / warm neutral palette
- Photography-led hero
- Menu displayed as scrollable sections
- Box builder opens as an overlay on the same URL
- Separate admin portal at `/admin.html`
- Existing Google Sheets + Netlify Functions + GitHub image-upload API contract retained

## Important status

This is a first clean draft, not a live deployment. The homepage and admin portal are included. The backend API is carried forward from the prior V9 integration to preserve the current spreadsheet/order/image-upload contract. Test it in a Netlify Deploy Preview before merging anything into production.

The hero and story photography are image slots. Add your own optimised brand photographs:
- `site/assets/hero-desserts.jpg`
- `site/assets/story-desserts.jpg` (optional; currently the story area has a colour treatment)

Product photos are uploaded through Admin and stored in `site/assets/products/` via the GitHub API.

## Setup / safe branch workflow

1. In GitHub, create a new branch named `chateau-new-design` **from the production branch `GITHUB_BRANCH`**. Do not branch from the old `website-development` draft.
2. Add the contents of this package to that new branch. Keep the existing production branch unchanged.
3. In Netlify, ensure Deploy Previews are enabled for pull requests.
4. Set the Deploy Preview environment variable `GITHUB_BRANCH` to `chateau-new-design`. Keep the production-context value pointing to the existing production branch `GITHUB_BRANCH`.
5. Keep the existing Netlify environment variables for Google Sheets, Google service account, GitHub owner/repo/token, and admin password. Do not paste credentials into files or GitHub.
6. Open a pull request from `chateau-new-design` into the production branch. Use its Deploy Preview URL for testing. Do not merge until the storefront, admin, image uploads, and test order are verified.

## Admin

Open `/admin.html`. Admin login uses the existing `ADMIN_PASSWORD` Netlify environment variable. The portal supports:
- Add/edit/delete products and menu sections
- Upload product photos to GitHub
- Reorder menu sections
- View orders and update their statuses

## Menu and checkout behaviour

- Brownie/cookie box types use the configured box sizes in Google Sheets and require one flavour selection per piece.
- Each box is added as a separate cart entry.
- Individual items are added directly to the cart.
- Pickup and delivery are supported; delivery address is required only for delivery.
- The earliest order date is tomorrow.
- Time slots: 12 PM–2 PM, 2 PM–4 PM, 4 PM–6 PM.
- Order details are saved to Google Sheets before WhatsApp opens.
- The WhatsApp message does not include the internal order ID.
- Delivery charges are not calculated in this draft; they are to be confirmed with the customer.

## Image notes

For fast first paint, the storefront shell does not wait for image downloads or a Google Sheets request to render. The menu loads from the API after the page shell is visible. Product images are lazy-loaded. The hero image is marked high priority.

Use compressed WebP/JPEG images sized for their display area. Keep product images reasonably small (ideally a few hundred KB each). If you prefer a `.webp` hero, update the `src` in `site/index.html`.

## Before public launch

- Replace hero/story placeholders with real brand photography.
- Confirm product names, descriptions, prices and photos in Admin.
- Test the modal builder for each box size.
- Test pickup and delivery checkout with a dummy order.
- Confirm the WhatsApp message and Google Sheet rows.
- Verify image uploads on the Deploy Preview branch.
- Review mobile layout and accessibility.
- Do not merge the pull request until all checks pass.
