import { useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import type { LudusaviBackup, GameArtifact, GameShop } from "@types";
import React, {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  CloudSyncOperationGuard,
  getCloudSyncGameKey,
} from "./cloud-sync-operation-guard";

export enum CloudSyncState {
  New,
  Different,
  Same,
  Unknown,
}

export interface CloudSyncContext {
  backupPreview: LudusaviBackup | null;
  artifacts: GameArtifact[];
  showCloudSyncFilesModal: boolean;
  backupState: CloudSyncState;
  downloadGameArtifact: (gameArtifactId: string) => Promise<void>;
  uploadSaveGame: (downloadOptionTitle: string | null) => Promise<void>;
  deleteGameArtifact: (gameArtifactId: string) => Promise<void>;
  setShowCloudSyncFilesModal: React.Dispatch<React.SetStateAction<boolean>>;
  getGameBackupPreview: () => Promise<void>;
  getGameArtifacts: () => Promise<void>;
  toggleArtifactFreeze: (
    gameArtifactId: string,
    freeze: boolean
  ) => Promise<void>;
  restoringBackup: boolean;
  uploadingBackup: boolean;
  loadingPreview: boolean;
  freezingArtifact: boolean;
}

export const cloudSyncContext = createContext<CloudSyncContext>({
  backupPreview: null,
  backupState: CloudSyncState.Unknown,
  downloadGameArtifact: async () => {},
  uploadSaveGame: async () => {},
  artifacts: [],
  deleteGameArtifact: async () => {},
  showCloudSyncFilesModal: false,
  setShowCloudSyncFilesModal: () => {},
  getGameBackupPreview: async () => {},
  toggleArtifactFreeze: async () => {},
  getGameArtifacts: async () => {},
  restoringBackup: false,
  uploadingBackup: false,
  loadingPreview: false,
  freezingArtifact: false,
});

const { Provider } = cloudSyncContext;
export const { Consumer: CloudSyncContextConsumer } = cloudSyncContext;

export interface CloudSyncContextProviderProps {
  children: React.ReactNode;
  objectId: string;
  shop: GameShop;
}

export function CloudSyncContextProvider({
  children,
  objectId,
  shop,
}: CloudSyncContextProviderProps) {
  const { t } = useTranslation("game_details");

  const [artifacts, setArtifacts] = useState<GameArtifact[]>([]);
  const [backupPreview, setBackupPreview] = useState<LudusaviBackup | null>(
    null
  );
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [uploadingBackup, setUploadingBackup] = useState(false);
  const [showCloudSyncFilesModal, setShowCloudSyncFilesModal] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [freezingArtifact] = useState(false);

  const gameKey = getCloudSyncGameKey(shop, objectId);
  const operationGuardRef = useRef<CloudSyncOperationGuard | null>(null);
  if (!operationGuardRef.current) {
    operationGuardRef.current = new CloudSyncOperationGuard(gameKey);
  }
  const operationGuard = operationGuardRef.current;

  const { showSuccessToast, showErrorToast } = useToast();

  const downloadGameArtifact = useCallback(
    async (gameArtifactId: string) => {
      const operation = operationGuard.begin("download");
      setRestoringBackup(true);

      window.electron
        .downloadGameArtifact(objectId, shop, gameArtifactId)
        .catch((err) => {
          if (!operationGuard.isOperationCurrent(operation)) return;

          setRestoringBackup(false);
          logger.error("Failed to restore game backup", {
            objectId,
            shop,
            err,
          });
          showErrorToast(t("backup_download_failed"));
        });
    },
    [objectId, operationGuard, shop, showErrorToast, t]
  );

  const getGameArtifacts = useCallback(async () => {
    const operation = operationGuard.begin("artifacts");
    const results = await window.electron
      .getGameArtifacts(objectId, shop)
      .catch(() => [] as GameArtifact[]);

    if (!operationGuard.isOperationCurrent(operation)) return;
    setArtifacts(results);
  }, [objectId, operationGuard, shop]);

  const getGameBackupPreview = useCallback(async () => {
    const operation = operationGuard.begin("preview");
    setLoadingPreview(true);

    try {
      const preview = await window.electron.getGameBackupPreview(
        objectId,
        shop
      );

      if (operationGuard.isOperationCurrent(operation)) {
        setBackupPreview(preview);
      }
    } catch (err) {
      if (operationGuard.isOperationCurrent(operation)) {
        logger.error("Failed to get game backup preview", objectId, shop, err);
      }
    } finally {
      if (operationGuard.isOperationCurrent(operation)) {
        setLoadingPreview(false);
      }
    }
  }, [objectId, operationGuard, shop]);

  const uploadSaveGame = useCallback(
    async (downloadOptionTitle: string | null) => {
      const operation = operationGuard.begin("upload");
      setUploadingBackup(true);
      window.electron
        .uploadSaveGame(objectId, shop, downloadOptionTitle)
        .catch((err) => {
          if (!operationGuard.isOperationCurrent(operation)) return;

          setUploadingBackup(false);
          logger.error("Failed to upload save game", { objectId, shop, err });
          showErrorToast(t("backup_failed"));
        });
    },
    [objectId, operationGuard, shop, t, showErrorToast]
  );

  const toggleArtifactFreeze = useCallback(
    async (_gameArtifactId: string, _freeze: boolean) => {
      // Freeze is not supported with Uploadcare storage
    },
    []
  );

  useEffect(() => {
    const game = operationGuard.captureGame();
    const removeUploadCompleteListener = window.electron.onUploadComplete(
      objectId,
      shop,
      () => {
        if (!operationGuard.isGameCurrent(game)) return;

        showSuccessToast(t("backup_uploaded"));
        setUploadingBackup(false);
        getGameArtifacts();
        getGameBackupPreview();
      }
    );

    const removeDownloadCompleteListener =
      window.electron.onBackupDownloadComplete(objectId, shop, (success) => {
        if (!operationGuard.isGameCurrent(game)) return;

        if (success) {
          showSuccessToast(t("backup_restored"));
        } else {
          showErrorToast(t("backup_download_failed"));
        }
        setRestoringBackup(false);
        getGameArtifacts();
        getGameBackupPreview();
      });

    return () => {
      removeUploadCompleteListener();
      removeDownloadCompleteListener();
    };
  }, [
    objectId,
    shop,
    showSuccessToast,
    t,
    getGameBackupPreview,
    getGameArtifacts,
    operationGuard,
  ]);

  const deleteGameArtifact = useCallback(
    async (gameArtifactId: string) => {
      const operation = operationGuard.begin("delete");
      await window.electron.deleteGameArtifact(gameArtifactId);

      if (!operationGuard.isOperationCurrent(operation)) return;
      getGameBackupPreview();
      getGameArtifacts();
    },
    [getGameBackupPreview, getGameArtifacts, operationGuard]
  );

  useLayoutEffect(() => {
    operationGuard.activateGame(gameKey);
    setBackupPreview(null);
    setArtifacts([]);
    setRestoringBackup(false);
    setUploadingBackup(false);
    setLoadingPreview(false);

    return () => operationGuard.invalidateGame(gameKey);
  }, [gameKey, operationGuard]);

  const backupState = useMemo(() => {
    if (!backupPreview) return CloudSyncState.Unknown;
    if (backupPreview.overall.changedGames.new) return CloudSyncState.New;
    if (backupPreview.overall.changedGames.different)
      return CloudSyncState.Different;
    if (backupPreview.overall.changedGames.same) return CloudSyncState.Same;

    return CloudSyncState.Unknown;
  }, [backupPreview]);

  return (
    <Provider
      value={{
        backupPreview,
        artifacts,
        backupState,
        restoringBackup,
        uploadingBackup,
        showCloudSyncFilesModal,
        loadingPreview,
        freezingArtifact,
        uploadSaveGame,
        downloadGameArtifact,
        deleteGameArtifact,
        setShowCloudSyncFilesModal,
        getGameBackupPreview,
        getGameArtifacts,
        toggleArtifactFreeze,
      }}
    >
      {children}
    </Provider>
  );
}
