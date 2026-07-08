import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DownloadIcon,
  TrashIcon,
  EyeIcon,
  HeartIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
} from "@primer/octicons-react";
import type {
  GameBananaMod,
  GameBananaModDetail,
  InstalledMod,
  LibraryGame,
} from "@types";
import { Modal } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import "./mod-manager-modal.scss";

interface Props {
  game: LibraryGame;
  onClose: () => void;
}

type Tab = "browse" | "manage";
type Sort = "newest" | "updated" | "likes" | "downloads";

/** Strip GameBanana's HTML description down to readable plain text. */
const htmlToText = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function ModManagerModal({ game, onClose }: Readonly<Props>) {
  const { showErrorToast, showSuccessToast } = useToast();
  const [tab, setTab] = useState<Tab>("browse");
  const [mods, setMods] = useState<GameBananaMod[]>([]);
  const [installed, setInstalled] = useState<InstalledMod[]>([]);
  const [categories, setCategories] = useState<{ id: number; name: string }[]>(
    []
  );
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>("likes");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<number | null>(null);
  const [uninstallingIdx, setUninstallingIdx] = useState<number | null>(null);
  const [detail, setDetail] = useState<GameBananaModDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  // Debounce the search box.
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    searchTimer.current = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 450);
    return () => clearTimeout(searchTimer.current);
  }, [searchInput]);

  const loadBrowse = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.electron.browseGameBananaMods({
        page,
        sort,
        categoryId,
        search: search || undefined,
      });
      setMods(res);
    } catch {
      showErrorToast("Couldn't load mods from GameBanana");
    } finally {
      setLoading(false);
    }
  }, [page, sort, categoryId, search, showErrorToast]);

  const loadInstalled = useCallback(async () => {
    const s = await window.electron
      .getModStatus(game.shop, game.objectId)
      .catch(() => null);
    if (s) setInstalled(s.installed);
  }, [game.shop, game.objectId]);

  useEffect(() => {
    loadBrowse();
  }, [loadBrowse]);
  useEffect(() => {
    loadInstalled();
  }, [loadInstalled]);
  useEffect(() => {
    window.electron
      .listModCategories()
      .then(setCategories)
      .catch(() => {});
  }, []);

  const openDetail = async (mod: GameBananaMod) => {
    setDetailLoading(true);
    setGalleryIndex(0);
    setDetail({
      id: mod.id,
      name: mod.name,
      description: "",
      submitter: mod.submitter,
      likes: mod.likes,
      views: mod.views,
      profileUrl: mod.profileUrl,
      gallery: mod.imageUrl ? [mod.imageUrl] : [],
      files: [],
    });
    try {
      const d = await window.electron.getGameBananaMod(mod.id);
      if (d) setDetail(d);
    } finally {
      setDetailLoading(false);
    }
  };

  const runInstall = async (modId: number, name: string) => {
    setInstallingId(modId);
    try {
      const res = await window.electron.installMod(
        game.shop,
        game.objectId,
        modId
      );
      if (res.ok) {
        showSuccessToast(`Installed ${name}`);
        await loadInstalled();
      } else if (res.guiHandoff) {
        showSuccessToast(res.reason ?? "Opened in UKMM to finish install");
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

  const installedIds = useMemo(
    () => new Set(installed.map((m) => m.gbModId)),
    [installed]
  );

  // ── Detail view ────────────────────────────────────────────────────────────
  if (detail) {
    const imgs = detail.gallery;
    return (
      <Modal visible title={detail.name} onClose={onClose} large>
        <div className="mod-manager mod-manager--detail">
          <button
            type="button"
            className="mod-manager__back"
            onClick={() => setDetail(null)}
          >
            <ChevronLeftIcon size={14} /> Back to browse
          </button>

          {imgs.length > 0 && (
            <div className="mod-manager__gallery">
              <img src={imgs[galleryIndex]} alt={detail.name} />
              {imgs.length > 1 && (
                <>
                  <button
                    type="button"
                    className="mod-manager__gallery-nav mod-manager__gallery-nav--prev"
                    onClick={() =>
                      setGalleryIndex(
                        (i) => (i - 1 + imgs.length) % imgs.length
                      )
                    }
                  >
                    <ChevronLeftIcon size={18} />
                  </button>
                  <button
                    type="button"
                    className="mod-manager__gallery-nav mod-manager__gallery-nav--next"
                    onClick={() => setGalleryIndex((i) => (i + 1) % imgs.length)}
                  >
                    <ChevronRightIcon size={18} />
                  </button>
                  <span className="mod-manager__gallery-count">
                    {galleryIndex + 1} / {imgs.length}
                  </span>
                </>
              )}
            </div>
          )}

          <div className="mod-manager__detail-head">
            <span className="mod-manager__card-stats">
              {detail.submitter ? `by ${detail.submitter}` : ""}
              <HeartIcon size={12} /> {detail.likes}
              <EyeIcon size={12} /> {detail.views}
            </span>
            <button
              type="button"
              className="mod-manager__install"
              disabled={installingId === detail.id || installedIds.has(detail.id)}
              onClick={() => runInstall(detail.id, detail.name)}
            >
              <DownloadIcon size={13} />
              <span>
                {installedIds.has(detail.id)
                  ? "Installed"
                  : installingId === detail.id
                    ? "Installing…"
                    : "Install"}
              </span>
            </button>
          </div>

          <div className="mod-manager__description">
            {detailLoading
              ? "Loading description…"
              : htmlToText(detail.description) || "No description provided."}
          </div>
        </div>
      </Modal>
    );
  }

  // ── Browse / Manage ─────────────────────────────────────────────────────────
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
            <div className="mod-manager__controls">
              <div className="mod-manager__search">
                <SearchIcon size={14} />
                <input
                  placeholder="Search mods…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <select
                className="mod-manager__select"
                value={sort}
                onChange={(e) => {
                  setPage(1);
                  setSort(e.target.value as Sort);
                }}
                disabled={Boolean(search)}
              >
                <option value="likes">Most liked</option>
                <option value="downloads">Most downloaded</option>
                <option value="newest">Newest</option>
                <option value="updated">Recently updated</option>
              </select>
              <select
                className="mod-manager__select"
                value={categoryId ?? ""}
                onChange={(e) => {
                  setPage(1);
                  setCategoryId(e.target.value ? Number(e.target.value) : null);
                }}
                disabled={Boolean(search)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mod-manager__scroll">
              {loading ? (
                <p className="mod-manager__muted">Loading mods…</p>
              ) : mods.length === 0 ? (
                <p className="mod-manager__muted">No mods found.</p>
              ) : (
                <ul className="mod-manager__grid">
                  {mods.map((mod) => (
                    <li key={mod.id} className="mod-manager__card">
                      <button
                        type="button"
                        className="mod-manager__thumb"
                        onClick={() => openDetail(mod)}
                        title={`View ${mod.name}`}
                      >
                        {mod.imageUrl ? (
                          <img
                            src={mod.imageUrl}
                            alt={mod.name}
                            loading="lazy"
                          />
                        ) : (
                          <div className="mod-manager__thumb-placeholder" />
                        )}
                      </button>
                      <div className="mod-manager__card-body">
                        <button
                          type="button"
                          className="mod-manager__card-name"
                          title={mod.name}
                          onClick={() => openDetail(mod)}
                        >
                          {mod.name}
                        </button>
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
                        onClick={() => runInstall(mod.id, mod.name)}
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
            </div>

            {!search && (
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
            )}
          </>
        ) : (
          <div className="mod-manager__scroll">
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
          </div>
        )}
      </div>
    </Modal>
  );
}
