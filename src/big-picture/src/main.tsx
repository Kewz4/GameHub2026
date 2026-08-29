import ReactDOM from "react-dom/client";
import { StrictMode } from "react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import resources from "@locales";
import App from "./app";
import Catalogue from "./pages/catalogue/catalogue";
import CloudSavesPage from "./pages/cloud-saves/cloud-saves";
import ComponentLab from "./pages/component-lab/component-lab";
import Downloads from "./pages/downloads/downloads";
import Friends from "./pages/friends/friends";
import Game from "./pages/game/game";
import GameAchievements from "./pages/game-achievements/game-achievements";
import Home from "./pages/home/home";
import LibraryPage from "./pages/library/page";
import Profile from "./pages/profile/profile";
import Settings from "./pages/settings/settings";

const bootstrap = async () => {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources,
      fallbackLng: "en",
      lng: globalThis.window.navigator.language || "en",
      interpolation: { escapeValue: false },
    });
  }

  document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  document.documentElement.dir = i18n.dir();

  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Big Picture root element was not found.");
  }

  ReactDOM.createRoot(rootElement).render(
    <StrictMode>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />}>
            <Route index element={<Home />} />
            <Route path="catalogue" element={<Catalogue />} />
            <Route path="component-lab" element={<ComponentLab />} />
            <Route path="downloads" element={<Downloads />} />
            <Route path="settings" element={<Settings />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="cloud-saves" element={<CloudSavesPage />} />
            <Route path="profile" element={<Profile />} />
            <Route path="profile/:userId" element={<Profile />} />
            <Route path="friends" element={<Friends />} />
            <Route path="game/:shop/:objectId" element={<Game />} />
            <Route
              path="game/:shop/:objectId/achievements"
              element={<GameAchievements />}
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </StrictMode>
  );
};

void bootstrap();
