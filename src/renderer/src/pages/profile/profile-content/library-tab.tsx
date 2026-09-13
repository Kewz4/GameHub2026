import { useTranslation } from "react-i18next";
import { TelescopeIcon } from "@primer/octicons-react";
import InfiniteScroll from "react-infinite-scroll-component";
import { useFormat } from "@renderer/hooks";
import type { UserGame } from "@types";
import { SortOptions } from "./sort-options";
import { UserLibraryGameCard } from "./user-library-game-card";
import type { ProfileGameSort } from "./profile-library-data";
import "./profile-content.scss";

interface LibraryTabProps {
  sortBy: ProfileGameSort;
  onSortChange: (sortBy: ProfileGameSort) => void;
  pinnedGames: UserGame[];
  libraryGames: UserGame[];
  hasMoreLibraryGames: boolean;
  statsIndex: number;
  userStats: { libraryCount: number } | null;
  onLoadMore: () => void;
  isMe: boolean;
  localLibraryCount?: number | null;
}

export function LibraryTab({
  sortBy,
  onSortChange,
  pinnedGames,
  libraryGames,
  hasMoreLibraryGames,
  statsIndex,
  userStats,
  onLoadMore,
  isMe,
  localLibraryCount,
}: Readonly<LibraryTabProps>) {
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();

  const hasGames = libraryGames.length > 0;
  const hasPinnedGames = pinnedGames.length > 0;
  const hasAnyGames = hasGames || hasPinnedGames;

  return (
    <div
      key="library"
      className="profile-content__tab-panel"
      aria-hidden={false}
    >
      {hasAnyGames && (
        <SortOptions sortBy={sortBy} onSortChange={onSortChange} />
      )}

      {!hasAnyGames && (
        <div className="profile-content__no-games">
          <div className="profile-content__telescope-icon">
            <TelescopeIcon size={24} />
          </div>
          <h2>{t("no_recent_activity_title")}</h2>
          {isMe && <p>{t("no_recent_activity_description")}</p>}
        </div>
      )}

      {hasAnyGames && (
        <div>
          {hasPinnedGames && (
            <div style={{ marginBottom: "2rem" }}>
              <div className="profile-content__section-header">
                <div className="profile-content__section-title-group">
                  <h2>{t("pinned")}</h2>
                  <span className="profile-content__section-badge">
                    {pinnedGames.length}
                  </span>
                </div>
              </div>

              <ul className="profile-content__games-grid">
                {pinnedGames?.map((game) => (
                  <UserLibraryGameCard
                    key={`${game.shop}:${game.objectId}`}
                    game={game}
                    statIndex={statsIndex}
                    sortBy={sortBy}
                  />
                ))}
              </ul>
            </div>
          )}

          {hasGames && (
            <div>
              <div className="profile-content__section-header">
                <div className="profile-content__section-title-group">
                  <h2>{t("library")}</h2>
                  {(localLibraryCount != null || userStats) && (
                    <span className="profile-content__section-badge">
                      {numberFormatter.format(
                        localLibraryCount ?? userStats!.libraryCount
                      )}
                    </span>
                  )}
                </div>
              </div>

              <InfiniteScroll
                dataLength={libraryGames.length}
                next={onLoadMore}
                hasMore={hasMoreLibraryGames}
                loader={null}
                scrollThreshold={0.9}
                style={{ overflow: "visible" }}
                scrollableTarget="scrollableDiv"
              >
                <ul className="profile-content__games-grid">
                  {libraryGames?.map((game) => {
                    return (
                      <UserLibraryGameCard
                        key={`${sortBy}-${game.shop}:${game.objectId}`}
                        game={game}
                        statIndex={statsIndex}
                        sortBy={sortBy}
                      />
                    );
                  })}
                </ul>
              </InfiniteScroll>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
