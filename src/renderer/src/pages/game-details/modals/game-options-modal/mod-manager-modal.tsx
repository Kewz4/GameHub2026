import { useCallback, useEffect, useState } from "react";
import {
  DownloadIcon,
  TrashIcon,
  EyeIcon,
  HeartIcon,
} from "@primer/octicons-react";
import type { GameBananaMod, InstalledMod, LibraryGame } from "@types";
import { Modal } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import "./mod-manager-modal.scss";

interface Props {
  game: LibraryGame;
  onClose: () => void;
}

type Tab = "browse" | "manage";

export function ModManagerModal({ game, onClose }: Readonly<Props>) {
  const { showErrorToast, showSuccessToast } = useToast();
  const [tab, setTab] = useState<Tab>("browse");
  const [mods, setMods] = useState<GameBananaMod[]>([]);
  const [installed, setInstalled] = useState<InstalledMod[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<number | null>(null);
  const [uninstallingIdx, setUninstallingIdx] = useState<number | null>(null);

  const loadBrowse = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const res = await window.electron.browseGameBananaMods(p);
        setMods(res);
      } catch {
        showErrorToast("Couldn't load mods from GameBanana");
      } finally {
        setLoading(false);
      }
    },
    [showErrorToast]
  );

  const loadInstalled = useCallback(async () => {
    const s = await window.electron
      .getModStatus(game.shop, game.objectId)
      .catch(() => null);
    if (s) setInstalled(s.installed);
  }, [game.shop, game.objectId]);

  useEffect(() => {
    loadBrowse(page);
  }, [loadBrowse, page]);

  useEffect(() => {
    loadInstalled();
  }, [loadInstalled]);

  const handleInstall = async (mod: GameBananaMod) => {
    setInstallingId(mod.id);
    try {
      const res = await window.electron.installMod(
        game.shop,
        game.objectId,
        mod.id
      );
      if (res.ok) {
        showSuccessToast(`Installed ${mod.name}`);
        await loadInstalled();
      } else {
        showErrorToast(res.reason ?? "Install failed");
      }
    } finally {
      setInstallingId(null);
    }
  };

  const handleUninstall = async (index: number) => {
    setUninstallingIdx(index);
    try {
      const res = await window.electron.uninstallMod(
        game.shop,
        game.objectId,
        index
      );
      if (res.ok) {
        showSuccessToast("Mod removed");
        await loadInstalled();
      } else {
        showErrorToast(res.reason ?? "Couldn't remove mod");
      }
    } finally {
      setUninstallingIdx(null);
    }
  };

  const installedIds = new Set(installed.map((m) => m.gbModId));

  return (
    <Modal visible title="Mod manager" onClose={onClose} large>
      <div className="mod-manager">
        <div className="mod-manager__tabs">
          <button
            type="button"
            className={`mod-manager__tab ${tab === "browse" ? "mod-manager__tab--active" : ""}`}
            onClick={() => setTab("browse")}
          >
            Browse mods
          </button>
          <button
            type="button"
            className={`mod-manager__tab ${tab === "manage" ? "mod-manager__tab--active" : ""}`}
            onClick={() => setTab("manage")}
          >
            Installed ({installed.length})
          </button>
        </div>

        {tab === "browse" ? (
          <>
            {loading ? (
              <p className="mod-manager__muted">Loading mods…</p>
            ) : (
              <ul className="mod-manager__grid">
                {mods.map((mod) => (
                  <li key={mod.id} className="mod-manager__card">
                    <div className="mod-manager__thumb">
                      {mod.imageUrl ? (
                        <img src={mod.imageUrl} alt={mod.name} loading="lazy" />
                      ) : (
                        <div className="mod-manager__thumb-placeholder" />
                      )}
                    </div>
                    <div className="mod-manager__card-body">
                      <span className="mod-manager__card-name" title={mod.name}>
                        {mod.name}
                      </span>
                      <span className="mod-manager__card-meta">
                        {mod.category ?? "Mod"}
                        {mod.submitter ? ` · ${mod.submitter}` : ""}
                      </span>
                      <span className="mod-manager__card-stats">
                        <HeartIcon size={12} /> {mod.likes}
                        <EyeIcon size={12} /> {mod.views}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="mod-manager__install"
                      disabled={
                        installingId === mod.id || installedIds.has(mod.id)
                      }
                      onClick={() => handleInstall(mod)}
                    >
                      <DownloadIcon size={13} />
                      <span>
                        {installedIds.has(mod.id)
                          ? "Installed"
                          : installingId === mod.id
                            ? "Installing…"
                            : "Install"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mod-manager__pager">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span>Page {page}</span>
              <button
                type="button"
                disabled={loading || mods.length === 0}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <>
            {installed.length === 0 ? (
              <p className="mod-manager__muted">
                No mods installed yet — install some from the Browse tab.
              </p>
            ) : (
              <ul className="mod-manager__installed">
                {installed.map((mod, index) => (
                  <li
                    key={`${mod.gbModId}-${index}`}
                    className="mod-manager__installed-item"
                  >
                    <div className="mod-manager__installed-thumb">
                      {mod.thumbnailUrl && (
                        <img src={mod.thumbnailUrl} alt={mod.name} />
                      )}
                    </div>
                    <div className="mod-manager__installed-body">
                      <span className="mod-manager__card-name">{mod.name}</span>
                      <span className="mod-manager__card-meta">
                        Installed{" "}
                        {new Date(mod.installedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="mod-manager__remove"
                      disabled={uninstallingIdx === index}
                      onClick={() => handleUninstall(index)}
                    >
                      <TrashIcon size={13} />
                      <span>
                        {uninstallingIdx === index ? "Removing…" : "Remove"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
