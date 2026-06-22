/**
 * GameHub branding overlay for third-party integration auth pages.
 *
 * These sign-in pages (Steam, Epic, GOG, Xbox, Ubisoft, EA, Exophase) are
 * served from remote URLs we do not control, so — exactly like the upstream
 * Hydra auth reskin in `auth-rebrand.ts` — we re-skin them *in place* inside
 * the auth BrowserWindow rather than bolting a header bar on top:
 *
 *   1. Recolour the page's own primary/submit button onto the GameHub style
 *      (solid white fill, near-black text — matching `.button--primary`).
 *   2. Set the GameHub accent variables (teal #16b195 / blue #3e62c0).
 *   3. Swap the provider's logo, where we can target it, for a compact
 *      "GameHub × Provider" co-brand lockup painted as a background image
 *      (same technique Hydra uses on `.page-header__logo`).
 *
 * Everything is baked in as data URIs so it resolves identically in dev and in
 * the packaged asar.
 */
import type { BrowserWindow } from "electron";

export type IntegrationKey =
  | "steam"
  | "epic"
  | "gog"
  | "xbox"
  | "ubisoft"
  | "ea"
  | "battlenet"
  | "riot"
  | "exophase";

// GameHub mark (white) — the single <path> from assets/icons/gamehub.svg.
const GAMEHUB_PATH = `M 709.02 311.50 Q 708.75 313.54 706.41 315.11 Q 705.38 315.81 690.03 325.05 Q 616.22 369.51 483.34 450.05 Q 473.09 456.26 468.80 460.37 Q 454.08 474.47 449.76 494.41 Q 448.32 501.08 448.34 514.69 Q 448.39 556.27 448.37 659.50 Q 448.37 661.80 449.35 666.96 C 452.43 683.33 461.78 697.43 475.18 706.98 C 479.48 710.05 483.63 712.13 489.84 715.90 Q 521.87 735.30 585.70 773.28 Q 593.70 778.04 600.65 773.44 Q 605.18 770.43 605.19 764.25 Q 605.28 689.22 605.23 616.52 Q 605.23 611.17 604.59 609.47 C 601.87 602.24 596.96 601.22 589.27 601.28 Q 571.66 601.41 511.81 601.28 C 506.08 601.26 504.67 593.77 508.99 590.72 Q 556.50 557.19 573.01 545.30 Q 577.91 541.76 582.11 540.10 Q 587.92 537.81 592.96 537.78 Q 628.77 537.60 678.72 537.72 A 3.06 2.33 43.3 0 1 679.29 537.78 Q 686.46 539.35 688.27 546.04 A 4.74 4.49 -54.1 0 1 688.43 547.25 Q 688.42 568.93 688.43 597.21 Q 688.43 606.35 689.70 608.55 C 692.64 613.68 696.88 614.43 703.11 614.42 Q 765.42 614.32 792.07 614.44 Q 799.45 614.48 801.80 613.01 Q 805.39 610.78 807.02 607.10 Q 807.82 605.29 807.82 599.31 Q 807.84 407.97 807.79 396.26 Q 807.73 381.14 807.79 378.79 Q 807.90 374.11 809.10 372.88 Q 811.06 370.88 814.66 371.74 A 2.14 2.11 67.3 0 1 815.28 372.00 Q 850.12 394.17 879.83 412.51 Q 886.92 416.89 889.84 420.10 Q 898.21 429.31 901.33 441.17 Q 902.82 446.79 902.81 460.99 Q 902.76 600.79 902.75 709.70 Q 902.75 729.48 889.34 743.44 Q 885.63 747.31 877.25 752.36 Q 851.64 767.81 815.50 790.76 A 3.63 3.63 0.0 0 1 814.38 791.23 Q 810.38 792.17 808.58 789.32 Q 807.74 787.99 807.75 782.99 Q 807.84 747.86 807.83 689.22 Q 807.83 683.21 805.07 679.70 Q 801.66 675.38 796.19 675.40 Q 754.39 675.50 707.34 675.32 C 698.38 675.29 693.03 675.36 689.31 682.70 Q 688.37 684.56 688.38 690.92 Q 688.47 758.19 688.39 853.81 Q 688.39 856.19 685.58 859.49 A 2.44 2.40 -84.7 0 1 684.95 860.02 Q 674.39 866.24 657.23 876.71 C 654.77 878.21 649.62 880.16 646.12 881.06 Q 630.08 885.19 614.57 880.58 Q 609.24 879.00 599.75 873.46 Q 483.52 805.61 399.16 755.80 Q 385.60 747.80 381.37 743.76 C 371.31 734.18 364.06 721.89 361.23 707.89 Q 360.05 702.03 360.08 689.57 Q 360.18 639.69 360.09 475.79 Q 360.08 461.49 361.39 455.31 Q 366.04 433.31 382.76 417.73 Q 386.91 413.86 395.88 408.67 Q 434.09 386.56 454.30 374.83 Q 462.51 370.06 611.69 284.17 C 628.70 274.38 649.63 273.64 666.97 283.06 Q 677.01 288.51 703.36 304.18 C 707.04 306.37 709.55 307.41 709.02 311.50 Z`;

