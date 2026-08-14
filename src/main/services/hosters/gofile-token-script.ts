const websiteTokenScriptPattern =
  /<script[^>]+src=["']([^"']*wt[^"'/]*\.js)["']/i;

export const resolveGofileWebsiteTokenScriptUrl = (
  html: string,
  websiteUrl: string
) => {
  const match = html.match(websiteTokenScriptPattern);
  if (!match) return null;

  try {
    const scriptUrl = new URL(match[1], websiteUrl);
    const websiteHostname = new URL(websiteUrl).hostname;
    const isWebsiteHost =
      scriptUrl.hostname === websiteHostname ||
      scriptUrl.hostname.endsWith(`.${websiteHostname}`);

    if (scriptUrl.protocol !== "https:" || !isWebsiteHost) {
      return null;
    }

    return scriptUrl.href;
  } catch {
    return null;
  }
};

export const isMarkupResponse = (body: string) =>
  body.trimStart().startsWith("<");
