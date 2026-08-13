import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AlertIcon,
  DownloadIcon,
  FileIcon,
  LinkIcon,
  SearchIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { useNavigate } from "react-router-dom";
import {
  classifyCustomDownloadSource,
  getCustomDownloadInputPresentation,
  isCustomDownloadFormReady,
  normalizeCustomDownloadTitle,
  suggestCustomDownloadTitle,
  type CustomDownloadEntryIntent,
} from "@shared";
import type { CatalogueSearchSuggestion } from "@types";
import { Button, CheckboxField, Modal, TextField } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";

import "./custom-download-modal.scss";

interface CustomDownloadModalProps {
  visible: boolean;
  initialIntent: CustomDownloadEntryIntent;
  onClose: () => void;
  onSubmitted: () => void;
}

function fileNameFromPath(filePath: string) {
  return filePath.split(/[\\/]/).at(-1) ?? filePath;
}

export function CustomDownloadModal({
  visible,
  initialIntent,
  onClose,
  onSubmitted,
}: Readonly<CustomDownloadModalProps>) {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const navigate = useNavigate();
  const { showErrorToast, showSuccessToast } = useToast();
  const titleTouchedRef = useRef(false);
  const torrentPickerOpenedRef = useRef(false);
  const [source, setSource] = useState("");
  const [localTorrentPath, setLocalTorrentPath] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [downloadPath, setDownloadPath] = useState("");
  const [automaticallyExtract, setAutomaticallyExtract] = useState(true);
  const [deleteArchives, setDeleteArchives] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    CatalogueSearchSuggestion[]
  >([]);
  const [isSearching, setIsSearching] = useState(false);
  const [linkedGame, setLinkedGame] =
    useState<CatalogueSearchSuggestion | null>(null);
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const searchDebounceRef = useRef<number | null>(null);
  const hasTorBoxToken = Boolean(userPreferences?.torBoxApiToken?.trim());

  useEffect(() => {
    if (!visible) return;

    titleTouchedRef.current = false;
    torrentPickerOpenedRef.current = false;
    setSource("");
    setLocalTorrentPath(null);
    setTitle("");
    setSearchQuery("");
    setSearchResults([]);
    setLinkedGame(null);
    setIsSearchDropdownOpen(false);
    setError(null);
    setSubmitting(false);
    setAutomaticallyExtract(userPreferences?.extractFilesByDefault ?? true);
    setDeleteArchives(
      userPreferences?.deleteArchiveFilesAfterExtractionByDefault ?? false
    );

    let cancelled = false;
    void window.electron.getDefaultDownloadsPath().then((defaultPath) => {
      if (!cancelled) {
        setDownloadPath(userPreferences?.downloadsPath ?? defaultPath);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [initialIntent, userPreferences, visible]);

  const updateSuggestedTitle = useCallback(
    (nextSource: string, attachedFileName?: string | null) => {
      if (titleTouchedRef.current) return;
      const suggestion = suggestCustomDownloadTitle(
        nextSource,
        attachedFileName
      );
      if (suggestion) setTitle(suggestion);
    },
    []
  );

  const handleSearchGames = useCallback((query: string) => {
    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current);
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchDebounceRef.current = window.setTimeout(() => {
      void window.electron
        .searchCatalogueGames(trimmed, 8)
        .then((results) => {
          setSearchResults(results);
          setIsSearchDropdownOpen(true);
        })
        .finally(() => setIsSearching(false));
    }, 250);
  }, []);

  const handleSelectCatalogueGame = (suggestion: CatalogueSearchSuggestion) => {
    setLinkedGame(suggestion);
    setTitle(suggestion.title);
    setSearchQuery(suggestion.title);
    setSearchResults([]);
    setIsSearchDropdownOpen(false);
    titleTouchedRef.current = true;
  };

  const handleAttachTorrent = useCallback(async () => {
    const result = await window.electron.showOpenDialog({
      title: "Attach a torrent file",
      properties: ["openFile"],
      filters: [{ name: "Torrent files", extensions: ["torrent"] }],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return;

    setLocalTorrentPath(filePath);
    setSource("");
    setError(null);
    updateSuggestedTitle("", fileNameFromPath(filePath));
  }, [updateSuggestedTitle]);

  useEffect(() => {
    if (!visible || initialIntent !== "torrent") return;
    if (torrentPickerOpenedRef.current) return;
    torrentPickerOpenedRef.current = true;
    void handleAttachTorrent();
  }, [handleAttachTorrent, initialIntent, visible]);

  const handleBrowseDownloadPath = async () => {
    const result = await window.electron.showOpenDialog({
      title: "Choose download folder",
      defaultPath: downloadPath || undefined,
      properties: ["openDirectory", "createDirectory"],
    });
    const folderPath = result.filePaths[0];
    if (!result.canceled && folderPath) setDownloadPath(folderPath);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      if (!hasTorBoxToken) {
        throw new Error(
          "Connect TorBox in Settings > Integrations before adding a custom download"
        );
      }
      normalizeCustomDownloadTitle(title);
      if (!localTorrentPath) classifyCustomDownloadSource(source);
      if (!downloadPath.trim()) throw new Error("Choose a download folder");
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Check the download details"
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await window.electron.startCustomDownload({
        title,
        source,
        localTorrentPath,
        downloadPath,
        automaticallyExtract,
        automaticallyDeleteArchiveFiles: deleteArchives,
        linkedShop: linkedGame?.shop,
        linkedObjectId: linkedGame?.objectId,
      });
      if (!result.ok) {
        throw new Error(result.error ?? "GameHub could not start the download");
      }

      showSuccessToast(
        result.queued ? "Added to download queue" : "Download started",
        `${title.trim()} will be added to your library.`
      );
      onSubmitted();
      onClose();
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "GameHub could not start the download";
      setError(message);
      showErrorToast("Custom download failed", message);
    } finally {
      setSubmitting(false);
    }
  };

  const attachedFileName = localTorrentPath
    ? fileNameFromPath(localTorrentPath)
    : null;
  const inputPresentation = getCustomDownloadInputPresentation(initialIntent);
  const canSubmit = isCustomDownloadFormReady({
    hasTorBoxToken,
    source,
    localTorrentPath,
    title,
    downloadPath,
  });

  const handleOpenTorBoxSettings = () => {
    onClose();
    navigate("/settings?tab=integrations");
  };

  return (
    <Modal
      visible={visible}
      title="Add a custom download"
      description="Paste a direct link or magnet, or attach a .torrent. TorBox checks its cache before preparing the transfer."
      onClose={onClose}
      clickOutsideToClose={!submitting}
      className="custom-download-modal"
    >
      <form className="custom-download-modal__form" onSubmit={handleSubmit}>
        <div className="custom-download-modal__source-row">
          <TextField
            label={inputPresentation.label}
            value={source}
            placeholder={inputPresentation.placeholder}
            disabled={submitting}
            onChange={(event) => {
              const value = event.target.value;
              setSource(value);
              setLocalTorrentPath(null);
              setError(null);
              updateSuggestedTitle(value);
            }}
          />
          <Button
            type="button"
            theme="outline"
            onClick={handleAttachTorrent}
            disabled={submitting}
            aria-label="Attach a .torrent file"
          >
            <FileIcon size={16} />
            Attach .torrent
          </Button>
        </div>

        {attachedFileName && (
          <div className="custom-download-modal__attached" role="status">
            <FileIcon size={16} />
            <span>{attachedFileName}</span>
            <button
              type="button"
              onClick={() => setLocalTorrentPath(null)}
              disabled={submitting}
            >
              Remove
            </button>
          </div>
        )}

        <TextField
          label="Game name"
          value={title}
          placeholder="Name shown in your library"
          disabled={submitting}
          onChange={(event) => {
            titleTouchedRef.current = true;
            setTitle(event.target.value);
            setLinkedGame(null);
            setError(null);
          }}
        />

        {linkedGame ? (
          <div className="custom-download-modal__linked" role="status">
            <LinkIcon size={16} />
            <span>
              Linked to {linkedGame.title}
              {linkedGame.source === "classics" ? " (console)" : " (catalogue)"}
            </span>
            <button
              type="button"
              onClick={() => setLinkedGame(null)}
              disabled={submitting}
            >
              Unlink
            </button>
          </div>
        ) : (
          <div className="custom-download-modal__search">
            <TextField
              label="Link to a catalogue game (optional)"
              value={searchQuery}
              placeholder="Search games to attach metadata…"
              disabled={submitting}
              rightContent={<SearchIcon size={16} />}
              onChange={(event) => {
                const value = event.target.value;
                setSearchQuery(value);
                setError(null);
                handleSearchGames(value);
              }}
            />
            {isSearching && (
              <p className="custom-download-modal__search-hint">Searching…</p>
            )}
            {isSearchDropdownOpen &&
              !isSearching &&
              searchResults.length > 0 && (
                <ul
                  className="custom-download-modal__search-results"
                  role="listbox"
                >
                  {searchResults.map((suggestion) => (
                    <li key={`${suggestion.source}:${suggestion.objectId}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected="false"
                        onClick={() => handleSelectCatalogueGame(suggestion)}
                      >
                        <span className="custom-download-modal__search-title">
                          {suggestion.title}
                        </span>
                        <span className="custom-download-modal__search-source">
                          {suggestion.source === "classics"
                            ? "Console"
                            : "PC catalogue"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            {isSearchDropdownOpen &&
              !isSearching &&
              searchResults.length === 0 &&
              searchQuery.trim() && (
                <p className="custom-download-modal__search-hint">
                  No games found — the download will be added as a custom entry.
                </p>
              )}
          </div>
        )}

        <TextField
          label="Download folder"
          value={downloadPath}
          readOnly
          disabled={submitting}
          rightContent={
            <Button
              type="button"
              theme="outline"
              onClick={handleBrowseDownloadPath}
              disabled={submitting}
            >
              Browse
            </Button>
          }
        />

        <div className="custom-download-modal__options">
          <CheckboxField
            label="Automatically extract archives"
            checked={automaticallyExtract}
            disabled={submitting}
            onChange={(event) => setAutomaticallyExtract(event.target.checked)}
          />
          <CheckboxField
            label="Delete archive files after successful extraction"
            checked={deleteArchives}
            disabled={submitting || !automaticallyExtract}
            onChange={(event) => setDeleteArchives(event.target.checked)}
          />
        </div>

        {!hasTorBoxToken && (
          <div
            className="custom-download-modal__credential-warning"
            role="alert"
          >
            <AlertIcon size={18} />
            <div>
              <strong>TorBox needs to be connected</strong>
              <span>
                Open Integrations, paste your TorBox API token, and save it.
                GameHub will then check the cache and prepare this download.
              </span>
            </div>
            <Button
              type="button"
              theme="outline"
              onClick={handleOpenTorBoxSettings}
            >
              Open Integrations
            </Button>
          </div>
        )}

        {error && (
          <p className="custom-download-modal__error" role="alert">
            {error}
          </p>
        )}

        <div className="custom-download-modal__notice">
          <LinkIcon size={16} />
          <span>
            Cached items start immediately. Uncached items stay in Preparing
            while TorBox fetches them. Portable games are linked automatically;
            installer-based repacks remain ready to install from your library.
          </span>
        </div>

        <div className="custom-download-modal__actions">
          <Button
            type="button"
            theme="outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !canSubmit}>
            {submitting ? (
              <SyncIcon className="custom-download-modal__spinner" />
            ) : (
              <DownloadIcon size={16} />
            )}
            {submitting ? "Submitting to TorBox…" : "Start download"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
