import type { GameShop } from "@types";
import { SpinnerIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  DropdownSelect,
  FocusItem,
  GridFocusGroup,
  HorizontalFocusGroup,
  Modal,
  VerticalFocusGroup,
} from "../../../common";
import { useBigPictureToast } from "../../../../hooks";

import "./online-artwork-picker-modal.scss";

type ArtworkAssetType = "cover" | "hero" | "logo" | "icon";
type ArtworkSource = "steamgriddb" | "igdb";

interface ArtworkOption {
  url: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
}

const ASSET_TYPES: {
  key: ArtworkAssetType;
  label: string;
  aspect: string;
}[] = [
  { key: "cover", label: "Cover", aspect: "2 / 3" },
  { key: "hero", label: "Hero", aspect: "16 / 6" },
  { key: "logo", label: "Logo", aspect: "16 / 9" },
  { key: "icon", label: "Icon", aspect: "1 / 1" },
];

// IGDB only carries covers and landscape artwork — no logos/icons.
const SOURCES_FOR: Record<ArtworkAssetType, ArtworkSource[]> = {
  cover: ["steamgriddb", "igdb"],
  hero: ["steamgriddb", "igdb"],
  logo: ["steamgriddb"],
  icon: ["steamgriddb"],
};

const SOURCE_LABEL: Record<ArtworkSource, string> = {
  steamgriddb: "SteamGridDB",
  igdb: "IGDB",
};

const ASSET_ASPECT = (assetType: ArtworkAssetType) =>
  ASSET_TYPES.find((asset) => asset.key === assetType)!.aspect;

const ONLINE_ARTWORK_PICKER_SEARCH_ID = "online-artwork-picker-search";
const ONLINE_ARTWORK_PICKER_GRID_REGION_ID = "online-artwork-picker-grid";

export interface OnlineArtworkPickerModalProps {
  visible: boolean;
  onClose: () => void;
  shop: GameShop;
  objectId: string;
  title: string;
  initialAssetType?: ArtworkAssetType;
  onArtworkApplied: () => Promise<void> | void;
}

export function OnlineArtworkPickerModal({
  visible,
  onClose,
  shop,
  objectId,
  title,
  initialAssetType = "cover",
  onArtworkApplied,
}: Readonly<OnlineArtworkPickerModalProps>) {
  const { showSuccessToast, showErrorToast } = useBigPictureToast();

  const [assetType, setAssetType] =
    useState<ArtworkAssetType>(initialAssetType);
  const [source, setSource] = useState<ArtworkSource>("steamgriddb");
  const [options, setOptions] = useState<ArtworkOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [applyingUrl, setApplyingUrl] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const availableSources = SOURCES_FOR[assetType];

  useEffect(() => {
    if (!visible) return;
    setAssetType(initialAssetType);
    setSource(SOURCES_FOR[initialAssetType][0]);
    setOptions([]);
    setHasSearched(false);
    setApplyingUrl(null);
  }, [visible, initialAssetType]);

  const loadOptions = useCallback(async () => {
    setIsLoading(true);
    setHasSearched(true);
    try {
      const results = await globalThis.window.electron.searchGameArtwork({
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

  // Auto-search whenever the modal is open and the asset type / source changes.
  useEffect(() => {
    if (!visible) return;
    void loadOptions();
  }, [visible, loadOptions]);

  const handleAssetTypeChange = useCallback((next: ArtworkAssetType) => {
    setAssetType(next);
    setOptions([]);
    setHasSearched(false);
    // Keep the current source if it still supports the new type, else reset.
    setSource((currentSource) =>
      SOURCES_FOR[next].includes(currentSource)
        ? currentSource
        : SOURCES_FOR[next][0]
    );
  }, []);

  const handleApply = useCallback(
    async (option: ArtworkOption) => {
      if (applyingUrl) return;
      setApplyingUrl(option.url);
      try {
        await globalThis.window.electron.applyGameArtwork({
          shop,
          objectId,
          assetType,
          url: option.url,
        });
        showSuccessToast("Artwork applied");
        await onArtworkApplied();
        onClose();
      } catch (error) {
        showErrorToast(
          error instanceof Error ? error.message : "Failed to apply artwork"
        );
      } finally {
        setApplyingUrl(null);
      }
    },
    [
      applyingUrl,
      assetType,
      objectId,
      onArtworkApplied,
      onClose,
      shop,
      showErrorToast,
      showSuccessToast,
    ]
  );

  const aspect = ASSET_ASPECT(assetType);

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Browse online artwork"
      description="Search SteamGridDB and IGDB for artwork, then select one to apply."
      className="online-artwork-picker-modal"
    >
      <VerticalFocusGroup className="online-artwork-picker">
        <HorizontalFocusGroup className="online-artwork-picker__controls">
          <DropdownSelect<ArtworkAssetType>
            label="Asset"
            focusId={ONLINE_ARTWORK_PICKER_SEARCH_ID}
            value={assetType}
            options={ASSET_TYPES.map((asset) => ({
              value: asset.key,
              label: asset.label,
            }))}
            onValueChange={handleAssetTypeChange}
          />

          <DropdownSelect<ArtworkSource>
            label="Source"
            value={source}
            options={availableSources.map((src) => ({
              value: src,
              label: SOURCE_LABEL[src],
            }))}
            onValueChange={(next) => setSource(next)}
          />

          <Button
            variant="secondary"
            loading={isLoading}
            disabled={isLoading}
            onClick={() => {
              void loadOptions();
            }}
          >
            Refresh
          </Button>
        </HorizontalFocusGroup>

        <div className="online-artwork-picker__results">
          {isLoading ? (
            <div className="online-artwork-picker__status">
              <SpinnerIcon
                size={24}
                className="online-artwork-picker__spinner"
              />
              <span>Loading artwork…</span>
            </div>
          ) : options.length > 0 ? (
            <GridFocusGroup
              regionId={ONLINE_ARTWORK_PICKER_GRID_REGION_ID}
              className="online-artwork-picker__grid"
              style={
                {
                  "--online-artwork-aspect": aspect,
                } as React.CSSProperties
              }
            >
              {options.map((option) => (
                <FocusItem
                  key={option.url}
                  asChild
                  actions={{ primary: () => void handleApply(option) }}
                >
                  <button
                    type="button"
                    className={`online-artwork-picker__item${
                      assetType === "logo"
                        ? " online-artwork-picker__item--transparent"
                        : ""
                    }`}
                    onClick={() => void handleApply(option)}
                    disabled={applyingUrl !== null}
                  >
                    <img
                      src={option.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      draggable={false}
                    />
                    {applyingUrl === option.url ? (
                      <span className="online-artwork-picker__item-overlay">
                        <SpinnerIcon
                          size={22}
                          className="online-artwork-picker__spinner"
                        />
                      </span>
                    ) : null}
                  </button>
                </FocusItem>
              ))}
            </GridFocusGroup>
          ) : hasSearched ? (
            <p className="online-artwork-picker__status">
              No artwork found for this game from {SOURCE_LABEL[source]}.
            </p>
          ) : (
            <p className="online-artwork-picker__status">
              Pick an asset type and source to browse community artwork.
            </p>
          )}
        </div>
      </VerticalFocusGroup>
    </Modal>
  );
}
