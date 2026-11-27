# Chateau Desserts Website V9

This is the full V9 website package, based on your V8 project. It includes:

- Brownie and cookie build-your-own-box sections with a size dropdown and one flavour dropdown per piece.
- Product photos inside the Brownies and Cookies menu previews and flavour dropdowns.
- Standalone items and individual product sections.
- Admin portal forms that submit when Enter is pressed.
- Admin menu section ordering with Move up and Move down controls, including the Standalone Items section.
- Google Sheets catalogue and order management.
- GitHub image uploads through the Netlify backend.
- Pickup and delivery checkout, pre-order dates, and WhatsApp confirmation.

## Update your existing GitHub repository

1. Download and extract this complete ZIP.
2. Open your existing GitHub repository.
3. Replace the contents with the matching files from this package, keeping the same folder structure.
4. Commit to your current deployment branch (usually `main`).
5. Netlify should automatically deploy the commit.

Do not delete your Google Sheet, Google Cloud project, Netlify project or existing environment variables. No new environment variables are required.

## Photo display notes

V8 rendered photos for individual product cards, but the Brownies and Cookies box cards and flavour selectors did not include the saved image URL in their markup. V9 now displays item photos in those areas. If a saved photo still falls back to the placeholder, check that the `Items` sheet has a valid `imageUrl` and that the GitHub repository containing images is public. Public customer browsers cannot fetch raw image files from a private GitHub repository. Keep your existing `site/assets/products/` folder and all uploaded image files in GitHub when replacing the code; those user-uploaded images are not bundled into this ZIP.

The upload function stores images at `site/assets/products/` and records the raw GitHub URL in the Items sheet. Your GitHub repository needs to be public for those raw image URLs to be readable by customers.

## Menu arrangement

The backend creates a `MenuSettings` tab with a `sectionOrder` entry. The default order is Brownies, Cookies, Standalone Items, then individual dessert types such as Drinks. In Admin → Dessert Types → Menu section order, use Move up and Move down to rearrange the live storefront.

## Enter key behaviour

The customer checkout, admin login, add/edit item form and add/edit dessert type form are now HTML forms. Pressing Enter in a single-line field submits the corresponding form. Enter inside a text area continues to create a new line.

## Pricing

There is no global base price. Every item/flavour retains its own full price in the Items sheet. The starter item prices remain INR 199 only as editable examples.

## Deployment and testing

The source files have been syntax-checked. Live Google Sheets, GitHub uploads, Netlify deployment, and WhatsApp checkout must still be tested in your accounts after deployment. Test with a dummy order before publishing the site to customers.
