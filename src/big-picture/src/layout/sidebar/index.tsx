import {
  BookOpenIcon,
  CloudIcon,
  DownloadSimpleIcon,
  GearIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  PuzzlePieceIcon,
  SignOutIcon,
  SquaresFourIcon,
  UserIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { forwardRef, useMemo, type Dispatch, type SetStateAction } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Divider,
  FocusItem,
  Input,
  RouteAnchor,
  ScrollArea,
  VerticalFocusGroup,
} from "../../components";
import { IS_DESKTOP } from "../../constants";
import { useLibrary, useSearch, useUserDetails } from "../../hooks";
import { resolveImageSource } from "../../helpers";
import type { FocusOverrides } from "../../services";
import {
  BIG_PICTURE_SIDEBAR_EXIT_ID,
  BIG_PICTURE_SIDEBAR_ITEM_IDS,
  BIG_PICTURE_SIDEBAR_REGION_ID,
  type BigPictureSidebarRouteKey,
  getBigPictureContentSidebarReturnTargetFromPathname,
  getBigPictureGameRouteMatch,
  getBigPictureSidebarLibraryGameFocusId,
  getBigPictureSidebarItemIdFromPathname,
  normalizeBigPicturePathname,
} from "../navigation";
import { buildSidebarNavigationOverrides } from "./sidebar-navigation";
import "./styles.scss";

const getSidebarRoutes = (basePath: string) =>
  (
    [
      { key: "home", label: "Home", path: basePath, icon: HouseIcon },
      {
        key: "catalogue",
        label: "Catalogue",
        path: `${basePath}/catalogue`,
        icon: SquaresFourIcon,
      },
      {
        key: "library",
        label: "Library",
        path: `${basePath}/library`,
        icon: BookOpenIcon,
      },
      {
        key: "cloudSaves",
        label: "Cloud Saves",
        path: `${basePath}/cloud-saves`,
        icon: CloudIcon,
      },
      {
        key: "downloads",
        label: "Downloads",
        path: `${basePath}/downloads`,
        icon: DownloadSimpleIcon,
      },
      {
        key: "profile",
        label: "Profile",
        path: `${basePath}/profile`,
        icon: UserIcon,
      },
      {
        key: "friends",
        label: "Friends",
        path: `${basePath}/friends`,
        icon: UsersIcon,
      },
      {
        key: "settings",
        label: "Settings",
        path: `${basePath}/settings`,
        icon: GearIcon,
      },
      {
        key: "componentLab",
        label: "Component Lab",
        path: `${basePath}/component-lab`,
        icon: PuzzlePieceIcon,
      },
    ] satisfies Array<{
      key: BigPictureSidebarRouteKey;
      label: string;
      path: string;
      icon: typeof HouseIcon;
    }>
  ).filter((route) => import.meta.env.DEV || route.key !== "componentLab");

interface SidebarRouterProps {
  routes: ReturnType<typeof getSidebarRoutes>;
  navigationOverrides: ReadonlyMap<string, FocusOverrides>;
}

function SidebarRouter({
  routes,
  navigationOverrides,
}: Readonly<SidebarRouterProps>) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { userDetails } = useUserDetails();
  const profileImageUrl = resolveImageSource(userDetails?.profileImageUrl);
  const activeSidebarItemId = getBigPictureSidebarItemIdFromPathname(pathname);
  const handleExitBigPicture = () => {
    if (IS_DESKTOP) {
      globalThis.close();
      return;
    }

    navigate("/");
  };

  return (
    <div className="sidebar-router-container">
      {routes.map((route) => {
        const itemId = BIG_PICTURE_SIDEBAR_ITEM_IDS[route.key];
        const routeIcon =
          route.key === "profile" && profileImageUrl ? (
            profileImageUrl
          ) : (
            <route.icon size={24} />
          );

        return (
          <RouteAnchor
            key={route.label}
            label={route.label}
            href={route.path}
            icon={routeIcon}
            active={activeSidebarItemId === itemId}
            focusId={itemId}
            focusActions={{ primary: () => navigate(route.path) }}
            focusNavigationOverrides={navigationOverrides.get(itemId)}
          />
        );
      })}

      <div className="state-wrapper">
        <FocusItem
          id={BIG_PICTURE_SIDEBAR_EXIT_ID}
          actions={{ primary: handleExitBigPicture }}
          navigationOverrides={navigationOverrides.get(
            BIG_PICTURE_SIDEBAR_EXIT_ID
          )}
          asChild
        >
          <button
            type="button"
            className="route-anchor route-anchor--extra-padding sidebar-action-button"
            onClick={handleExitBigPicture}
          >
            <div className="route-anchor__icon route-anchor__icon--small-size">
              <SignOutIcon size={24} />
            </div>
            <div className="route-anchor__label">Exit Big Picture</div>
          </button>
        </FocusItem>
      </div>
    </div>
  );
}

