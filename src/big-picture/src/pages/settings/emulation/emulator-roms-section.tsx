import {
  CaretLeftIcon,
  CaretRightIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { getRegionsFromSkus, getSkuRegionFlag } from "@renderer/helpers";
import { formatBytes } from "@shared";
import type { DetectedRom, EmulatorSystem } from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, HorizontalFocusGroup, Input } from "../../../components";
import { getBigPictureEmulatorRomsPage } from "./emulator-roms-presentation";

interface BigPictureEmulatorRomsSectionProps {
  system: EmulatorSystem;
  systemLabel: string;
  refreshKey: number | null;
}

export function BigPictureEmulatorRomsSection({
  system,
  systemLabel,
  refreshKey,
}: Readonly<BigPictureEmulatorRomsSectionProps>) {
  const [roms, setRoms] = useState<DetectedRom[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setRoms(await globalThis.window.electron.listEmulatorRoms(system));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [system]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => setPage(0), [query, system]);

  const presentation = useMemo(
    () => getBigPictureEmulatorRomsPage(roms, query, page),
    [page, query, roms]
  );

  return (
    <section className="emulator-detail__section">
      <header className="emulator-detail__section-header">
        <div className="emulator-detail__section-text">
          <h3>Detected games</h3>
          <p>Games imported for {systemLabel}, including region and size.</p>
        </div>
      </header>

      {loading ? (
        <p className="emulator-detail__empty" role="status">
          Loading detected games…
        </p>
      ) : null}

      {loadError ? (
        <div className="emulator-detail__rom-error" role="alert">
          <span>The detected game list could not be loaded.</span>
          <Button variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : null}

      {!loading && !loadError && roms.length === 0 ? (
        <p className="emulator-detail__empty" role="status">
          No games have been detected for this console yet.
        </p>
      ) : null}

      {!loading && !loadError && roms.length > 0 ? (
        <>
          <Input
            label="Search detected games"
            value={query}
            iconLeft={<MagnifyingGlassIcon size={18} />}
            onChange={(event) => setQuery(event.target.value)}
          />

          {presentation.items.length === 0 ? (
            <p className="emulator-detail__empty" role="status">
              No detected games match that search.
            </p>
          ) : (
            <div className="emulator-detail__roms">
              {presentation.items.map((rom) => {
                const image = rom.libraryImageUrl ?? rom.iconUrl;
                const regions = getRegionsFromSkus(rom.skus);
                return (
                  <article className="emulator-detail__rom" key={rom.objectId}>
                    <span className="emulator-detail__rom-cover">
                      {image ? <img src={image} alt="" loading="lazy" /> : null}
                    </span>
                    <span className="emulator-detail__rom-title">
                      {rom.title}
                    </span>
                    {rom.sizeBytes !== null ? (
                      <span className="emulator-detail__rom-size">
                        {formatBytes(rom.sizeBytes)}
                      </span>
                    ) : null}
                    {regions.length > 0 ? (
                      <span className="emulator-detail__rom-regions">
                        {regions.map((region) => (
                          <img
                            key={region}
                            src={getSkuRegionFlag(region)}
                            alt={region}
                            title={region}
                          />
                        ))}
                      </span>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}

          {presentation.pageCount > 1 ? (
            <HorizontalFocusGroup className="emulator-detail__pagination">
              <Button
                size="icon"
                variant="secondary"
                aria-label="Previous detected-games page"
                disabled={presentation.page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                <CaretLeftIcon size={18} />
              </Button>
              <span>
                Page {presentation.page + 1} of {presentation.pageCount}
              </span>
              <Button
                size="icon"
                variant="secondary"
                aria-label="Next detected-games page"
                disabled={presentation.page >= presentation.pageCount - 1}
                onClick={() =>
                  setPage((current) =>
                    Math.min(presentation.pageCount - 1, current + 1)
                  )
                }
              >
                <CaretRightIcon size={18} />
              </Button>
            </HorizontalFocusGroup>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
