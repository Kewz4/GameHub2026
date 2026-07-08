import { useCallback, useEffect, useMemo, useState } from "react";
import { DownloadIcon, SyncIcon, InfoIcon } from "@primer/octicons-react";
import type { CemuGraphicPack, LibraryGame } from "@types";
import { useToast } from "@renderer/hooks";
import { SettingSelect } from "@renderer/pages/settings/emulation/setting-select";
import "./graphic-packs-section.scss";

interface Props {
  game: LibraryGame;
}

/**
 * Cemu graphic-pack manager for a Wii U game: download the community pack
 * library, browse/search packs, toggle them on, and pick per-category presets.
 * All changes are written straight into Cemu's settings.xml.
 */
export function GraphicPacksSection({ game }: Readonly<Props>) {
  const { showErrorToast, showSuccessToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [hasLibrary, setHasLibrary] = useState(false);
  const [packs, setPacks] = useState<CemuGraphicPack[]>([]);
  const [filter, setFilter] = useState("");
  // Whether we identified this game's title id (packs are always scoped to it).
  const [couldIdentify, setCouldIdentify] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.electron.listCemuGraphicPacks(
        game.shop,
        game.objectId
      );
      setHasLibrary(res.hasLibrary);
      setPacks(res.packs);
      setCouldIdentify(res.titleId != null);
    } catch {
      showErrorToast("Couldn't load graphic packs");
    } finally {
      setLoading(false);
    }
  }, [showErrorToast, game.shop, game.objectId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await window.electron.downloadCemuGraphicPacks();
      if (res.ok) {
        showSuccessToast(`Downloaded ${res.count} graphic packs`);
        await load();
      } else {
        showErrorToast(res.reason ?? "Download failed");
      }
    } catch {
      showErrorToast("Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const onToggle = async (pack: CemuGraphicPack, enabled: boolean) => {
    setPacks((prev) =>
      prev.map((p) => (p.id === pack.id ? { ...p, enabled } : p))
    );
    const ok = await window.electron.setCemuGraphicPackEnabled(
      pack.id,
      enabled
    );
    if (!ok) {
      showErrorToast("Couldn't update graphic pack");
      load();
    }
  };

  const onPreset = async (
    pack: CemuGraphicPack,
    category: string,
    preset: string
  ) => {
    setPacks((prev) =>
      prev.map((p) =>
        p.id === pack.id
          ? {
              ...p,
              enabled: true,
              presets: p.presets.map((c) =>
                c.category === category ? { ...c, active: preset } : c
              ),
            }
          : p
      )
    );
    const ok = await window.electron.setCemuGraphicPackPreset(
      pack.id,
      category,
      preset
    );
    if (!ok) {
      showErrorToast("Couldn't update preset");
      load();
    }
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return packs;
    return packs.filter(
      (p) =>
        p.path.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
    );
  }, [packs, filter]);

  // Surface the packs that are already enabled first so their state is obvious.
  const ordered = useMemo(
    () =>
      [...filtered].sort((a, b) => Number(b.enabled) - Number(a.enabled) || 0),
    [filtered]
  );

  return (
    <div className="graphic-packs">
      <div className="graphic-packs__header">
        <div>
          <h3 className="graphic-packs__title">Graphic packs</h3>
          <p className="graphic-packs__subtitle">
            Community mods for {game.title} — resolutions, frame-rate,
            enhancements and more. Applied via Cemu&apos;s settings.
          </p>
        </div>
        <button
          type="button"
          className="graphic-packs__download"
          disabled={downloading}
          onClick={handleDownload}
        >
          {hasLibrary ? <SyncIcon size={14} /> : <DownloadIcon size={14} />}
          <span>
            {downloading
              ? "Downloading…"
              : hasLibrary
                ? "Update library"
                : "Download packs"}
          </span>
        </button>
      </div>

      {loading ? (
        <p className="graphic-packs__muted">Loading…</p>
      ) : !hasLibrary ? (
        <p className="graphic-packs__muted">
          <InfoIcon size={14} /> No graphic packs installed yet. Download the
          community library to get started.
        </p>
      ) : (
        <>
          {!couldIdentify && (
            <p className="graphic-packs__muted">
              <InfoIcon size={14} /> Couldn&apos;t identify this game from its
              files — showing all packs.
            </p>
          )}
          <input
            className="graphic-packs__search"
            placeholder="Search packs (try the game name)…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {ordered.length === 0 ? (
            <p className="graphic-packs__muted">No packs match your search.</p>
          ) : (
            <ul className="graphic-packs__list">
              {ordered.map((pack) => (
                <li
                  key={pack.id}
                  className={`graphic-packs__item ${
                    pack.enabled ? "graphic-packs__item--on" : ""
                  }`}
                >
                  <label className="graphic-packs__item-head">
                    <input
                      type="checkbox"
                      checked={pack.enabled}
                      onChange={(e) => onToggle(pack, e.target.checked)}
                    />
                    <span className="graphic-packs__item-path">
                      {pack.path}
                    </span>
                  </label>
                  {pack.description && (
                    <p className="graphic-packs__item-desc">
                      {pack.description}
                    </p>
                  )}
                  {pack.enabled && pack.presets.length > 0 && (
                    <div className="graphic-packs__presets">
                      {pack.presets.map((cat) => (
                        <div
                          key={cat.category || "default"}
                          className="graphic-packs__preset-row"
                        >
                          <span className="graphic-packs__preset-label">
                            {cat.category || "Preset"}
                          </span>
                          <SettingSelect
                            value={cat.active ?? cat.options[0] ?? ""}
                            options={cat.options.map((o) => ({
                              value: o,
                              label: o,
                            }))}
                            onChange={(v) => onPreset(pack, cat.category, v)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
