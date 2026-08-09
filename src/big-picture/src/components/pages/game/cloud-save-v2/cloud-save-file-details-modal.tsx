import {
  ArrowClockwiseIcon,
  CloudIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { formatBytes, formatLocalPathForDisplay } from "@shared";
import type { CloudSaveV2FileDetails } from "@types";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  FileExplorerModal,
  HorizontalFocusGroup,
  Modal,
  VerticalFocusGroup,
} from "../../../common";
import { ConfirmationModal } from "../../../modals";

const DETAILS_REGION_ID = "big-picture-cloud-save-details";
const DETAILS_REFRESH_ID = "big-picture-cloud-save-details-refresh";

interface BigPictureCloudSaveFileDetailsModalProps {
  visible: boolean;
  details: CloudSaveV2FileDetails | null;
  isLoading: boolean;
  hasError: boolean;
  isBusy: boolean;
  isGameRunning: boolean;
  onRetry: () => Promise<void> | void;
  onAddCustomPath: (path: string) => Promise<void>;
  onRemoveCustomPath: (rawPath: string) => Promise<void>;
  onRebindCustomPath: (rawPath: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

export function BigPictureCloudSaveFileDetailsModal({
  visible,
  details,
  isLoading,
  hasError,
  isBusy,
  isGameRunning,
  onRetry,
  onAddCustomPath,
  onRemoveCustomPath,
  onRebindCustomPath,
  onDelete,
  onClose,
}: Readonly<BigPictureCloudSaveFileDetailsModalProps>) {
  const { t } = useTranslation("game_details");
  const [isExplorerVisible, setIsExplorerVisible] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [deleteConfirmationVisible, setDeleteConfirmationVisible] =
    useState(false);

  useEffect(() => {
    if (visible) return;
    setIsExplorerVisible(false);
    setPendingRemoval(null);
    setDeleteConfirmationVisible(false);
  }, [visible]);

  const files = useMemo(() => {
    if (!details) return [];
    if (details.comparisons.length > 0) {
      return details.comparisons.map((comparison) => ({
        key: `${comparison.variantId}:${comparison.rawPath}:${comparison.relativePath}`,
        name:
          (comparison.local?.absolutePath
            ? formatLocalPathForDisplay(comparison.local.absolutePath)
            : null) ??
          comparison.remote?.relativePath ??
          comparison.relativePath,
        size: comparison.local?.sizeBytes ?? comparison.remote?.sizeBytes ?? 0,
        status: comparison.status,
      }));
    }

    return details.local.files.map((file) => ({
      key: `${file.variantId}:${file.rawPath}:${file.relativePath}`,
      name: formatLocalPathForDisplay(file.absolutePath),
      size: file.sizeBytes,
      status: "local-only" as const,
    }));
  }, [details]);

  const actionsDisabled = isBusy || isLoading || isGameRunning;

  return (
    <>
      <Modal
        visible={visible}
        title={t("cloud_save_v2_files_modal_title")}
        description={t("cloud_save_v2_files_modal_description")}
        onClose={onClose}
        closeOnBackdrop={!isBusy}
        closeOnEscape={!isBusy}
        closeOnB={!isBusy}
        initialFocusId={DETAILS_REFRESH_ID}
        className="big-picture-cloud-save-details-modal"
        noAnimation
      >
        <VerticalFocusGroup
          regionId={DETAILS_REGION_ID}
          className="big-picture-cloud-save-details"
          autoScrollMode="item"
        >
          <HorizontalFocusGroup className="big-picture-cloud-save-details__toolbar">
            <Button
              focusId={DETAILS_REFRESH_ID}
              variant="secondary"
              icon={<ArrowClockwiseIcon size={21} />}
              loading={isLoading}
              disabled={isBusy}
              onClick={() => void onRetry()}
            >
              {t("cloud_save_v2_files_retry")}
            </Button>
            <Button
              variant="secondary"
              icon={<PlusIcon size={21} />}
              disabled={actionsDisabled}
              onClick={() => setIsExplorerVisible(true)}
            >
              {t("cloud_save_v2_add_custom_path")}
            </Button>
            <Button
              variant="danger"
              icon={<TrashIcon size={21} />}
              disabled={actionsDisabled || details === null}
              onClick={() => setDeleteConfirmationVisible(true)}
            >
              {t("cloud_save_v2_delete")}
            </Button>
          </HorizontalFocusGroup>

          {isGameRunning ? (
            <p className="big-picture-cloud-save__notice">
              {t("cloud_save_v2_close_game_before_manual_sync")}
            </p>
          ) : null}

          {hasError ? (
            <div className="big-picture-cloud-save-details__error" role="alert">
              <WarningCircleIcon size={20} />
              <span>{t("cloud_save_v2_files_error")}</span>
            </div>
          ) : null}

          {details ? (
            <>
              <section className="big-picture-cloud-save-details__summary">
                <div>
                  <strong>{t("cloud_save_v2_local_files")}</strong>
                  <span>
                    {t("cloud_save_v2_source_summary", {
                      count: details.local.fileCount,
                      size: formatBytes(details.local.totalSizeBytes),
                    })}
                  </span>
                </div>
                <div>
                  <CloudIcon size={22} />
                  <strong>{t("cloud_save_v2_remote_files")}</strong>
                  <span>
                    {details.activeSnapshot
                      ? t("cloud_save_v2_source_summary", {
                          count: details.activeSnapshot.fileCount,
                          size: formatBytes(
                            details.activeSnapshot.totalSizeBytes
                          ),
                        })
                      : t("cloud_save_v2_not_created")}
                  </span>
                </div>
              </section>

              <section className="big-picture-cloud-save-details__section">
                <h3>{t("cloud_save_v2_custom_paths_title")}</h3>
                {details.customPaths.map((customPath) => (
                  <HorizontalFocusGroup
                    key={customPath.rawPath}
                    className="big-picture-cloud-save-details__path-row"
                  >
                    <div className="big-picture-cloud-save-details__path-copy">
                      <strong>
                        {formatLocalPathForDisplay(customPath.path)}
                      </strong>
                      <span>{customPath.rawPath}</span>
                    </div>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={actionsDisabled}
                      onClick={() =>
                        void onRebindCustomPath(customPath.rawPath)
                      }
                    >
                      {t("cloud_save_v2_rebind_custom_path")}
                    </Button>
                    <Button
                      variant="danger"
                      size="small"
                      disabled={actionsDisabled}
                      onClick={() => setPendingRemoval(customPath.rawPath)}
                    >
                      {t("cloud_save_v2_remove")}
                    </Button>
                  </HorizontalFocusGroup>
                ))}
                {details.unresolvedCustomPaths.map((customPath) => (
                  <HorizontalFocusGroup
                    key={`unresolved:${customPath.rawPath}`}
                    className="big-picture-cloud-save-details__path-row big-picture-cloud-save-details__path-row--warning"
                  >
                    <div className="big-picture-cloud-save-details__path-copy">
                      <strong>
                        {(customPath.pathHint
                          ? formatLocalPathForDisplay(customPath.pathHint)
                          : null) ||
                          t("cloud_save_v2_unresolved_custom_path_name")}
                      </strong>
                      <span>
                        {t(
                          `cloud_save_v2_custom_path_reason_${customPath.reason}`
                        )}
                      </span>
                    </div>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={actionsDisabled}
                      onClick={() =>
                        void onRebindCustomPath(customPath.rawPath)
                      }
                    >
                      {t("cloud_save_v2_choose_location")}
                    </Button>
                  </HorizontalFocusGroup>
                ))}
                {details.customPaths.length === 0 &&
                details.unresolvedCustomPaths.length === 0 ? (
                  <p>{t("cloud_save_v2_no_custom_paths")}</p>
                ) : null}
              </section>

              {details.variants.length > 0 ? (
                <section className="big-picture-cloud-save-details__section">
                  <h3>{t("cloud_save_v2_variants_title")}</h3>
                  <div className="big-picture-cloud-save-details__variants">
                    {details.variants.map((variant) => (
                      <div key={variant.variantId}>
                        <strong>{variant.userLabel}</strong>
                        <span>
                          {t("cloud_save_v2_variant_file_count", {
                            count: variant.fileCount,
                          })}
                          {variant.conflictCount > 0
                            ? ` · ${t("cloud_save_v2_variant_conflict_count", {
                                count: variant.conflictCount,
                              })}`
                            : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="big-picture-cloud-save-details__section">
                <h3>
                  {details.state === "conflict"
                    ? t("cloud_save_v2_view_conflicts")
                    : t("cloud_save_v2_view_files")}
                </h3>
                <div className="big-picture-cloud-save-details__files">
                  {files.map((file) => (
                    <div
                      key={file.key}
                      className="big-picture-cloud-save-details__file"
                    >
                      <span title={file.name}>{file.name}</span>
                      <small>{formatBytes(file.size)}</small>
                      <em>
                        {t(
                          `cloud_save_v2_file_${file.status.replace("-", "_")}`
                        )}
                      </em>
                    </div>
                  ))}
                  {files.length === 0 ? (
                    <p>{t("cloud_save_v2_no_local_files_description")}</p>
                  ) : null}
                </div>
              </section>
            </>
          ) : isLoading ? (
            <p>{t("cloud_save_v2_files_loading")}</p>
          ) : null}
        </VerticalFocusGroup>
      </Modal>

      <FileExplorerModal
        visible={visible && isExplorerVisible}
        title={t("cloud_save_v2_add_custom_path")}
        selectDirectory
        onClose={() => setIsExplorerVisible(false)}
        onSelect={(path) => {
          setIsExplorerVisible(false);
          void onAddCustomPath(path);
        }}
      />

      <ConfirmationModal
        visible={pendingRemoval !== null}
        title={t("cloud_save_v2_remove_custom_path_title")}
        description={t("cloud_save_v2_remove_custom_path_description")}
        confirmLabel={t("cloud_save_v2_remove")}
        danger
        loading={isBusy}
        onClose={() => setPendingRemoval(null)}
        onConfirm={async () => {
          if (!pendingRemoval) return;
          await onRemoveCustomPath(pendingRemoval);
          setPendingRemoval(null);
        }}
      />

      <ConfirmationModal
        visible={deleteConfirmationVisible}
        title={t("cloud_save_v2_delete_title")}
        description={t("cloud_save_v2_delete_description")}
        confirmLabel={t("cloud_save_v2_delete_confirm")}
        danger
        loading={isBusy}
        onClose={() => setDeleteConfirmationVisible(false)}
        onConfirm={async () => {
          await onDelete();
          setDeleteConfirmationVisible(false);
        }}
      />
    </>
  );
}