interface SidebarLibraryProps {
  games: ReturnType<typeof useLibrary>["library"];
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  navigationOverrides: ReadonlyMap<string, FocusOverrides>;
}

function SidebarLibrary({
  games,
  search,
  setSearch,
  navigationOverrides,
}: Readonly<SidebarLibraryProps>) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const normalizedPathname = normalizeBigPicturePathname(pathname);
  const activeGameRoute = getBigPictureGameRouteMatch(normalizedPathname);

  return (
    <div className="library-container">
      <div className="library-container__header">
        <Input
          placeholder="Search"
          iconLeft={<MagnifyingGlassIcon size={24} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />

        {/* <Button variant="rounded" size="icon">
            <FunnelSimpleIcon
              size={24}
              className="library-container__header__icon"
            />
          </Button> */}
      </div>

      <div className="library-container__list-focus-region">
        <VerticalFocusGroup regionId="sidebar-library-list">
          <ScrollArea>
            <ul className="library-list">
              {games.map((game) => {
                const desktopPath = `/big-picture/game/${game.shop}/${game.objectId}`;
                const focusId = getBigPictureSidebarLibraryGameFocusId({
                  shop: game.shop,
                  objectId: game.objectId,
                });
                const active =
                  normalizedPathname === desktopPath ||
                  (activeGameRoute?.shop === game.shop &&
                    activeGameRoute.objectId === game.objectId);

                return (
                  <li key={game.id} className="library-list__item">
                    <RouteAnchor
                      key={game.id}
                      label={game.title}
                      href={desktopPath}
                      icon={game.iconUrl}
                      isFavorite={game.favorite}
                      active={active}
                      focusId={focusId}
                      focusActions={{ primary: () => navigate(desktopPath) }}
                      focusNavigationOverrides={navigationOverrides.get(
                        focusId
                      )}
                    />
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </VerticalFocusGroup>
      </div>
    </div>
  );
}

const SidebarContainer = forwardRef<
  HTMLDivElement,
  Readonly<{ children: React.ReactNode }>
>(function SidebarContainer({ children }, ref) {
  const handleMouseLeave = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  return (
    <div
      ref={ref}
      role="presentation"
      className="sidebar-container"
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </div>
  );
});

function Sidebar() {
  const { library } = useLibrary();
  const { pathname } = useLocation();
  const contentEntryTarget =
    getBigPictureContentSidebarReturnTargetFromPathname(pathname);
  const sortedLibrary = useMemo(() => {
    return [...library].sort(
      (a, b) =>
        (b.playTimeInMilliseconds ?? 0) - (a.playTimeInMilliseconds ?? 0)
    );
  }, [library]);
  const { filteredItems, search, setSearch } = useSearch(sortedLibrary, [
    "title",
  ]);
  const libraryFocusIds = filteredItems.map((game) =>
    getBigPictureSidebarLibraryGameFocusId({
      shop: game.shop,
      objectId: game.objectId,
    })
  );
  const routes = getSidebarRoutes(IS_DESKTOP ? "/big-picture" : "");
  const routeFocusIds = routes.map(
    (route) => BIG_PICTURE_SIDEBAR_ITEM_IDS[route.key]
  );
  const navigationOverrides = buildSidebarNavigationOverrides(
    [...routeFocusIds, BIG_PICTURE_SIDEBAR_EXIT_ID, ...libraryFocusIds],
    contentEntryTarget
  );

  return (
    <>
      <VerticalFocusGroup regionId={BIG_PICTURE_SIDEBAR_REGION_ID} asChild>
        <SidebarContainer>
          <SidebarRouter
            routes={routes}
            navigationOverrides={navigationOverrides}
          />
          <Divider />
          <SidebarLibrary
            games={filteredItems}
            search={search}
            setSearch={setSearch}
            navigationOverrides={navigationOverrides}
          />
        </SidebarContainer>
      </VerticalFocusGroup>
      <div className="sidebar-spacer" />
      <div className="sidebar-drawer-overlay" />
    </>
  );
}

export { Sidebar };
