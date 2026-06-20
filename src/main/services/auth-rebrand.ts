/**
 * GameHub branding overlay for the (upstream Hydra) auth web pages.
 *
 * The sign-in / sign-up pages are served from a remote URL we do not control,
 * so we re-skin them client-side inside the auth BrowserWindow: swap the
 * octopus mark for the GameHub logo, recolour the primary action onto the
 * GameHub teal→blue gradient, and rewrite any "Hydra" copy to "GameHub".
 *
 * The logo is baked in as a data URI so it resolves identically in dev and
 * inside the packaged asar (no runtime asset-path lookup).
 */

// GameHub mark (white), inlined so it always renders regardless of packaging.
const GAMEHUB_LOGO_DATA_URI =
  "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2ZXJzaW9uPSIxLjEiIHZpZXdCb3g9IjAuMDAgMC4wMCAxMjU0LjAwIDEyNTQuMDAiPgo8cGF0aCBmaWxsPSIjZmZmZmZmIiBkPSIKICBNIDcwOS4wMiAzMTEuNTAKICBRIDcwOC43NSAzMTMuNTQgNzA2LjQxIDMxNS4xMQogIFEgNzA1LjM4IDMxNS44MSA2OTAuMDMgMzI1LjA1CiAgUSA2MTYuMjIgMzY5LjUxIDQ4My4zNCA0NTAuMDUKICBRIDQ3My4wOSA0NTYuMjYgNDY4LjgwIDQ2MC4zNwogIFEgNDU0LjA4IDQ3NC40NyA0NDkuNzYgNDk0LjQxCiAgUSA0NDguMzIgNTAxLjA4IDQ0OC4zNCA1MTQuNjkKICBRIDQ0OC4zOSA1NTYuMjcgNDQ4LjM3IDY1OS41MAogIFEgNDQ4LjM3IDY2MS44MCA0NDkuMzUgNjY2Ljk2CiAgQyA0NTIuNDMgNjgzLjMzIDQ2MS43OCA2OTcuNDMgNDc1LjE4IDcwNi45OAogIEMgNDc5LjQ4IDcxMC4wNSA0ODMuNjMgNzEyLjEzIDQ4OS44NCA3MTUuOTAKICBRIDUyMS44NyA3MzUuMzAgNTg1LjcwIDc3My4yOAogIFEgNTkzLjcwIDc3OC4wNCA2MDAuNjUgNzczLjQ0CiAgUSA2MDUuMTggNzcwLjQzIDYwNS4xOSA3NjQuMjUKICBRIDYwNS4yOCA2ODkuMjIgNjA1LjIzIDYxNi41MgogIFEgNjA1LjIzIDYxMS4xNyA2MDQuNTkgNjA5LjQ3CiAgQyA2MDEuODcgNjAyLjI0IDU5Ni45NiA2MDEuMjIgNTg5LjI3IDYwMS4yOAogIFEgNTcxLjY2IDYwMS40MSA1MTEuODEgNjAxLjI4CiAgQyA1MDYuMDggNjAxLjI2IDUwNC42NyA1OTMuNzcgNTA4Ljk5IDU5MC43MgogIFEgNTU2LjUwIDU1Ny4xOSA1NzMuMDEgNTQ1LjMwCiAgUSA1NzcuOTEgNTQxLjc2IDU4Mi4xMSA1NDAuMTAKICBRIDU4Ny45MiA1MzcuODEgNTkyLjk2IDUzNy43OAogIFEgNjI4Ljc3IDUzNy42MCA2NzguNzIgNTM3LjcyCiAgQSAzLjA2IDIuMzMgNDMuMyAwIDEgNjc5LjI5IDUzNy43OAogIFEgNjg2LjQ2IDUzOS4zNSA2ODguMjcgNTQ2LjA0CiAgQSA0Ljc0IDQuNDkgLTU0LjEgMCAxIDY4OC40MyA1NDcuMjUKICBRIDY4OC40MiA1NjguOTMgNjg4LjQzIDU5Ny4yMQogIFEgNjg4LjQzIDYwNi4zNSA2ODkuNzAgNjA4LjU1CiAgQyA2OTIuNjQgNjEzLjY4IDY5Ni44OCA2MTQuNDMgNzAzLjExIDYxNC40MgogIFEgNzY1LjQyIDYxNC4zMiA3OTIuMDcgNjE0LjQ0CiAgUSA3OTkuNDUgNjE0LjQ4IDgwMS44MCA2MTMuMDEKICBRIDgwNS4zOSA2MTAuNzggODA3LjAyIDYwNy4xMAogIFEgODA3LjgyIDYwNS4yOSA4MDcuODIgNTk5LjMxCiAgUSA4MDcuODQgNDA3Ljk3IDgwNy43OSAzOTYuMjYKICBRIDgwNy43MyAzODEuMTQgODA3Ljc5IDM3OC43OQogIFEgODA3LjkwIDM3NC4xMSA4MDkuMTAgMzcyLjg4CiAgUSA4MTEuMDYgMzcwLjg4IDgxNC42NiAzNzEuNzQKICBBIDIuMTQgMi4xMSA2Ny4zIDAgMSA4MTUuMjggMzcyLjAwCiAgUSA4NTAuMTIgMzk0LjE3IDg3OS44MyA0MTIuNTEKICBRIDg4Ni45MiA0MTYuODkgODg5Ljg0IDQyMC4xMAogIFEgODk4LjIxIDQyOS4zMSA5MDEuMzMgNDQxLjE3CiAgUSA5MDIuODIgNDQ2Ljc5IDkwMi44MSA0NjAuOTkKICBRIDkwMi43NiA2MDAuNzkgOTAyLjc1IDcwOS43MAogIFEgOTAyLjc1IDcyOS40OCA4ODkuMzQgNzQzLjQ0CiAgUSA4ODUuNjMgNzQ3LjMxIDg3Ny4yNSA3NTIuMzYKICBRIDg1MS42NCA3NjcuODEgODE1LjUwIDc5MC43NgogIEEgMy42MyAzLjYzIDAuMCAwIDEgODE0LjM4IDc5MS4yMwogIFEgODEwLjM4IDc5Mi4xNyA4MDguNTggNzg5LjMyCiAgUSA4MDcuNzQgNzg3Ljk5IDgwNy43NSA3ODIuOTkKICBRIDgwNy44NCA3NDcuODYgODA3LjgzIDY4OS4yMgogIFEgODA3LjgzIDY4My4yMSA4MDUuMDcgNjc5LjcwCiAgUSA4MDEuNjYgNjc1LjM4IDc5Ni4xOSA2NzUuNDAKICBRIDc1NC4zOSA2NzUuNTAgNzA3LjM0IDY3NS4zMgogIEMgNjk4LjM4IDY3NS4yOSA2OTMuMDMgNjc1LjM2IDY4OS4zMSA2ODIuNzAKICBRIDY4OC4zNyA2ODQuNTYgNjg4LjM4IDY5MC45MgogIFEgNjg4LjQ3IDc1OC4xOSA2ODguMzkgODUzLjgxCiAgUSA2ODguMzkgODU2LjE5IDY4NS41OCA4NTkuNDkKICBBIDIuNDQgMi40MCAtODQuNyAwIDEgNjg0Ljk1IDg2MC4wMgogIFEgNjc0LjM5IDg2Ni4yNCA2NTcuMjMgODc2LjcxCiAgQyA2NTQuNzcgODc4LjIxIDY0OS42MiA4ODAuMTYgNjQ2LjEyIDg4MS4wNgogIFEgNjMwLjA4IDg4NS4xOSA2MTQuNTcgODgwLjU4CiAgUSA2MDkuMjQgODc5LjAwIDU5OS43NSA4NzMuNDYKICBRIDQ4My41MiA4MDUuNjEgMzk5LjE2IDc1NS44MAogIFEgMzg1LjYwIDc0Ny44MCAzODEuMzcgNzQzLjc2CiAgQyAzNzEuMzEgNzM0LjE4IDM2NC4wNiA3MjEuODkgMzYxLjIzIDcwNy44OQogIFEgMzYwLjA1IDcwMi4wMyAzNjAuMDggNjg5LjU3CiAgUSAzNjAuMTggNjM5LjY5IDM2MC4wOSA0NzUuNzkKICBRIDM2MC4wOCA0NjEuNDkgMzYxLjM5IDQ1NS4zMQogIFEgMzY2LjA0IDQzMy4zMSAzODIuNzYgNDE3LjczCiAgUSAzODYuOTEgNDEzLjg2IDM5NS44OCA0MDguNjcKICBRIDQzNC4wOSAzODYuNTYgNDU0LjMwIDM3NC44MwogIFEgNDYyLjUxIDM3MC4wNiA2MTEuNjkgMjg0LjE3CiAgQyA2MjguNzAgMjc0LjM4IDY0OS42MyAyNzMuNjQgNjY2Ljk3IDI4My4wNgogIFEgNjc3LjAxIDI4OC41MSA3MDMuMzYgMzA0LjE4CiAgQyA3MDcuMDQgMzA2LjM3IDcwOS41NSAzMDcuNDEgNzA5LjAyIDMxMS41MAogIFoiCi8+Cjwvc3ZnPgo=";

