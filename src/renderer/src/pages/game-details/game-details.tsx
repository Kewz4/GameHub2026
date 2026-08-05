import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import type { GameRepack, GameShop, Steam250Game } from "@types";

import { Button, ConfirmationModal } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";

import starsIconAnimated from "@renderer/assets/icons/stars-animated.gif";

import { useTranslation } from "react-i18next";
import { SkeletonTheme } from "react-loading-skeleton";
import { GameDetailsSkeleton } from "./game-details-skeleton";

import { GameDetailsContent } from "./game-details-content";
import {
  CloudSyncContextConsumer,
  CloudSyncContextProvider,
  GameDetailsContextConsumer,
  GameDetailsContextProvider,
} from "@renderer/context";
import { useDownload } from "@renderer/hooks";
import { GameOptionsModal, RepacksModal } from "./modals";
import { Downloader, getDownloadersForUri } from "@shared";
import { CloudSyncFilesModal } from "./cloud-sync-files-modal/cloud-sync-files-modal";
import { CloudSaveV2Provider } from "./cloud-save-v2";
import "./game-details.scss";
import "./hero.scss";

export default function GameDetails() {
  const [randomGame, setRandomGame] = useState<Steam250Game | null>(null);
  const [randomizerLocked, setRandomizerLocked] = useState(false);

  const { objectId, shop } = useParams();
  const [searchParams] = useSearchParams();

  const fromRandomizer = searchParams.get("fromRandomizer");
  const gameTitle = searchParams.get("title");
  const sharedLink = searchParams.get("sharedLink") === "1";
  // Use local state so the user can actually close the modal — reading directly
  // from searchParams means the modal re-opens every render while the param is set.
  const [openRepacks, setOpenRepacks] = useState(
    searchParams.get("openRepacks") === "1"
  );

  const { startDownload, addGameToQueue } = useDownload();

  const { t } = useTranslation("game_details");

  const navigate = useNavigate();

  useEffect(() => {
    setRandomGame(null);
    window.electron.getRandomGame().then((randomGame) => {
      setRandomGame(randomGame);
    });
  }, [objectId]);

  const handleRandomizerClick = () => {
    if (randomGame) {
      navigate(
        buildGameDetailsPath(
          { ...randomGame, shop: "steam" },
          { fromRandomizer: "1" }
        )
      );

      setRandomizerLocked(true);

      const zero = performance.now();

      requestAnimationFrame(function animateLock(time) {
        if (time - zero <= 1000) {
          requestAnimationFrame(animateLock);
        } else {
          setRandomizerLocked(false);
        }
      });
    }
  };

  const selectRepackUri = (repack: GameRepack, downloader: Downloader) =>
    repack.uris.find((uri) => getDownloadersForUri(uri).includes(downloader))!;

  return (
    <GameDetailsContextProvider
      key={objectId}
      gameTitle={gameTitle!}
      shop={shop! as GameShop}
      objectId={objectId!}
      platform={searchParams.get("platform") ?? undefined}
    >
      <GameDetailsContextConsumer>
        {({
          isLoading,
          game,
          gameTitle,
          shop,
          showRepacksModal,
          showGameOptionsModal,
          gameOptionsInitialCategory,
          hasNSFWContentBlocked,
          setHasNSFWContentBlocked,
          updateGame,
          setShowRepacksModal,
          setShowGameOptionsModal,
          setGameOptionsInitialCategory, // ADD THIS
        }) => {
          const handleStartDownload = async (
            repack: GameRepack,
            downloader: Downloader,
            downloadPath: string,
            automaticallyExtract: boolean,
            addToQueueOnly = false,
            fileIndices?: number[],
            selectedFilesSize?: number | null,
            automaticallyDeleteArchiveFiles = false,
            signal?: AbortSignal
          ) => {
            const chosenUri = selectRepackUri(repack, downloader);
            // Updates/DLC download under a suffixed companion id so they never
            // clobber the base game's download record or disc binding; main
            // routes them into placement (not ROM binding) after download.
            const contentType = repack.contentType ?? "game";
            const downloadObjectId =
              contentType === "update"
                ? `${objectId}::update`
                : contentType === "dlc"
                  ? `${objectId}::dlc::${repack.title
                      .toLowerCase()
                      .replace(/[^a-z0-9]/g, "-")
                      .slice(0, 40)}`
                  : objectId!;
            // For TorBox, collect the repack's OTHER hoster mirrors so main can
            // race them and pick the fastest (magnets excluded — one torrent).
            const alternateUris =
              downloader === Downloader.TorBox
                ? repack.uris.filter(
                    (u) =>
                      u !== chosenUri &&
                      /^https?:\/\//i.test(u) &&
                      getDownloadersForUri(u).includes(Downloader.TorBox)
                  )
                : undefined;
            const payload = {
              objectId: downloadObjectId,
              title:
                contentType !== "game"
                  ? `${gameTitle} — ${repack.title}`
                  : gameTitle,
              downloader,
              shop,
              downloadPath,
              uri: chosenUri,
              automaticallyExtract,
              automaticallyDeleteArchiveFiles,
              fileSize: repack.fileSize,
              fileIndices,
              selectedFilesSize,
              targetFileName: repack.fileName ?? null,
              alternateUris:
                alternateUris && alternateUris.length > 0
                  ? alternateUris
                  : undefined,
              emulatorSystem: repack.emulatorSystem ?? null,
            };
            const response = addToQueueOnly
              ? await addGameToQueue(payload, signal)
              : await startDownload(payload, signal);

            if (response.ok) {
              await updateGame();
              setShowRepacksModal(false);
              setShowGameOptionsModal(false);
              setGameOptionsInitialCategory("general");
            }

            return response;
          };

          const handleNSFWContentRefuse = () => {
            setHasNSFWContentBlocked(false);
            navigate(-1);
          };

          return (
            <CloudSaveV2Provider objectId={objectId!} shop={shop}>
              <CloudSyncContextProvider objectId={objectId!} shop={shop}>
                <CloudSyncContextConsumer>
                  {({
                    showCloudSyncFilesModal,
                    setShowCloudSyncFilesModal,
                  }) => (
                    <>
                      <CloudSyncFilesModal
                        onClose={() => setShowCloudSyncFilesModal(false)}
                        visible={showCloudSyncFilesModal}
                      />
                    </>
                  )}
                </CloudSyncContextConsumer>

                <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
                  {isLoading ? <GameDetailsSkeleton /> : <GameDetailsContent />}

                  <RepacksModal
                    visible={showRepacksModal || openRepacks}
                    startDownload={handleStartDownload}
                    sharedLink={sharedLink}
                    onClose={() => {
                      setShowRepacksModal(false);
                      setOpenRepacks(false);
                    }}
                  />

                  <ConfirmationModal
                    visible={hasNSFWContentBlocked}
                    onClose={handleNSFWContentRefuse}
                    title={t("nsfw_content_title")}
                    descriptionText={t("nsfw_content_description", {
                      title: gameTitle,
                    })}
                    confirmButtonLabel={t("allow_nsfw_content")}
                    cancelButtonLabel={t("refuse_nsfw_content")}
                    onConfirm={() => setHasNSFWContentBlocked(false)}
                    clickOutsideToClose={false}
                  />

                  {game && (
                    <GameOptionsModal
                      visible={showGameOptionsModal}
                      game={game}
                      onClose={() => {
                        setShowGameOptionsModal(false);
                        setGameOptionsInitialCategory("general");
                      }}
                      initialCategory={gameOptionsInitialCategory}
                      onNavigateHome={() => navigate("/")}
                    />
                  )}

                  {fromRandomizer && (
                    <Button
                      className="game-details__randomizer-button"
                      onClick={handleRandomizerClick}
                      theme="outline"
                      disabled={!randomGame || randomizerLocked}
                    >
                      <div className="game-details__stars-icon-container">
                        <img
                          src={starsIconAnimated}
                          alt=""
                          className="game-details__stars-icon"
                        />
                      </div>
                      {t("next_suggestion")}
                    </Button>
                  )}
                </SkeletonTheme>
              </CloudSyncContextProvider>
            </CloudSaveV2Provider>
          );
        }}
      </GameDetailsContextConsumer>
    </GameDetailsContextProvider>
  );
}
