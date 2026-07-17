import { useContext, useEffect, useMemo, useState } from "react";
import type { ConsoleGameMetadata } from "@types";
import { gameDetailsContext } from "@renderer/context/game-details/game-details.context";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import "./console-metadata-section.scss";

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
          <div className="console-meta__chips">
            {series.titles.slice(0, 12).map((title) => (
              <span key={title} className="console-meta__chip" title={title}>
                {title}
              </span>
            ))}
          </div>
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
