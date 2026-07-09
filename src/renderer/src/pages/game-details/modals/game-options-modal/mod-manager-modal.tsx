import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DownloadIcon,
  UploadIcon,
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
  ModInstallPrep,
  ModOptionGroup,
} from "@types";
import { Modal, Button } from "@renderer/components";
import { SettingSelect } from "@renderer/pages/settings/emulation/setting-select";
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
  // Headless option chooser: when a mod exposes configurable options we stage it
  // and let the user pick, then finalize — no UKMM GUI ever opens.
  const [optionPrep, setOptionPrep] = useState<{
    stagingId: string;
    name: string;
    groups: ModOptionGroup[];
  } | null>(null);
  const [optionSel, setOptionSel] = useState<Record<number, string[]>>({});
  const [finalizing, setFinalizing] = useState(false);

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

  /** Open the option chooser for a staged mod, seeding required defaults. */
  const beginOptions = (prep: ModInstallPrep) => {
    const groups = prep.optionGroups ?? [];
    const seed: Record<number, string[]> = {};
    groups.forEach((g, i) => {
      // Required single-choice groups default to the first option.
      seed[i] =
        g.type === "single" && g.required && g.options[0]
          ? [g.options[0].folder]
          : [];
    });
    setOptionSel(seed);
    setOptionPrep({
      stagingId: prep.stagingId!,
      name: prep.name ?? "Mod",
      groups,
    });
  };

  const runInstall = async (modId: number, name: string) => {
    setInstallingId(modId);
    try {
      const res = await window.electron.installMod(
        game.shop,
        game.objectId,
        modId
      );
      if (res.needsOptions) {
        beginOptions(res);
      } else if (res.ok) {
        showSuccessToast(`Installed ${name}`);
        await loadInstalled();
      } else {
        showErrorToast(res.reason ?? "Install failed");
      }
    } finally {
      setInstallingId(null);
    }
  };

  const confirmOptions = async () => {
    if (!optionPrep) return;
    setFinalizing(true);
    try {
      const folders = optionPrep.groups.flatMap((_, i) => optionSel[i] ?? []);
      const res = await window.electron.finalizeModInstall(
        game.shop,
        game.objectId,
        optionPrep.stagingId,
        folders
      );
      if (res.ok) {
        showSuccessToast(`Installed ${optionPrep.name}`);
        setOptionPrep(null);
        setDetail(null);
        await loadInstalled();
      } else {
        showErrorToast(res.reason ?? "Install failed");
      }
    } finally {
      setFinalizing(false);
    }
  };

  const cancelOptions = async () => {
    if (optionPrep) {
      await window.electron.cancelModInstall(optionPrep.stagingId).catch(() => {});
    }
    setOptionPrep(null);
  };

  const toggleOption = (groupIndex: number, folder: string) => {
    const group = optionPrep?.groups[groupIndex];
    if (!group) return;
    setOptionSel((prev) => {
      const cur = prev[groupIndex] ?? [];
      if (group.type === "single") {
        // Radio: replace (allow clearing an optional group by re-clicking).
        return {
          ...prev,
          [groupIndex]: cur.includes(folder) && !group.required ? [] : [folder],
        };
      }
      // Checkbox: toggle membership.
      return {
        ...prev,
        [groupIndex]: cur.includes(folder)
          ? cur.filter((f) => f !== folder)
          : [...cur, folder],
      };
    });
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

  // ── Option chooser (headless) ────────────────────────────────────────────────
  if (optionPrep) {
    const canConfirm = optionPrep.groups.every(
      (g, i) => !g.required || (optionSel[i]?.length ?? 0) > 0
    );
    return (
      <Modal
        visible
        className="modal--mod-manager"
        title={`Options — ${optionPrep.name}`}
        onClose={cancelOptions}
        large
      >
        <div className="mod-manager mod-manager--options">
          <p className="mod-manager__muted" style={{ padding: "0 0 4px" }}>
            This mod has configurable options. Choose what to install — it all
            happens in the background, no external app opens.
          </p>
          <div className="mod-manager__scroll">
            {optionPrep.groups.map((group, gi) => (
              <div className="mod-manager__opt-group" key={`${group.name}-${gi}`}>
                <div className="mod-manager__opt-title">
                  {group.name}
                  {group.required && (
                    <span className="mod-manager__opt-req"> (required)</span>
                  )}
                </div>
                {group.description && (
                  <div className="mod-manager__opt-desc">
                    {group.description}
                  </div>
                )}
                <ul className="mod-manager__opt-list">
                  {group.options.map((opt) => {
                    const checked = (optionSel[gi] ?? []).includes(opt.folder);
                    return (
                      <li key={opt.folder}>
                        <label className="mod-manager__opt-item">
                          <input
                            type={group.type === "single" ? "radio" : "checkbox"}
                            name={`group-${gi}`}
                            checked={checked}
                            onChange={() => toggleOption(gi, opt.folder)}
                          />
                          <span>
                            <span className="mod-manager__opt-name">
                              {opt.name}
                            </span>
                            {opt.description && (
                              <span className="mod-manager__opt-sub">
                                {opt.description}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <div className="mod-manager__opt-actions">
            <Button theme="outline" onClick={cancelOptions} disabled={finalizing}>
              Cancel
            </Button>
            <Button
              theme="primary"
              onClick={confirmOptions}
              disabled={!canConfirm || finalizing}
            >
              {finalizing ? "Installing…" : "Install"}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── Detail view ────────────────────────────────────────────────────────────
  if (detail) {
    const imgs = detail.gallery;
    return (
      <Modal
        visible
        className="modal--mod-manager"
        title={detail.name}
        onClose={onClose}
        large
      >
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
    <Modal
      visible
      className="modal--mod-manager"
      title="Mod manager"
      onClose={onClose}
      large
    >
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
              <SettingSelect
                ariaLabel="Sort mods"
                value={sort}
                disabled={Boolean(search)}
                options={[
                  { value: "likes", label: "Most liked" },
                  { value: "downloads", label: "Most downloaded" },
                  { value: "newest", label: "Newest" },
                  { value: "updated", label: "Recently updated" },
                ]}
                onChange={(v) => {
                  setPage(1);
                  setSort(v as Sort);
                }}
              />
              <SettingSelect
                ariaLabel="Filter by category"
                value={categoryId != null ? String(categoryId) : ""}
                disabled={Boolean(search)}
                options={[
                  { value: "", label: "All categories" },
                  ...categories.map((c) => ({
                    value: String(c.id),
                    label: c.name,
                  })),
                ]}
                onChange={(v) => {
                  setPage(1);
                  setCategoryId(v ? Number(v) : null);
                }}
              />
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
            <div className="mod-manager__modpack-actions">
              <button
                type="button"
                className="mod-manager__pack-btn"
                onClick={async () => {
                  const res = await window.electron.exportModpack(
                    game.shop,
                    game.objectId
                  );
                  if (res.ok) showSuccessToast("Modpack exported");
                  else if (!res.canceled)
                    showErrorToast(res.reason ?? "Export failed");
                }}
              >
                <UploadIcon size={13} /> Export modpack
              </button>
              <button
                type="button"
                className="mod-manager__pack-btn"
                onClick={async () => {
                  const res = await window.electron.importModpack(
                    game.shop,
                    game.objectId
                  );
                  if (res.ok) {
                    showSuccessToast("Modpack imported");
                    await loadInstalled();
                  } else if (!res.canceled)
                    showErrorToast(res.reason ?? "Import failed");
                }}
              >
                <DownloadIcon size={13} /> Import modpack
              </button>
              <button
                type="button"
                className="mod-manager__pack-btn mod-manager__pack-btn--danger"
                title="Clear all installed mods and reset UKMM (use if the list is stuck or out of sync)"
                onClick={async () => {
                  const res = await window.electron.resetMods(
                    game.shop,
                    game.objectId
                  );
                  if (res.ok) {
                    showSuccessToast("Mods reset");
                    await loadInstalled();
                  } else {
                    showErrorToast(res.reason ?? "Reset failed");
                  }
                }}
              >
                <TrashIcon size={13} /> Reset all
              </button>
            </div>
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
