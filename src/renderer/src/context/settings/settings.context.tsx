import { createContext, useCallback, useEffect, useState } from "react";

import { setUserPreferences } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { UserBlocks, UserPreferences } from "@types";
import { useSearchParams } from "react-router-dom";
import {
  resolveSettingsCategoryId,
  type SettingsCategoryId,
} from "./settings-navigation";

export type { SettingsCategoryId } from "./settings-navigation";

export interface SettingsContext {
  updateUserPreferences: (values: Partial<UserPreferences>) => Promise<void>;
  setCurrentCategoryId: React.Dispatch<
    React.SetStateAction<SettingsCategoryId>
  >;
  clearSourceUrl: () => void;
  clearTheme: () => void;
  sourceUrl: string | null;
  currentCategoryId: SettingsCategoryId;
  blockedUsers: UserBlocks["blocks"];
  fetchBlockedUsers: () => Promise<void>;
  appearance: {
    theme: string | null;
    authorId: string | null;
    authorName: string | null;
  };
}

export const settingsContext = createContext<SettingsContext>({
  updateUserPreferences: async () => {},
  setCurrentCategoryId: () => {},
  clearSourceUrl: () => {},
  clearTheme: () => {},
  sourceUrl: null,
  currentCategoryId: "general",
  blockedUsers: [],
  fetchBlockedUsers: async () => {},
  appearance: {
    theme: null,
    authorId: null,
    authorName: null,
  },
});

const { Provider } = settingsContext;
export const { Consumer: SettingsContextConsumer } = settingsContext;

export interface SettingsContextProviderProps {
  children: React.ReactNode;
}

export function SettingsContextProvider({
  children,
}: Readonly<SettingsContextProviderProps>) {
  const dispatch = useAppDispatch();
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<{
    theme: string | null;
    authorId: string | null;
    authorName: string | null;
  }>({
    theme: null,
    authorId: null,
    authorName: null,
  });
  const [currentCategoryId, setCurrentCategoryId] =
    useState<SettingsCategoryId>("general");
  const [blockedUsers, setBlockedUsers] = useState<UserBlocks["blocks"]>([]);

  const [searchParams] = useSearchParams();
  const defaultSourceUrl = searchParams.get("urls");
  const defaultTab = searchParams.get("tab");
  const defaultAppearanceTheme = searchParams.get("theme");
  const defaultAppearanceAuthorId = searchParams.get("authorId");
  const defaultAppearanceAuthorName = searchParams.get("authorName");

  useEffect(() => {
    if (sourceUrl) setCurrentCategoryId("downloads");
  }, [sourceUrl]);

  useEffect(() => {
    if (defaultSourceUrl) {
      setSourceUrl(defaultSourceUrl);
    }
  }, [defaultSourceUrl]);

  useEffect(() => {
    const categoryId = resolveSettingsCategoryId(defaultTab);
    if (categoryId) setCurrentCategoryId(categoryId);
  }, [defaultTab]);

  useEffect(() => {
    if (appearance.theme) setCurrentCategoryId("general");
  }, [appearance.theme]);

  useEffect(() => {
    if (
      defaultAppearanceTheme &&
      defaultAppearanceAuthorId &&
      defaultAppearanceAuthorName
    ) {
      setAppearance({
        theme: defaultAppearanceTheme,
        authorId: defaultAppearanceAuthorId,
        authorName: defaultAppearanceAuthorName,
      });
    }
  }, [
    defaultAppearanceTheme,
    defaultAppearanceAuthorId,
    defaultAppearanceAuthorName,
  ]);

  const clearTheme = useCallback(() => {
    setAppearance({
      theme: null,
      authorId: null,
      authorName: null,
    });
  }, []);

  const fetchBlockedUsers = useCallback(async () => {
    const blockedUsers = await window.electron.hydraApi
      .get<UserBlocks>("/profile/blocks", {
        params: { take: 12, skip: 0 },
      })
      .catch(() => {
        return { blocks: [] };
      });
    setBlockedUsers(blockedUsers.blocks);
  }, []);

  useEffect(() => {
    fetchBlockedUsers();
  }, [fetchBlockedUsers]);

  const clearSourceUrl = () => setSourceUrl(null);

  const updateUserPreferences = useCallback(
    async (values: Partial<UserPreferences>) => {
      await window.electron.updateUserPreferences(values);
      const userPreferences = await levelDBService.get(
        "userPreferences",
        null,
        "json"
      );
      dispatch(
        setUserPreferences(
          (userPreferences as UserPreferences | null) ?? ({} as UserPreferences)
        )
      );
    },
    [dispatch]
  );

  return (
    <Provider
      value={{
        updateUserPreferences,
        setCurrentCategoryId,
        clearSourceUrl,
        fetchBlockedUsers,
        clearTheme,
        currentCategoryId,
        sourceUrl,
        blockedUsers,
        appearance,
      }}
    >
      {children}
    </Provider>
  );
}
