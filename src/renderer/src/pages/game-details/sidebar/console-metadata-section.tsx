import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  CatalogueSearchResult,
  ConsoleGameMetadata,
  EmulatorSystem,
} from "@types";
import { gameDetailsContext } from "@renderer/context/game-details/game-details.context";
import { useAppDispatch } from "@renderer/hooks";
import { setFilters } from "@renderer/features";
import { buildGameDetailsPath } from "@renderer/helpers";
import { PlatformLogo } from "@renderer/pages/settings/emulation/platform-logo";
import { PLATFORM_LABELS } from "@renderer/assets/emulation/platform-logos";
import {
  scoreTitleMatch,
  subtitleQuery,
} from "@renderer/pages/catalogue/catalogue-relevance";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import "./console-metadata-section.scss";

/**
 * Resolve one series-sibling TITLE to a real catalogue game, robustly. The
 * catalogue's console search requires every query token to appear in a title,
 * so a franchise entry like "The Legend of Zelda: Ocarina of Time 3D" resolves
 * only when we (a) search ALL systems — the sibling often lives on a different
 * console than the game being viewed (OoT 3D on 3DS vs OoT on N64) — and (b)
 * fall back to the distinctive subtitle when the full title finds nothing.
 * Among matches we keep the best by title relevance, preferring the same
 * console on a tie. Returns null only when nothing plausibly matches.
 */
async function resolveSeriesCard(
  title: string,
  preferSystem: EmulatorSystem | undefined
): Promise<CatalogueSearchResult | null> {
  const search = (query: string) =>
    window.electron
      .searchClassicsCatalogue(query, 8)
      .catch(() => [] as CatalogueSearchResult[]);

  let results = await search(title);
  if (!results.length) {
    const subtitle = subtitleQuery(title);
    if (subtitle) results = await search(subtitle);
  }
  if (!results.length) return null;

  const systemOf = (r: CatalogueSearchResult) =>
    r.objectId.startsWith("minerva:") ? r.objectId.split(":")[1] : null;

  const best = results
    .map((result) => ({
      result,
      score:
        scoreTitleMatch(result.title, title) +
        // Nudge toward the same console when scores are otherwise close.
        (preferSystem && systemOf(result) === preferSystem ? 0.05 : 0),
    }))
    .sort((a, b) => b.score - a.score)[0];

  // Require a minimal token overlap so we never show an unrelated first result.
  return best && best.score >= 0.34 ? best.result : null;
}

/**
 * Console/classics results are shop "launchbox" with an objectId shaped
 * `minerva:<system>:<title>`. Returns the EmulatorSystem so we can badge the
 * card with its platform logo, or null when it can't be derived.
 */
function systemForResult(result: CatalogueSearchResult): EmulatorSystem | null {
  if (!result.objectId.startsWith("minerva:")) return null;
  const seg = result.objectId.split(":")[1];
  return seg in PLATFORM_LABELS ? (seg as EmulatorSystem) : null;
}

/** Colour a 0–100 score green/yellow/red the way review aggregators do. */
const scoreClass = (score: number) =>
  score >= 75 ? "high" : score >= 50 ? "medium" : "low";

/**
 * Extra metadata for console/emulated (launchbox) games: the basics that live
 * on `shopDetails` (genre/developer/publisher/release) plus IGDB-only data
 * (review scores, local player count, languages, series, box art) fetched by
 * title. Renders nothing for non-launchbox games or when there's no data.
 */