interface IntegrationMeta {
  label: string;
  viewBox: string;
  svgPath: string;
  /**
   * CSS selectors for the provider's own logo on its login page. When matched,
   * we hide its children and paint the co-brand lockup as a background image,
   * exactly like Hydra's `.page-header__logo` swap. Optional — providers whose
   * logo we cannot reliably target still get the button/accent reskin.
   */
  logoSelectors?: string[];
}

const INTEGRATIONS: Record<IntegrationKey, IntegrationMeta> = {
  steam: {
    label: "Steam",
    viewBox: "0 0 24 24",
    svgPath:
      "M12 2a10 10 0 0 1 10 10a10 10 0 0 1-10 10c-4.6 0-8.45-3.08-9.64-7.27l3.83 1.58a2.843 2.843 0 0 0 2.78 2.27c1.56 0 2.83-1.27 2.83-2.83v-.13l3.4-2.43h.08c2.08 0 3.77-1.69 3.77-3.77s-1.69-3.77-3.77-3.77s-3.78 1.69-3.78 3.77v.05l-2.37 3.46l-.16-.01c-.59 0-1.14.18-1.59.49L2 11.2C2.43 6.05 6.73 2 12 2M8.28 17.17c.8.33 1.72-.04 2.05-.84c.33-.8-.05-1.71-.83-2.04l-1.28-.53c.49-.18 1.04-.19 1.56.03c.53.21.94.62 1.15 1.15c.22.52.22 1.1 0 1.62c-.43 1.08-1.7 1.6-2.78 1.15c-.5-.21-.88-.59-1.09-1.04zm9.52-7.75c0 1.39-1.13 2.52-2.52 2.52a2.52 2.52 0 0 1-2.51-2.52a2.5 2.5 0 0 1 2.51-2.51a2.52 2.52 0 0 1 2.52 2.51m-4.4 0c0 1.04.84 1.89 1.89 1.89c1.04 0 1.88-.85 1.88-1.89s-.84-1.89-1.88-1.89c-1.05 0-1.89.85-1.89 1.89",
    logoSelectors: ['img[alt="STEAM" i]'],
  },
  epic: {
    label: "Epic Games",
    viewBox: "0 0 24 24",
    svgPath:
      "M3.537 0C2.165 0 1.66.506 1.66 1.879V18.44a4.262 4.262 0 00.02.433c.031.3.037.59.316.92.027.033.311.245.311.245.153.075.258.13.43.2l8.335 3.491c.433.199.614.276.928.27h.002c.314.006.495-.071.928-.27l8.335-3.492c.172-.07.277-.124.43-.2 0 0 .284-.211.311-.243.28-.33.285-.621.316-.92a4.261 4.261 0 00.02-.434V1.879c0-1.373-.506-1.88-1.878-1.88zm13.366 3.11h.68c1.138 0 1.688.553 1.688 1.696v1.88h-1.374v-1.8c0-.369-.17-.54-.523-.54h-.235c-.367 0-.537.17-.537.539v5.81c0 .369.17.54.537.54h.262c.353 0 .523-.171.523-.54V8.619h1.373v2.143c0 1.144-.562 1.71-1.7 1.71h-.694c-1.138 0-1.7-.566-1.7-1.71V4.82c0-1.144.562-1.709 1.7-1.709zm-12.186.08h3.114v1.274H6.117v2.603h1.648v1.275H6.117v2.774h1.74v1.275h-3.14zm3.816 0h2.198c1.138 0 1.7.564 1.7 1.708v2.445c0 1.144-.562 1.71-1.7 1.71h-.799v3.338h-1.4zm4.53 0h1.4v9.201h-1.4zm-3.13 1.235v3.392h.575c.354 0 .523-.171.523-.54V4.965c0-.368-.17-.54-.523-.54z",
  },
  gog: {
    label: "GOG",
    viewBox: "0 0 24 24",
    svgPath:
      "M7.15 15.24H4.36a.4.4 0 0 0-.4.4v2c0 .21.18.4.4.4h2.8v1.32h-3.5c-.56 0-1.02-.46-1.02-1.03v-3.39c0-.56.46-1.02 1.03-1.02h3.48v1.32zM8.16 11.54c0 .58-.47 1.05-1.05 1.05H2.63v-1.35h3.78a.4.4 0 0 0 .4-.4V6.39a.4.4 0 0 0-.4-.4H4.39a.4.4 0 0 0-.41.4v2.02c0 .23.18.4.4.4H6v1.35H3.68c-.58 0-1.05-.46-1.05-1.04V5.68c0-.57.47-1.04 1.05-1.04H7.1c.58 0 1.05.47 1.05 1.04v5.86zM21.36 19.36h-1.32v-4.12h-.93a.4.4 0 0 0-.4.4v3.72h-1.33v-4.12h-.93a.4.4 0 0 0-.4.4v3.72h-1.33v-4.42c0-.56.46-1.02 1.03-1.02h5.61v5.44zM21.37 11.54c0 .58-.47 1.05-1.05 1.05h-4.48v-1.35h3.78a.4.4 0 0 0 .4-.4V6.39a.4.4 0 0 0-.4-.4h-2.03a.4.4 0 0 0-.4.4v2.02c0 .23.18.4.4.4h1.62v1.35H16.9c-.58 0-1.05-.46-1.05-1.04V5.68c0-.57.47-1.04 1.05-1.04h3.43c.58 0 1.05.47 1.05 1.04v5.86zM13.72 4.64h-3.44c-.58 0-1.04.47-1.04 1.04v3.44c0 .58.46 1.04 1.04 1.04h3.44c.57 0 1.04-.46 1.04-1.04V5.68c0-.57-.47-1.04-1.04-1.04m-.3 1.75v2.02a.4.4 0 0 1-.4.4h-2.03a.4.4 0 0 1-.4-.4V6.4c0-.22.17-.4.4-.4H13c.23 0 .4.18.4.4zM12.63 13.92H9.24c-.57 0-1.03.46-1.03 1.02v3.39c0 .57.46 1.03 1.03 1.03h3.39c.57 0 1.03-.46 1.03-1.03v-3.39c0-.56-.46-1.02-1.03-1.02m-.3 1.72v2a.4.4 0 0 1-.4.4v-.01H9.94a.4.4 0 0 1-.4-.4v-1.99c0-.22.18-.4.4-.4h2c.22 0 .4.18.4.4zM23.49 1.1a1.74 1.74 0 0 0-1.24-.52H1.75A1.74 1.74 0 0 0 0 2.33v19.34a1.74 1.74 0 0 0 1.75 1.75h20.5A1.74 1.74 0 0 0 24 21.67V2.33c0-.48-.2-.92-.51-1.24m0 20.58a1.23 1.23 0 0 1-1.24 1.24H1.75A1.23 1.23 0 0 1 .5 21.67V2.33a1.23 1.23 0 0 1 1.24-1.24h20.5a1.24 1.24 0 0 1 1.24 1.24v19.34z",
    logoSelectors: ["svg.gog-logo"],
  },
  xbox: {
    label: "Xbox",
    viewBox: "0 0 24 24",
    svgPath:
      "M4.102 21.033C6.211 22.881 8.977 24 12 24c3.026 0 5.789-1.119 7.902-2.967 1.877-1.912-4.316-8.709-7.902-11.417-3.582 2.708-9.779 9.505-7.898 11.417zm11.16-14.406c2.5 2.961 7.484 10.313 6.076 12.912C23.002 17.48 24 14.861 24 12.004c0-3.34-1.365-6.362-3.57-8.536 0 0-.027-.022-.082-.042-.063-.022-.152-.045-.281-.045-.592 0-1.985.434-4.805 3.246zM3.654 3.426c-.057.02-.082.041-.086.042C1.365 5.642 0 8.664 0 12.004c0 2.854.998 5.473 2.661 7.533-1.401-2.605 3.579-9.951 6.08-12.91-2.82-2.813-4.216-3.245-4.806-3.245-.131 0-.223.021-.281.046v-.002zM12 3.551S9.055 1.828 6.755 1.746c-.903-.033-1.454.295-1.521.339C7.379.646 9.659 0 11.984 0H12c2.334 0 4.605.646 6.766 2.085-.068-.046-.615-.372-1.52-.339C14.946 1.828 12 3.545 12 3.545v.006z",
  },
  ubisoft: {
    label: "Ubisoft",
    viewBox: "0 0 24 24",
    svgPath:
      "M23.561 11.988C23.301-.304 6.954-4.89.656 6.634c.282.206.661.477.943.672a11.747 11.747 0 00-.976 3.067 11.885 11.885 0 00-.184 2.071C.439 18.818 5.621 24 12.005 24c6.385 0 11.556-5.17 11.556-11.556v-.455zm-20.27 2.06c-.152 1.246-.054 1.636-.054 1.788l-.282.098c-.108-.206-.37-.932-.488-1.908C2.163 10.308 4.7 6.96 8.57 6.33c3.544-.52 6.937 1.68 7.728 4.758l-.282.098c-.087-.087-.228-.336-.77-.878-4.281-4.281-11.002-2.32-11.956 3.74zm11.002 2.081a3.145 3.145 0 01-2.59 1.355 3.15 3.15 0 01-3.155-3.155 3.159 3.159 0 012.927-3.144c1.018-.043 1.972.51 2.416 1.398a2.58 2.58 0 01-.455 2.95c.293.205.575.4.856.595zm6.58.12c-1.669 3.782-5.106 5.766-8.77 5.712-7.034-.347-9.083-8.466-4.38-11.393l.207.206c-.076.108-.358.325-.791 1.182-.51 1.041-.672 2.081-.607 2.732.369 5.67 8.314 6.83 11.045 1.214C21.057 8.217 11.822.401 3.626 6.374l-.184-.184C5.599 2.808 9.816 1.3 13.837 2.309c6.147 1.55 9.453 7.956 7.035 13.94z",
  },
  ea: {
    label: "EA",
    viewBox: "0 0 24 24",
    svgPath:
      "M16.635 6.162l-5.928 9.377H4.24l1.508-2.3h4.024l1.474-2.335H2.264L.79 13.239h2.156L0 17.84h12.072l4.563-7.259 1.652 2.66h-1.401l-1.473 2.299h4.347l1.473 2.3H24zm-11.461.107L3.7 8.604l9.52-.035 1.474-2.3z",
  },
  battlenet: {
    label: "Battle.net",
    viewBox: "0 0 24 24",
    svgPath:
      "M18.94 8.296C15.9 6.892 11.534 6 7.426 6.332c.206-1.36.714-2.308 1.548-2.508 1.148-.275 2.4.48 3.594 1.854.782.102 1.71.28 2.355.429C12.747 2.013 9.828-.282 7.607.565c-1.688.644-2.553 2.97-2.448 6.094-2.2.468-3.915 1.3-5.013 2.495-.056.065-.181.227-.137.305.034.058.146-.008.194-.04 1.274-.89 2.904-1.373 5.027-1.676.303 3.333 1.713 7.56 4.055 10.952-1.28.502-2.356.536-2.946-.087-.812-.856-.784-2.318-.19-4.04a26.764 26.764 0 0 1-.807-2.254c-2.459 3.934-2.986 7.61-1.143 9.11 1.402 1.14 3.847.725 6.502-.926 1.505 1.672 3.083 2.74 4.667 3.094.084.015.287.043.332-.034.034-.06-.08-.124-.131-.149-1.408-.657-2.64-1.828-3.964-3.515 2.735-1.929 5.691-5.263 7.457-8.988 1.076.86 1.64 1.773 1.398 2.595-.336 1.131-1.615 1.84-3.403 2.185a27.697 27.697 0 0 1-1.548 1.826c4.634.16 8.08-1.22 8.458-3.565.286-1.786-1.295-3.696-4.053-5.17.696-2.139.832-4.04.346-5.588-.029-.08-.106-.27-.196-.27-.068 0-.067.13-.063.187.135 1.547-.263 3.2-1.062 5.19zm-8.533 9.869c-1.96-3.145-3.09-6.849-3.082-10.594 3.702-.124 7.474.748 10.714 2.627-1.743 3.269-4.385 6.1-7.633 7.966h.001z",
  },
  riot: {
    label: "Riot Games",
    viewBox: "0 0 24 24",
    svgPath:
      "M13.458.86 0 7.093l3.353 12.761 2.552-.313-.701-8.024.838-.373 1.447 8.202 4.361-.535-.775-8.857.83-.37 1.591 9.025 4.412-.542-.849-9.708.84-.374 1.74 9.87L24 17.318V3.5Zm.316 19.356.222 1.256L24 23.14v-4.18l-10.22 1.256Z",
  },
  exophase: {
    label: "Exophase",
    viewBox: "0 0 24 24",
    svgPath:
      "M20 2H4v2l4.586 4.586A2 2 0 0 1 9 9.914V18H7v2h10v-2h-2V9.914a2 2 0 0 1 .414-1.328L20 4V2zM6.414 4h11.172l-3 3H9.414L6.414 4z",
  },
};

