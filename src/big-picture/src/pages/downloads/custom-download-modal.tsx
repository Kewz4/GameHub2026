import { useEffect, useRef, useState } from "react";
import {
  DownloadSimpleIcon,
  FileArrowUpIcon,
  FolderOpenIcon,
  LinkSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import {
  classifyCustomDownloadSource,
  normalizeCustomDownloadTitle,
  suggestCustomDownloadTitle,
} from "@shared";
import {
  Button,
  Checkbox,
  FileExplorerModal,
  Input,
  Modal,
  Typography,
  VerticalFocusGroup,
} from "../../components";
import { useBigPictureToast, useUserPreferences } from "../../hooks";

import "./custom-download-modal.scss";

interface CustomDownloadModalProps {
  visible: boolean;
  onClose: () => void;
}

const SOURCE_INPUT_ID = "custom-download-source";
const TITLE_INPUT_ID = "custom-download-title";
const ATTACH_BUTTON_ID = "custom-download-attach";
const BROWSE_BUTTON_ID = "custom-download-browse";
const EXTRACT_CHECKBOX_ID = "custom-download-extract";
const DELETE_CHECKBOX_ID = "custom-download-delete";
const SUBMIT_BUTTON_ID = "custom-download-submit";
const TORBOX_SETTINGS_BUTTON_ID = "custom-download-torbox-settings";

type ExplorerMode = "torrent" | "directory" | null;

function fileNameFromPath(filePath: string) {
  return filePath.split(/[\\/]/).at(-1) ?? filePath;
}

export function BigPictureCustomDownloadModal({
  visible,
  onClose,
}: Readonly<CustomDownloadModalProps>) {
  const userPreferences = useUserPreferences();
  const navigate = useNavigate();
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const titleTouchedRef = useRef(false);
  const [source, setSource] = useState("");
  const [localTorrentPath, setLocalTorrentPath] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [downloadPath, setDownloadPath] = useState("");
  const [automaticallyExtract, setAutomaticallyExtract] = useState(true);
  const [deleteArchives, setDeleteArchives] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [explorerMode, setExplorerMode] = useState<ExplorerMode>(null);
  const hasTorBoxToken = Boolean(userPreferences?.torBoxApiToken?.trim());

  useEffect(() => {
    if (!visible) return;

    titleTouchedRef.current = false;
    setSource("");
    setLocalTorrentPath(null);
    setTitle("");
    setError(null);
    setSubmitting(false);
    setExplorerMode(null);
    setAutomaticallyExtract(userPreferences?.extractFilesByDefault ?? true);
    setDeleteArchives(
      userPreferences?.deleteArchiveFilesAfterExtractionByDefault ?? false
    );

    let cancelled = false;
    void globalThis.window.electron
      .getDefaultDownloadsPath()
      .then((defaultPath) => {
        if (!cancelled) {
          setDownloadPath(userPreferences?.downloadsPath ?? defaultPath);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userPreferences, visible]);

  const updateSuggestedTitle = (
    nextSource: string,
    attachedFileName?: string | null
  ) => {
    if (titleTouchedRef.current) return;
    const suggestion = suggestCustomDownloadTitle(nextSource, attachedFileName);
    if (suggestion) setTitle(suggestion);
  };

  const handleTorrentSelected = (filePath: string) => {
    setLocalTorrentPath(filePath);
    setSource("");
    setError(null);
    setExplorerMode(null);
    updateSuggestedTitle("", fileNameFromPath(filePath));
  };

  const handleDownloadPathSelected = (folderPath: string) => {
    setDownloadPath(folderPath);
    setExplorerMode(null);
  };

  const handleSubmit = async () => {
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
      const result = await globalThis.window.electron.startCustomDownload({
        title,
        source,
        localTorrentPath,
        downloadPath,
        automaticallyExtract,
        automaticallyDeleteArchiveFiles: deleteArchives,
      });
      if (!result.ok) {
        throw new Error(result.error ?? "GameHub could not start the download");
      }

      showSuccessToast(
        result.queued ? "Added to download queue" : "Download started",
        {
          fallbackVisual: "downloads",
          message: `${title.trim()} will be added to your library.`,
        }
      );
      onClose();
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "GameHub could not start the download";
      setError(message);
      showErrorToast("Custom download failed", {
        fallbackVisual: "downloads",
        message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const attachedFileName = localTorrentPath
    ? fileNameFromPath(localTorrentPath)
    : null;

  const handleOpenTorBoxSettings = () => {
    onClose();
    navigate("/settings?tab=integrations");
  };

  return (
    <>
      <Modal
        visible={visible}
        title="Add a custom download"
        description="Paste a direct link or magnet, or attach a .torrent. TorBox checks its cache first."
        onClose={onClose}
        closeOnBackdrop={!submitting}
        closeOnB={!submitting}
        initialFocusId={
          hasTorBoxToken ? SOURCE_INPUT_ID : TORBOX_SETTINGS_BUTTON_ID
        }
        className="bp-custom-download-modal"
      >
        <VerticalFocusGroup className="bp-custom-download-modal__form">
          <Input
            focusId={SOURCE_INPUT_ID}
            label="Download link or magnet"
            placeholder="https://… or magnet:?xt=…"
            value={source}
            disabled={submitting}
            iconLeft={<LinkSimpleIcon size={20} />}
            onChange={(event) => {
              const value = event.target.value;
              setSource(value);
              setLocalTorrentPath(null);
              setError(null);
              updateSuggestedTitle(value);
            }}
          />

          <Button
            focusId={ATTACH_BUTTON_ID}
            variant="secondary"
            icon={<FileArrowUpIcon size={20} />}
            onClick={() => setExplorerMode("torrent")}
            disabled={submitting}
          >
            {attachedFileName ?? "Attach .torrent file"}
          </Button>

          <Input
            focusId={TITLE_INPUT_ID}
            label="Game name"
            placeholder="Name shown in your library"
            value={title}
            disabled={submitting}
            onChange={(event) => {
              titleTouchedRef.current = true;
              setTitle(event.target.value);
              setError(null);
            }}
          />

          <div className="bp-custom-download-modal__directory">
            <div>
              <Typography variant="label">Download folder</Typography>
              <Typography className="bp-custom-download-modal__path">
                {downloadPath || "Choose a folder"}
              </Typography>
            </div>
            <Button
              focusId={BROWSE_BUTTON_ID}
              variant="secondary"
              icon={<FolderOpenIcon size={20} />}
              onClick={() => setExplorerMode("directory")}
              disabled={submitting}
            >
              Browse
            </Button>
          </div>

          <Checkbox
            block
            focusId={EXTRACT_CHECKBOX_ID}
            label="Automatically extract archives"
            secondaryText="Portable games can be linked to Play automatically after extraction."
            checked={automaticallyExtract}
            disabled={submitting}
            onChange={setAutomaticallyExtract}
          />

          {!hasTorBoxToken && (
            <div className="bp-custom-download-modal__credential-warning">
              <WarningCircleIcon size={24} weight="fill" />
              <div>
                <Typography variant="label">
                  TorBox needs to be connected
                </Typography>
                <Typography>
                  Open Integrations, paste your TorBox API token, and save it
                  before submitting a custom download.
                </Typography>
              </div>
              <Button
                focusId={TORBOX_SETTINGS_BUTTON_ID}
                variant="secondary"
                onClick={handleOpenTorBoxSettings}
              >
                Open Integrations
              </Button>
            </div>
          )}
          <Checkbox
            block
            focusId={DELETE_CHECKBOX_ID}
            label="Delete archives after extraction"
            checked={deleteArchives}
            disabled={submitting || !automaticallyExtract}
            onChange={setDeleteArchives}
          />

          {error ? (
            <Typography className="bp-custom-download-modal__error">
              {error}
            </Typography>
          ) : (
            <Typography className="bp-custom-download-modal__hint">
              Cached items start immediately. Uncached items show Preparing
              while TorBox fetches them.
            </Typography>
          )}

          <Button
            focusId={SUBMIT_BUTTON_ID}
            icon={<DownloadSimpleIcon size={20} />}
            loading={submitting}
            onClick={handleSubmit}
            disabled={submitting || !hasTorBoxToken}
          >
            {submitting ? "Submitting to TorBox…" : "Start download"}
          </Button>
        </VerticalFocusGroup>
      </Modal>

      <FileExplorerModal
        visible={visible && explorerMode === "torrent"}
        title="Attach a torrent file"
        initialPath={localTorrentPath ?? (downloadPath || undefined)}
        filters={[{ name: "Torrent files", extensions: ["torrent"] }]}
        onClose={() => setExplorerMode(null)}
        onSelect={handleTorrentSelected}
      />

      <FileExplorerModal
        visible={visible && explorerMode === "directory"}
        title="Choose download folder"
        initialPath={downloadPath || undefined}
        selectDirectory
        onClose={() => setExplorerMode(null)}
        onSelect={handleDownloadPathSelected}
      />
    </>
  );
}
