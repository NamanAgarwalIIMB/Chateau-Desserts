# Chateau Desserts V9 Code Guide

## Main customer website: `site/index.html`

- Section 1: Page metadata and title.
- Section 2: CSS and responsive design. Includes the image display, box-size selector and flavour dropdown design.
- Section 3: Navigation.
- Section 4: Introductory hero.
- Section 5: Dynamic menu container.
- Section 6: About Us.
- Section 7: Contact details.
- Section 8: Footer.
- Section 9: Cart drawer and checkout form.
- Section 10: API URL, WhatsApp number and menu cache.
- Section 11: Menu and cart state.
- Section 12: Fast menu loading.
- Section 13: Menu rendering, photos and admin-controlled section ordering.
- Section 14: Box builder and flavour dropdowns.
- Section 15: Individual item quantity and Add to Cart.
- Section 16: Cart calculations and display.
- Section 17: Earliest selectable date.
- Section 18: Pickup/delivery checkout and WhatsApp message.
- Section 19: Page initialisation.

To change the WhatsApp number, edit `WHATSAPP_NUMBER` in Section 10.

## Admin portal: `site/admin.html`

- Sections 1-8: Admin page, login, items form, dessert type form, orders panel.
- Section 9: API settings and state.
- Section 10: API helper.
- Section 11: Login/logout.
- Section 12: Tab switching.
- Section 13: Load catalogue.
- Section 14: Add/edit/delete items and upload images.
- Section 15: Add/edit/delete dessert types.
- Section 16: View/update orders.
- Menu section order panel: reorder categories and Standalone Items using Move up/Move down.

## Backend: `netlify/functions/api.mjs`

- Section 1: delivery slots and starter types/items.
- Section 2: shared helpers and image URL normalisation.
- Section 3: Google Sheets setup, schema and MenuSettings.
- Section 4: catalogue reads and menu order.
- Section 5: customer order validation and spreadsheet recording.
- Section 6: GitHub image upload.
- Section 7: dessert type management and menu order saving.
- Section 8: item management.
- Section 9: order management.
- Section 10: API routing.

## Google Sheets tabs

- `DessertTypes`: main menu types and box size settings.
- `Items`: names, descriptions, individual full prices and image URLs.
- `MenuSettings`: stores the order in which public menu sections appear.
- `Orders`: customer/order details with one row per flavour/item line.
- `Products` and `Flavours`: retained legacy tabs.
