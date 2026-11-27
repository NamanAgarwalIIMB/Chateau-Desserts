# Code guide

- `site/index.html`: clean storefront, menu rendering, box builder overlay, cart and checkout.
- `site/admin.html`: admin portal UI.
- `netlify/functions/api.mjs`: retained backend API for Google Sheets, orders, menu management and GitHub image uploads.
- `netlify.toml`: Netlify build/publish/function configuration.
- `site/assets/products/`: product image upload destination.

Customer product-selection overlay is implemented in `openBuilder()` / `renderPieceChoices()` in `site/index.html`.