/**
 * Builds a horizontal "GameHub × Provider" lockup SVG as a data URI.
 * `fill` colours both marks; the "×" stays GameHub teal (legible on light and
 * dark). Pass white for dark backgrounds, near-black for light ones.
 */
function buildLockupDataUri(meta: IntegrationMeta, fill: string): string {
  // Layout: GameHub mark (h=26) · "×" · provider mark (h=22), centred in a
  // 120×34 viewport. Provider path is scaled from its own 24-unit viewBox.
  const lockup = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="34" viewBox="0 0 120 34" fill="none">
  <g transform="translate(2, 4)"><svg width="26" height="26" viewBox="0 0 1254 1254"><path fill="${fill}" d="${GAMEHUB_PATH}"/></svg></g>
  <text x="46" y="23" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="300" fill="#16b195">×</text>
  <g transform="translate(62, 6)"><svg width="22" height="22" viewBox="${meta.viewBox}"><path fill="${fill}" d="${meta.svgPath}"/></svg></g>
</svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(lockup).toString("base64");
}

/** GameHub primary-button + accent CSS — mirrors auth-rebrand.ts for parity. */
const BUTTON_AND_ACCENT_CSS = `
  :root {
    --primary: #16b195 !important;
    --accent: #3e62c0 !important;
    --color-primary: #16b195 !important;
  }
  button[type="submit"]:not([class*="close" i]):not([class*="toggle" i]):not([class*="search" i]),
  .button--primary,
  .btn--main,
  .btn-blue,
  .btn-primary,
  .MuiButton-contained {
    background: #f0f1f7 !important;
    background-image: none !important;
    color: #0d0d0d !important;
    border-color: transparent !important;
  }
  button[type="submit"]:not([class*="close" i]):not([class*="toggle" i]):not([class*="search" i]):hover,
  .button--primary:hover,
  .btn--main:hover,
  .btn-blue:hover,
  .btn-primary:hover,
  .MuiButton-contained:hover {
    background: #dadbe1 !important;
  }
`;

