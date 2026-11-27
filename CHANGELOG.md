# Chateau Desserts — Changelog

## V10 (2026-11-28)
- Changed the customer menu cache from sessionStorage to persistent localStorage. Returning visitors can render the last saved catalogue immediately, including after closing and reopening the browser.
- The browser now displays a saved catalogue immediately and refreshes it in the background. If refresh fails, the saved catalogue remains visible.
- Increased the warm Netlify Function in-memory public catalogue cache to five minutes.
- Added a warm-function fast path for public menu requests, avoiding Google Sheets initialisation while a fresh in-memory catalogue is available.
- Added Netlify CDN cache headers for the public menu endpoint (60-second CDN freshness with stale-while-revalidate).
- Kept private admin catalogue, customer orders, and order status responses out of public caching.
- Preserved the V9 storefront, admin portal, Google Sheets integration, GitHub image upload flow, cart, checkout, and WhatsApp ordering.

## V9
- Brownie and cookie build-your-own-box selectors with photos.
- Standalone items, individual pricing, admin catalogue management, menu ordering, Google Sheets orders, GitHub image uploads, pickup/delivery checkout, and WhatsApp confirmation.
