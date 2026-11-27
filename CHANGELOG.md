# Chateau Desserts V11 changelog

- Added horizontally swipeable/scrollable flavour galleries to Brownies and Cookies menu cards, with left/right controls. All available flavours are included; no longer limited to the first four.
- Added the missing `changeBoxSize()` handler. Changing to a box of 6 or 9 now rebuilds the exact number of piece selectors, preserves existing selections where possible, and recalculates totals.
- Improved GitHub image-upload configuration: accepts `GITHUB_OWNER` + `GITHUB_REPO`, or `GITHUB_REPOSITORY=owner/repository`; gives actionable setup errors; uses Netlify's `BRANCH` as a fallback if `GITHUB_BRANCH` is not set.
- Preserved the original V10 storefront styling and existing catalogue, cart, checkout, admin and Google Sheets workflows.