/**
 * Builds the per-provider logo-swap JS. Replaces the provider's logo node with
 * an <img> of the GameHub × Provider lockup. Using JS (rather than CSS
 * `content`/`background-image`) reliably handles both <img> logos — whose
 * raster paints over a CSS background — and inline <svg> roots, where `content`
 * replacement is inconsistent. Idempotent and re-runnable for SPA navigations.
 */
function buildLogoSwapJs(meta: IntegrationMeta): string {
  if (!meta.logoSelectors?.length) return "";
  const lightLockup = buildLockupDataUri(meta, "#ffffff"); // for dark backdrops
  const darkLockup = buildLockupDataUri(meta, "#0d0d0d"); // for light backdrops
  const selectorList = JSON.stringify(meta.logoSelectors);
  return `
  (function () {
    try {
      var selectors = ${selectorList};
      var LIGHT = ${JSON.stringify(lightLockup)};
      var DARK = ${JSON.stringify(darkLockup)};
      // Walks up to the first ancestor with a non-transparent background and
      // returns its perceived luminance (0 = black, 1 = white).
      function backdropLuminance(el) {
        var node = el;
        while (node && node !== document.documentElement) {
          var bg = getComputedStyle(node).backgroundColor;
          var m = bg.match(/rgba?\\(([^)]+)\\)/);
          if (m) {
            var p = m[1].split(",").map(function (x) { return parseFloat(x.trim()); });
            var a = p.length > 3 ? p[3] : 1;
            if (a > 0.1) {
              return (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255;
            }
          }
          node = node.parentElement;
        }
        return 0; // assume dark when nothing opaque found
      }
      selectors.forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (node) {
          if (node.dataset && node.dataset.ghBranded === "1") return;
          var src = backdropLuminance(node) > 0.6 ? DARK : LIGHT;
          var img = document.createElement("img");
          img.src = src;
          img.alt = "GameHub";
          img.style.cssText = "height:34px;width:auto;display:inline-block;vertical-align:middle";
          img.dataset.ghBranded = "1";
          node.replaceWith(img);
        });
      });
    } catch (e) {}
  })();
`;
}

/**
 * Re-skins an integration auth popup window with GameHub branding, in place.
 * Runs on every load so sign-in → 2FA → consent navigations stay branded.
 */
export function injectBrandedHeader(
  win: BrowserWindow,
  integration: IntegrationKey
): void {
  const meta = INTEGRATIONS[integration];
  if (!meta) return;

  const logoSwapJs = buildLogoSwapJs(meta);

  const apply = () => {
    if (win.isDestroyed()) return;
    win.webContents.insertCSS(BUTTON_AND_ACCENT_CSS).catch(() => {});
    if (logoSwapJs) {
      win.webContents.executeJavaScript(logoSwapJs).catch(() => {});
    }
  };

  win.webContents.on("did-finish-load", apply);
  // SPA navigations (Epic/Ubisoft) don't always fire did-finish-load.
  win.webContents.on("did-navigate-in-page", apply);
}