export const AUTH_REBRAND_CSS = `
  /* Replace the Hydra octopus logo with the GameHub mark. The upstream logo
     is an inline <svg class="page-header__logo">, so hide its children and
     paint our mark as the element background. Also covers any <img> logos. */
  .page-header__logo > * { display: none !important; }
  .page-header__logo {
    width: 56px !important;
    height: 56px !important;
    background-image: url("${GAMEHUB_LOGO_DATA_URI}") !important;
    background-repeat: no-repeat !important;
    background-position: center !important;
    background-size: contain !important;
  }
  img[src*="hydra" i],
  img[alt*="hydra" i],
  [class*="hydra-logo" i],
  [class*="HydraLogo" i],
  [id*="hydra-logo" i] {
    display: none !important;
  }

  /* GameHub brand accent (teal #16b195 / blue #3e62c0) for links & misc. */
  :root {
    --primary: #16b195 !important;
    --accent: #3e62c0 !important;
    --color-primary: #16b195 !important;
  }
  /* Primary action button → GameHub style: solid white fill, near-black
     text (matches the in-app .button--primary in dark mode, not a gradient). */
  button[type="submit"],
  .button--primary,
  form button:not([type="button"]) {
    background: #f0f1f7 !important;
    background-image: none !important;
    color: #0d0d0d !important;
    border-color: transparent !important;
  }
  button[type="submit"]:hover,
  .button--primary:hover,
  form button:not([type="button"]):hover {
    background: #dadbe1 !important;
  }
`;

export const AUTH_REBRAND_JS = `
  (function () {
    function patchText(root) {
      try {
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        var node;
        while ((node = walker.nextNode())) {
          if (/\\bhydra\\b/i.test(node.textContent || "")) {
            node.textContent = (node.textContent || "")
              .replace(/\\bHydra Launcher\\b/gi, "GameHub")
              .replace(/\\bHydra\\b/gi, "GameHub");
          }
        }
      } catch (e) {}
    }
    if (document.title) document.title = document.title.replace(/Hydra/gi, "GameHub");
    patchText(document.body);
    try {
      var obs = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          m.addedNodes.forEach(function (n) {
            if (n.nodeType === Node.ELEMENT_NODE) patchText(n);
            else if (n.nodeType === Node.TEXT_NODE) patchText(n.parentElement || document.body);
          });
        });
        if (document.title && /hydra/i.test(document.title))
          document.title = document.title.replace(/Hydra/gi, "GameHub");
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  })();
`;
