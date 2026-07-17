import "./styles.scss";

import { CheckIcon, CopyIcon, UsersIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ProfileFriends } from "@types";
import { IS_DESKTOP } from "../../../constants";
import { useUserDetails } from "../../../hooks";

export interface UserProfileProps {
  /** Optional overrides — when omitted, real signed-in user data is used. */
  image?: string;
  name?: string;
  friendCode?: string;
}

interface UserProfileContentProps {
  image: string;
  name: string;
  friendCode: string;
}

interface UserProfileActionsProps {
  friendsCount: number;
}

const PROFILE_ROUTE = IS_DESKTOP ? "/big-picture/profile" : "/profile";
const FRIENDS_ROUTE = IS_DESKTOP ? "/big-picture/friends" : "/friends";

function UserProfileActions({
  friendsCount,
}: Readonly<UserProfileActionsProps>) {
  return (
    <div className="user-profile__actions">
      <Link to={FRIENDS_ROUTE} className="user-profile__actions__friends">
        <UsersIcon size={20} className="user-profile__actions__friends__icon" />

        <p className="user-profile__actions__friends__count">
          <span className="user-profile__actions__friends__count__number">
            {friendsCount}
          </span>{" "}
          <span className="user-profile__actions__friends__count__text">
            friends online
          </span>
        </p>
      </Link>
    </div>
  );
}

function UserProfileContent({
  image,
  name,
  friendCode,
}: Readonly<UserProfileContentProps>) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    if (isCopied || !friendCode) return;
    setIsCopied(true);
    globalThis.window.electron.clipboard.writeText(friendCode).catch(() => {});

    globalThis.window.setTimeout(() => {
      setIsCopied(false);
    }, 2000);
  };

  return (
    <div className="user-profile-content">
      <img
        src={image}
        alt={name}
        className="user-profile-content__image"
        width={48}
        height={48}
        draggable={false}
      />

      <div className="user-profile-content__info">
        <Link to={PROFILE_ROUTE} className="user-profile-content__info__name">
          {name}
        </Link>
        <button
          className="user-profile-content__info__friend-code"
          onClick={handleCopy}
        >
          {friendCode}
          {isCopied ? (
            <CheckIcon
              size={14}
              className="user-profile-content__info__friend-code__icon"
            />
          ) : (
            <CopyIcon
              size={14}
              className="user-profile-content__info__friend-code__icon"
            />
          )}
        </button>
      </div>
    </div>
  );
}

const FALLBACK_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="12" fill="%23333"/></svg>'
  );

export function UserProfile({
  image,
  name,
  friendCode,
}: Readonly<UserProfileProps>) {
  const { userDetails } = useUserDetails();
  const [onlineFriendsCount, setOnlineFriendsCount] = useState(0);

  const updateOnlineFriendsCount = useCallback(async () => {
    if (!IS_DESKTOP || !userDetails) {
      setOnlineFriendsCount(0);
      return;
    }
    try {
      const response =
        await globalThis.window.electron.hydraApi.get<ProfileFriends>(
          "/profile/friends",
          { params: { take: 5, skip: 0 } }
        );
      setOnlineFriendsCount(response.onlineFriends ?? 0);
    } catch {
      // ignore transient errors
    }
  }, [userDetails]);

  useEffect(() => {
    void updateOnlineFriendsCount();

    if (!IS_DESKTOP) return;

    const unsubscribeFriends = globalThis.window.electron.onFriendsUpdated(
      () => {
        void updateOnlineFriendsCount();
      }
    );
    const unsubscribePresence = globalThis.window.electron.onFriendPresence(
      () => {
        void updateOnlineFriendsCount();
      }
    );

    return () => {
      unsubscribeFriends();
      unsubscribePresence();
    };
  }, [updateOnlineFriendsCount]);

  const resolvedImage =
    image ?? userDetails?.profileImageUrl ?? FALLBACK_AVATAR;
  const resolvedName = name ?? userDetails?.displayName ?? "Sign in";
  const resolvedFriendCode = friendCode ?? userDetails?.id ?? "";

  return (
    <div className="user-profile-container">
      <UserProfileContent
        image={resolvedImage}
        name={resolvedName}
        friendCode={resolvedFriendCode}
      />
      <UserProfileActions friendsCount={onlineFriendsCount} />
    </div>
  );
}
