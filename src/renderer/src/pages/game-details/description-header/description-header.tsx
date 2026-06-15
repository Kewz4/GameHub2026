import { useTranslation } from "react-i18next";
import { useContext } from "react";
import { gameDetailsContext } from "@renderer/context";
import "./description-header.scss";

export function DescriptionHeader() {
  const { shopDetails } = useContext(gameDetailsContext);
  const { t } = useTranslation("game_details");

  if (!shopDetails) return null;

  // Games not in the Hydra catalogue have a minimal shopDetails (assets only)
  // — every field here may be missing
  const releaseDate = shopDetails.release_date?.date;
  const publisher = Array.isArray(shopDetails.publishers)
    ? shopDetails.publishers[0]
    : null;

  if (!releaseDate && !publisher) return null;

  return (
    <div className="description-header">
      <section className="description-header__info">
        {releaseDate && <p>{t("release_date", { date: releaseDate })}</p>}

        {publisher && <p>{t("publisher", { publisher })}</p>}
      </section>
    </div>
  );
}
