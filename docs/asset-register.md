# Asset register

Every image, icon or logo added under `public/` or `src/` is listed here, with where it came from and what licence covers it.
Append your own rows; do not edit another task's row.

| Task | Asset | Location | Origin | Licence | Notes |
|---|---|---|---|---|---|
| WEB-A05 | Placeholder FullCharge logo: a bolt drawn as one inline SVG path, next to the name set in the page font | `src/components/site/Logo.tsx` (used by the site header and footer) | Drawn for this project by the WEB-A05 agent. Not copied from the reference image, an icon set or any third party. | Project-owned | Stand-in until the final logo exists (Q-C8). Replace the contents of `Logo.tsx` only; both uses pick it up. Colour comes from the `--color-brand` token. |
| WEB-B02 | Landing icon set: 12 inline stroke icons (search, check, sliders, navigation, pin, plug, gauge, share, heart, car, chevron, arrow) as SVG paths in one component | `src/components/landing/Icon.tsx` | Drawn for this project by the WEB-B02 agent as simple geometric strokes. Not copied from the reference image or a brand. | Project-owned | Decorative, `aria-hidden`. No operator logo, vehicle make or brand mark. Colour comes from tokens via `currentColor`. |
| WEB-B02 | Decorative shapes: hero rings and dot grid, problem-section card panel, plug and car tiles in the Example cards | `src/components/landing/Hero.tsx`, `Problem.tsx`, `Explore.tsx`, `BuiltForYourEv.tsx` | Built with CSS (borders, radial gradient) and the icons above. No image file, no photo, no map. | Project-owned | Stand-ins until the founder supplies licensed photos or a licensed official-boundary map (T-4, LEGAL-6, Q-C8). No `public/` file was added. |
