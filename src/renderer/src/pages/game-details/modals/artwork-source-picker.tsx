import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SyncIcon } from "@primer/octicons-react";
import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { GameShop } from "@types";
import "./artwork-source-picker.scss";

type AssetType = "cover" | "hero" | "logo" | "icon";
type ArtworkSource = "steamgriddb" | "igdb";

interface ArtworkOption {
  url: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
}

const ASSET_TYPES: { key: AssetType; label: string; aspect: string }[] = [
  { key: "cover", label: "Cover", aspect: "2 / 3" },
  { key: "hero", label: "Hero", aspect: "16 / 6" },
  { key: "logo", label: "Logo", aspect: "16 / 9" },
  { key: "icon", label: "Icon", aspect: "1 / 1" },
];

// IGDB only carries covers and landscape artwork — no logos/icons.
const SOURCES_FOR: Record<AssetType, ArtworkSource[]> = {
  cover: ["steamgriddb", "igdb"],
  hero: ["steamgriddb", "igdb"],
  logo: ["steamgriddb"],
  icon: ["steamgriddb"],
};

const SOURCE_LABEL: Record<ArtworkSource, string> = {
  steamgriddb: "SteamGridDB",
  igdb: "IGDB",
};

export interface ArtworkSourcePickerProps {
  shop: GameShop;
  objectId: string;
  title: string;
  onGameUpdated: () => Promise<void> | void;
}

export function ArtworkSourcePicker({
  shop,
  objectId,
  title,
  onGameUpdated,
}: Readonly<ArtworkSourcePickerProps>) {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();

  const [assetType, setAssetType] = useState<AssetType>("cover");
  const [source, setSource] = useState<ArtworkSource>("steamgriddb");
  const [options, setOptions] = useState<ArtworkOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [applyingUrl, setApplyingUrl] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const availableSources = SOURCES_FOR[assetType];
  const aspect = useMemo(
    () => ASSET_TYPES.find((a) => a.key === assetType)!.aspect,
    [assetType]
  );

  const handleAssetTypeChange = (next: AssetType) => {
    setAssetType(next);
    setOptions([]);
    setHasSearched(false);
    // Keep the current source if it still supports the new type, else reset.
    if (!SOURCES_FOR[next].includes(source)) setSource(SOURCES_FOR[next][0]);
  };

  const loadOptions = useCallback(async () => {
    setIsLoading(true);
    setHasSearched(true);
    try {
      const results = await window.electron.searchGameArtwork({
        shop,
        objectId,
        title,
        assetType,
        source,
      });
      setOptions(results);
    } catch (error) {
      setOptions([]);
      showErrorToast(
        error instanceof Error ? error.message : "Failed to load artwork"
      );
    } finally {
      setIsLoading(false);
    }
  }, [assetType, objectId, shop, showErrorToast, source, title]);

  const handleApply = useCallback(
    async (option: ArtworkOption) => {
      setApplyingUrl(option.url);
      try {
        await window.electron.applyGameArtwork({
          shop,
          objectId,
          assetType,
          url: option.url,
        });
        showSuccessToast(
          t("artwork_applied", { defaultValue: "Artwork applied" })
        );
        await onGameUpdated();
      } catch (error) {
        showErrorToast(
          error instanceof Error ? error.message : "Failed to apply artwork"
        );
      } finally {
        setApplyingUrl(null);
      }
    },
    [
      assetType,
      objectId,
      onGameUpdated,
      shop,
      showErrorToast,
      showSuccessToast,
      t,
    ]
  );

  return (
    <div className="artwork-picker">
      <div className="artwork-picker__controls">
        <div className="artwork-picker__type-tabs">
          {ASSET_TYPES.map((type) => (
            <button
              key={type.key}
              type="button"
              className={`artwork-picker__type-tab${
                assetType === type.key
                  ? " artwork-picker__type-tab--active"
                  : ""
              }`}
              onClick={() => handleAssetTypeChange(type.key)}
            >
              {type.label}
            </button>
          ))}
        </div>

        <div className="artwork-picker__source-row">
          <label htmlFor="artwork-source" className="artwork-picker__label">
            {t("artwork_source", { defaultValue: "Source" })}
          </label>
          <select
            id="artwork-source"
            className="artwork-picker__source-select"
            value={source}
            onChange={(e) => setSource(e.target.value as ArtworkSource)}
          >
            {availableSources.map((src) => (
              <option key={src} value={src}>
                {SOURCE_LABEL[src]}
              </option>
            ))}
          </select>
          <Button
            type="button"
            theme="outline"
            onClick={loadOptions}
            disabled={isLoading}
          >
            {isLoading && (
              <SyncIcon className="artwork-picker__spinner" size={14} />
            )}
            {t("browse_artwork", { defaultValue: "Browse artwork" })}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="artwork-picker__hint">
          {t("loading_artwork", { defaultValue: "Loading artwork…" })}
        </p>
      ) : options.length > 0 ? (
        <div
          className="artwork-picker__grid"
          style={
            {
              "--artwork-aspect": aspect,
            } as React.CSSProperties
          }
        >
          {options.map((option) => (
            <button
              key={option.url}
              type="button"
              className={`artwork-picker__item${
                assetType === "logo" ? " artwork-picker__item--transparent" : ""
              }`}
              onClick={() => handleApply(option)}
              disabled={applyingUrl !== null}
            >
              <img
                src={option.thumbnailUrl}
                alt=""
                loading="lazy"
                draggable={false}
              />
              {applyingUrl === option.url && (
                <span className="artwork-picker__item-overlay">
                  <SyncIcon className="artwork-picker__spinner" size={20} />
                </span>
              )}
            </button>
          ))}
        </div>
      ) : hasSearched ? (
        <p className="artwork-picker__hint">
          {t("no_artwork_found", {
            defaultValue: "No artwork found for this game from {{source}}.",
            source: SOURCE_LABEL[source],
          })}
        </p>
      ) : (
        <p className="artwork-picker__hint">
          {t("browse_artwork_hint", {
            defaultValue:
              "Pick an asset type and source, then browse community artwork.",
          })}
        </p>
      )}
    </div>
  );
}
