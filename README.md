# Chateau Desserts Website V11

This is the complete V10 website package, based on the original V9 project. It preserves the V9 storefront and admin experience and adds persistent browser caching plus Netlify CDN caching for the public menu. It includes:

- Brownie and cookie build-your-own-box sections with a size dropdown and one flavour dropdown per piece.
- Product photos inside the Brownies and Cookies menu previews and flavour dropdowns.
- Standalone items and individual product sections.
- Admin portal forms that submit when Enter is pressed.
- Admin menu section ordering with Move up and Move down controls, including the Standalone Items section.
- Google Sheets catalogue and order management.
- GitHub image uploads through the Netlify backend.
- Pickup and delivery checkout, pre-order dates, and WhatsApp confirmation.

## Deploy V10 to the development branch only

1. Download and extract this ZIP.
2. Open your existing GitHub repository and switch to the `website-development` branch. Confirm the branch name before making changes.
3. Upload/replace the project files from this package while preserving the same folder structure. Keep all existing files under `site/assets/products/`; this ZIP contains only `.gitkeep` there and does not include your uploaded product images.
4. Commit directly to `website-development`. Do not commit to the production branch and do not merge this branch into production.
5. In Netlify, confirm the resulting deploy is a branch deploy for `website-development`, not a production deploy.
6. In Netlify's branch-specific environment settings, set `GITHUB_BRANCH=website-development` for the `website-development` deploy context if the image-upload function needs to write to that branch. Keep the production-context value of `GITHUB_BRANCH` unchanged. Do not alter other existing secrets.

Do not delete your Google Sheet, Google Cloud project, Netlify project, existing environment variables, or uploaded product images. V10 introduces no new environment variables.

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


## V10 menu caching notes

- Returning visitors read the last successfully loaded public menu from localStorage and render it before the network refresh completes.
- The menu endpoint uses Netlify CDN caching with a 60-second freshness window and stale-while-revalidate. A cold first-time visitor still needs the first network response; no browser-only technique can display the live Google Sheets catalogue before the browser has received it at least once.
- The Netlify Function also retains a public catalogue in warm memory for five minutes and uses it without reinitialising Google Sheets while that cache is fresh.
- Admin mutations invalidate the function's in-memory catalogue through the existing V9 invalidation logic. CDN entries may remain cached for up to 60 seconds, so allow up to roughly one minute for changes to propagate to all visitors.
- Only the public active menu is CDN-cached. Admin catalogue and order endpoints remain private/no-store.

## Deploy V10 to the development branch only

1. Download and extract this ZIP.
2. In GitHub, open the existing repository and switch to the `website-development` branch. Confirm the branch name before editing.
3. Upload/replace the project files from this ZIP, preserving the existing `site/assets/products/` images in your repository. The ZIP includes only `.gitkeep` in that folder. Do not delete your actual uploaded product images.
4. Commit the changes directly to `website-development`. Do not select the production branch and do not create a pull request to production.
5. In Netlify, confirm the deploy shown is for the `website-development` branch. Do not trigger a production deploy.
6. In the `website-development` deploy context, set `GITHUB_BRANCH=website-development` if the image-upload function needs to write to that branch. Keep the production context value `GITHUB_BRANCH` unchanged. Do not alter other existing secrets.
7. Test the development deploy: menu display, a brownie box, a cookie box, standalone item, cart, checkout date validation, WhatsApp message, admin login, product edit, product image upload, category reorder, and a dummy order.
8. Confirm the production deploy still points to the production branch and has not received the V10 commit.

No new environment variables are introduced by V10. Existing Google Sheets, Google Cloud, GitHub, and admin credentials remain required.


## V11 fixes

### Flavour gallery
Brownies and Cookies menu cards now show a horizontally scrollable flavour gallery. Swipe horizontally on touchscreens, use a trackpad/shift-wheel, or click the arrow controls. All active flavours are included.

### Box size selector
The V10 page referenced `changeBoxSize()` but did not define it. V11 adds the missing handler. Selecting Box of 4, 6, or 9 rebuilds the matching number of individual flavour selectors. Existing selections are retained for slots that remain in the box; newly added slots start unselected.

### GitHub image upload configuration
The error `Missing Netlify environment variable: GITHUB_OWNER` means the Netlify Function does not know which GitHub account/organisation owns the repository. V11 accepts either:

- `GITHUB_OWNER` = GitHub username or organisation name, and `GITHUB_REPO` = repository name; or
- `GITHUB_REPOSITORY` = `owner/repository`.

You must also set `GITHUB_TOKEN` to a GitHub token authorised to write repository contents. For a fine-grained token, grant access to the target repository and **Contents: Read and write**. Keep the token in Netlify environment variables only; never put it in HTML or commit it to GitHub. Set `GITHUB_BRANCH=website-development` for the development deploy context. Keep the production-context value unchanged. After changing environment variables, trigger a deploy of the development branch so the function receives them.

V11 cannot guess your GitHub owner, repository, or token; enter the real values from your GitHub repository and token settings.