export function ConsoleMetadataSection() {
  const { shop, gameTitle, objectId, shopDetails } =
    useContext(gameDetailsContext);
  const [meta, setMeta] = useState<ConsoleGameMetadata | null>(null);
  const [seriesCards, setSeriesCards] = useState<CatalogueSearchResult[]>([]);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  // The current game's console (from its `minerva:<system>:<title>` objectId),
  // so series-sibling lookups are scoped to the same platform.
  const currentSystem = useMemo<EmulatorSystem | undefined>(() => {
    if (!objectId?.startsWith("minerva:")) return undefined;
    const seg = objectId.split(":")[1];
    return seg in PLATFORM_LABELS ? (seg as EmulatorSystem) : undefined;
  }, [objectId]);

  // Search the catalogue for a series sibling by title (same path the header
  // search uses): set the title filter, then land on the catalogue page.
  const searchCatalogue = (searchTitle: string) => {
    dispatch(setFilters({ title: searchTitle.slice(0, 255) }));
    navigate("/catalogue");
  };

  useEffect(() => {
    if (shop !== "launchbox" || !gameTitle || !objectId) {
      setMeta(null);
      return;
    }
    let active = true;
    window.electron
      .getConsoleGameMetadata(gameTitle, objectId)
      .then((data) => {
        if (active) setMeta(data);
      })
      .catch(() => {
        if (active) setMeta(null);
      });
    return () => {
      active = false;
    };
  }, [shop, gameTitle, objectId]);

  // Resolve each series-sibling title against the console catalogue so the
  // section can render real cards (art + platform) that navigate to the actual
  // game, instead of blind title-search chips. Skip the current game itself.
  useEffect(() => {
    const titles = meta?.series?.titles ?? [];
    if (shop !== "launchbox" || !titles.length) {
      setSeriesCards([]);
      return;
    }
    let active = true;
    Promise.all(
      titles
        .slice(0, 12)
        .map((title) => resolveSeriesCard(title, currentSystem))
    ).then((resolved) => {
      if (!active) return;
      const seen = new Set<string>([objectId ?? ""]);
      const cards = resolved.filter(
        (r): r is CatalogueSearchResult =>
          !!r && !seen.has(r.objectId) && (seen.add(r.objectId), true)
      );
      setSeriesCards(cards);
    });
    return () => {
      active = false;
    };
  }, [shop, objectId, currentSystem, meta?.series]);

  const basics = useMemo(() => {
    if (shop !== "launchbox" || !shopDetails) return [];
    const rows: { label: string; value: string }[] = [];
    const genres = shopDetails.genres?.map((g) => g.name).filter(Boolean) ?? [];
    if (genres.length) rows.push({ label: "Genre", value: genres.join(", ") });
    if (shopDetails.developers?.length)
      rows.push({
        label: "Developer",
        value: shopDetails.developers.join(", "),
      });
    if (shopDetails.publishers?.length)
      rows.push({
        label: "Publisher",
        value: shopDetails.publishers.join(", "),
      });
    if (shopDetails.release_date?.date)
      rows.push({ label: "Released", value: shopDetails.release_date.date });
    return rows;
  }, [shop, shopDetails]);

  if (shop !== "launchbox") return null;

  const hasScores =
    meta && (meta.criticScore != null || meta.userScore != null);
  const players = meta?.maxLocalPlayers;
  const modes = meta?.gameModes ?? [];
  const languages = meta?.languages ?? [];
  const series = meta?.series;
  const boxArt = meta?.boxArtUrls ?? [];

  const nothingToShow =
    basics.length === 0 &&
    !hasScores &&
    !players &&
    modes.length === 0 &&
    languages.length === 0 &&
    !series?.titles.length &&
    boxArt.length === 0;

  if (nothingToShow) return null;

  return (
    <>
      {basics.length > 0 && (
        <SidebarSection title="Details">
          <ul className="console-meta__rows">
            {basics.map((row) => (
              <li key={row.label} className="console-meta__row">
                <span className="console-meta__key">{row.label}</span>
                <span className="console-meta__value">{row.value}</span>
              </li>
            ))}
          </ul>
        </SidebarSection>
      )}

      {(hasScores || players || modes.length > 0) && (
        <SidebarSection title="Ratings & players">
          {hasScores && (
            <div className="console-meta__scores">
              {meta?.criticScore != null && (
                <div className="console-meta__score">
                  <span
                    className={`console-meta__score-badge console-meta__score-badge--${scoreClass(
                      meta.criticScore
                    )}`}
                  >
                    {meta.criticScore}
                  </span>
                  <span className="console-meta__score-label">Critics</span>
                </div>
              )}
              {meta?.userScore != null && (
                <div className="console-meta__score">
                  <span
                    className={`console-meta__score-badge console-meta__score-badge--${scoreClass(
                      meta.userScore
                    )}`}
                  >
                    {meta.userScore}
                  </span>
                  <span className="console-meta__score-label">
                    Players
                    {meta.ratingCount ? ` (${meta.ratingCount})` : ""}
                  </span>
                </div>
              )}
            </div>
          )}

          {(players || modes.length > 0) && (
            <ul className="console-meta__rows">
              {players ? (
                <li className="console-meta__row">
                  <span className="console-meta__key">Local players</span>
                  <span className="console-meta__value">
                    {players === 1 ? "1 player" : `Up to ${players}`}
                  </span>
                </li>
              ) : null}
              {modes.length > 0 && (
                <li className="console-meta__row">
                  <span className="console-meta__key">Modes</span>
                  <span className="console-meta__value">
                    {modes.join(", ")}
                  </span>
                </li>
              )}
            </ul>
          )}
        </SidebarSection>
      )}

      {languages.length > 0 && (
        <SidebarSection title="Languages">
          <div className="console-meta__chips">
            {languages.map((lang) => (
              <span key={lang} className="console-meta__chip">
                {lang}
              </span>
            ))}
          </div>
        </SidebarSection>
      )}

      {series?.titles.length ? (
        <SidebarSection title={`More from ${series.name}`}>
          {seriesCards.length ? (
            <div className="console-meta__series">
              {seriesCards.map((card) => {
                const cardSystem = systemForResult(card);
                return (
                  <button
                    key={card.objectId}
                    type="button"
                    className="console-meta__series-card"
                    title={card.title}
                    onClick={() => navigate(buildGameDetailsPath(card))}
                  >
                    <div className="console-meta__series-hero">
                      {card.libraryImageUrl ? (
                        <img
                          src={card.libraryImageUrl}
                          alt={card.title}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="console-meta__series-hero--placeholder" />
                      )}
                      {cardSystem && (
                        <span
                          className="console-meta__series-platform"
                          title={PLATFORM_LABELS[cardSystem]}
                        >
                          <PlatformLogo
                            system={cardSystem}
                            className="console-meta__series-platform-logo"
                          />
                        </span>
                      )}
                    </div>
                    <span className="console-meta__series-title">
                      {card.title}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            // Nothing matched the catalogue yet — fall back to title-search
            // chips so the series is still discoverable.
            <div className="console-meta__chips">
              {series.titles.slice(0, 12).map((title) => (
                <button
                  key={title}
                  type="button"
                  className="console-meta__chip console-meta__chip--button"
                  title={`Search for ${title}`}
                  onClick={() => searchCatalogue(title)}
                >
                  {title}
                </button>
              ))}
            </div>
          )}
        </SidebarSection>
      ) : null}

      {boxArt.length > 0 && (
        <SidebarSection title="Box art">
          <div className="console-meta__boxart">
            {boxArt.slice(0, 6).map((url) => (
              <img
                key={url}
                src={url}
                alt="Box art"
                loading="lazy"
                decoding="async"
                className="console-meta__boxart-img"
              />
            ))}
          </div>
        </SidebarSection>
      )}
    </>
  );
}
