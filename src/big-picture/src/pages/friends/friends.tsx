import "./styles.scss";

import { UsersIcon, GameControllerIcon } from "@phosphor-icons/react";
import type {
  FriendRequest,
  FriendRequestAction,
  ProfileFriends,
  UserFriend,
} from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Typography,
  VerticalFocusGroup,
  HorizontalFocusGroup,
} from "../../components";
import { IS_DESKTOP } from "../../constants";
import {
  useBigPictureToast,
  useHeaderTitle,
  useNavigationScreenActions,
} from "../../hooks";
import {
  FRIENDS_LIST_REGION_ID,
  FRIENDS_PAGE_REGION_ID,
  FRIENDS_REQUESTS_REGION_ID,
  getFriendFocusId,
  getFriendRequestAcceptFocusId,
  getFriendRequestCancelFocusId,
  getFriendRequestRefuseFocusId,
} from "./navigation";

const PAGE_SIZE = 50;

export default function Friends() {
  const navigate = useNavigate();
  const { showErrorToast } = useBigPictureToast();

  const [friends, setFriends] = useState<UserFriend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const basePath = IS_DESKTOP ? "/big-picture" : "";

  const loadFriends = useCallback(async () => {
    if (!IS_DESKTOP) return;
    try {
      const response =
        await globalThis.window.electron.hydraApi.get<ProfileFriends>(
          "/profile/friends",
          { params: { take: PAGE_SIZE, skip: 0 } }
        );
      setFriends(response.friends ?? []);
    } catch {
      // transient error — keep previous list
    }
  }, []);

  const loadRequests = useCallback(async () => {
    if (!IS_DESKTOP) return;
    try {
      const response = await globalThis.window.electron.hydraApi.get<
        FriendRequest[]
      >("/profile/friend-requests");
      setRequests(Array.isArray(response) ? response : []);
    } catch {
      // transient error — keep previous list
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadFriends(), loadRequests()]);
    setLoading(false);
  }, [loadFriends, loadRequests]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    const unsubscribeFriends = globalThis.window.electron.onFriendsUpdated(
      () => {
        void loadFriends();
      }
    );
    const unsubscribeRequests = globalThis.window.electron.onSyncFriendRequests(
      () => {
        void loadRequests();
      }
    );
    const unsubscribePresence = globalThis.window.electron.onFriendPresence(
      (presence) => {
        setFriends((prev) =>
          prev.map((friend) =>
            friend.id === presence.friendId
              ? { ...friend, isOnline: presence.isOnline }
              : friend
          )
        );
      }
    );

    return () => {
      unsubscribeFriends();
      unsubscribeRequests();
      unsubscribePresence();
    };
  }, [loadFriends, loadRequests]);

  useHeaderTitle("Friends");

  useNavigationScreenActions({
    press: {
      b: () => {
        navigate(-1);
      },
    },
  });

  const handleRequestAction = useCallback(
    async (userId: string, action: FriendRequestAction) => {
      setPendingId(userId);
      try {
        await globalThis.window.electron.updateFriendRequest(userId, action);
        await Promise.all([loadRequests(), loadFriends()]);
      } catch {
        showErrorToast("Failed to update friend request");
      } finally {
        setPendingId(null);
      }
    },
    [loadRequests, loadFriends, showErrorToast]
  );

  const receivedRequests = useMemo(
    () => requests.filter((request) => request.type === "RECEIVED"),
    [requests]
  );
  const sentRequests = useMemo(
    () => requests.filter((request) => request.type === "SENT"),
    [requests]
  );

  const sortedFriends = useMemo(
    () => [...friends].sort((a, b) => Number(b.isOnline) - Number(a.isOnline)),
    [friends]
  );

  if (!IS_DESKTOP) {
    return (
      <VerticalFocusGroup regionId={FRIENDS_PAGE_REGION_ID} asChild>
        <div className="bp-friends">
          <Typography className="bp-friends__status">
            Friends are only available in the desktop app.
          </Typography>
        </div>
      </VerticalFocusGroup>
    );
  }

  return (
    <VerticalFocusGroup regionId={FRIENDS_PAGE_REGION_ID} asChild>
      <section className="bp-friends">
        <header className="bp-friends__header">
          <UsersIcon size={32} />
          <Typography className="bp-friends__title">Friends</Typography>
        </header>

        {loading && friends.length === 0 && requests.length === 0 ? (
          <Typography className="bp-friends__status">
            Loading friends…
          </Typography>
        ) : (
          <>
            {receivedRequests.length + sentRequests.length > 0 && (
              <section className="bp-friends__section">
                <Typography className="bp-friends__section__title">
                  Requests
                </Typography>

                <VerticalFocusGroup
                  regionId={FRIENDS_REQUESTS_REGION_ID}
                  asChild
                >
                  <ul className="bp-friends__list">
                    {receivedRequests.map((request) => (
                      <li key={request.id} className="bp-friends__item">
                        <FriendAvatar
                          src={request.profileImageUrl}
                          name={request.displayName}
                        />
                        <div className="bp-friends__item__info">
                          <Typography className="bp-friends__item__name">
                            {request.displayName}
                          </Typography>
                          <Typography className="bp-friends__item__meta">
                            Wants to be your friend
                          </Typography>
                        </div>
                        <HorizontalFocusGroup asChild>
                          <div className="bp-friends__item__actions">
                            <Button
                              focusId={getFriendRequestAcceptFocusId(
                                request.id
                              )}
                              variant="primary"
                              disabled={pendingId !== null}
                              loading={pendingId === request.id}
                              onClick={() =>
                                void handleRequestAction(request.id, "ACCEPTED")
                              }
                            >
                              Accept
                            </Button>
                            <Button
                              focusId={getFriendRequestRefuseFocusId(
                                request.id
                              )}
                              variant="secondary"
                              disabled={pendingId !== null}
                              onClick={() =>
                                void handleRequestAction(request.id, "REFUSED")
                              }
                            >
                              Ignore
                            </Button>
                          </div>
                        </HorizontalFocusGroup>
                      </li>
                    ))}

                    {sentRequests.map((request) => (
                      <li key={request.id} className="bp-friends__item">
                        <FriendAvatar
                          src={request.profileImageUrl}
                          name={request.displayName}
                        />
                        <div className="bp-friends__item__info">
                          <Typography className="bp-friends__item__name">
                            {request.displayName}
                          </Typography>
                          <Typography className="bp-friends__item__meta">
                            Request sent
                          </Typography>
                        </div>
                        <HorizontalFocusGroup asChild>
                          <div className="bp-friends__item__actions">
                            <Button
                              focusId={getFriendRequestCancelFocusId(
                                request.id
                              )}
                              variant="secondary"
                              disabled={pendingId !== null}
                              loading={pendingId === request.id}
                              onClick={() =>
                                void handleRequestAction(request.id, "CANCEL")
                              }
                            >
                              Cancel
                            </Button>
                          </div>
                        </HorizontalFocusGroup>
                      </li>
                    ))}
                  </ul>
                </VerticalFocusGroup>
              </section>
            )}

            <section className="bp-friends__section">
              <Typography className="bp-friends__section__title">
                All friends
              </Typography>

              {sortedFriends.length === 0 ? (
                <Typography className="bp-friends__status">
                  You haven&apos;t added any friends yet.
                </Typography>
              ) : (
                <VerticalFocusGroup regionId={FRIENDS_LIST_REGION_ID} asChild>
                  <ul className="bp-friends__list">
                    {sortedFriends.map((friend) => (
                      <li key={friend.id} className="bp-friends__item">
                        <Button
                          focusId={getFriendFocusId(friend.id)}
                          variant="tertiary"
                          className="bp-friends__friend-button"
                          onClick={() =>
                            navigate(`${basePath}/profile/${friend.id}`)
                          }
                        >
                          <span className="bp-friends__friend-button__inner">
                            <FriendAvatar
                              src={friend.profileImageUrl}
                              name={friend.displayName}
                              online={friend.isOnline}
                            />
                            <span className="bp-friends__item__info">
                              <span className="bp-friends__item__name">
                                {friend.displayName}
                              </span>
                              <span className="bp-friends__item__meta">
                                {friend.currentGame ? (
                                  <>
                                    <GameControllerIcon size={14} />
                                    {friend.currentGame.title}
                                  </>
                                ) : friend.isOnline ? (
                                  "Online"
                                ) : (
                                  "Offline"
                                )}
                              </span>
                            </span>
                          </span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </VerticalFocusGroup>
              )}
            </section>
          </>
        )}
      </section>
    </VerticalFocusGroup>
  );
}

interface FriendAvatarProps {
  src: string | null;
  name: string;
  online?: boolean;
}

function FriendAvatar({ src, name, online }: Readonly<FriendAvatarProps>) {
  return (
    <span className="bp-friends__avatar">
      {src ? (
        <img
          src={src}
          alt={name}
          className="bp-friends__avatar__image"
          draggable={false}
        />
      ) : (
        <span className="bp-friends__avatar__image bp-friends__avatar__image--placeholder">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      {online !== undefined && (
        <span
          className={`bp-friends__avatar__presence${
            online ? " bp-friends__avatar__presence--online" : ""
          }`}
        />
      )}
    </span>
  );
}
