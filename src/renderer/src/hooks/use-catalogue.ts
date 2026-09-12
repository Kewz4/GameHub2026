import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { DownloadSource } from "@types";
import { useAppDispatch } from "./redux";
import { setGenres, setTags } from "@renderer/features";
import { resolveExternalResourcesUrl } from "@renderer/helpers/external-resources";
import { useTranslation } from "react-i18next";
import {
  getCatalogueMetadata,
  getLocalizedCatalogueMetadata,
} from "@renderer/services/catalogue-metadata";

export const externalResourcesInstance = axios.create({
  baseURL: resolveExternalResourcesUrl(
    import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL
  ),
});

export function useCatalogue() {
  const dispatch = useAppDispatch();
  const { i18n } = useTranslation();

  const [steamPublishers, setSteamPublishers] = useState<string[]>([]);
  const [steamDevelopers, setSteamDevelopers] = useState<string[]>([]);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);

  const getSteamUserTags = useCallback(() => {
    void getLocalizedCatalogueMetadata<Record<string, number>>(
      "tags",
      i18n.language
    )
      .then((tags) => dispatch(setTags(tags)))
      .catch(() => undefined);
  }, [dispatch, i18n.language]);

  const getSteamGenres = useCallback(() => {
    void getLocalizedCatalogueMetadata<string[]>("genres", i18n.language)
      .then((genres) => dispatch(setGenres(genres)))
      .catch(() => undefined);
  }, [dispatch, i18n.language]);

  const getSteamPublishers = useCallback(() => {
    void getCatalogueMetadata<string[]>("publishers")
      .then(setSteamPublishers)
      .catch(() => undefined);
  }, []);

  const getSteamDevelopers = useCallback(() => {
    void getCatalogueMetadata<string[]>("developers")
      .then(setSteamDevelopers)
      .catch(() => undefined);
  }, []);

  const getDownloadSources = useCallback(() => {
    void levelDBService
      .values("downloadSources")
      .then((results) => {
        const sources = results as DownloadSource[];
        setDownloadSources(sources.filter((source) => !!source.fingerprint));
      })
      .catch(() => setDownloadSources([]));
  }, []);

  useEffect(() => {
    getSteamUserTags();
    getSteamGenres();
    getSteamPublishers();
    getSteamDevelopers();
    getDownloadSources();
  }, [
    getSteamUserTags,
    getSteamGenres,
    getSteamPublishers,
    getSteamDevelopers,
    getDownloadSources,
  ]);

  return { steamPublishers, downloadSources, steamDevelopers };
}
