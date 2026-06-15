import react from "@vitejs/plugin-react";
import {
  defineConfig,
  externalizeDepsPlugin,
  loadEnv,
  swcPlugin,
} from "electron-vite";
import { resolve } from "path";
import svgr from "vite-plugin-svgr";
import { scopeBigPictureCss } from "./src/big-picture/vite-scope-big-picture-css";

export default defineConfig(({ mode }) => {
  loadEnv(mode);

  return {
    main: {
      build: {
        sourcemap: true,
      },
      resolve: {
        alias: {
          "@main": resolve("src/main"),
          "@locales": resolve("src/locales"),
          "@resources": resolve("resources"),
          "@shared": resolve("src/shared"),
        },
      },
      plugins: [
        // Bundle @aws-sdk/* and @smithy/* directly into the main output.
        // These are pure-JS ESM packages whose nested package.json structure
        // does not resolve correctly from inside an asar at runtime.
        externalizeDepsPlugin({
          exclude: ["@aws-sdk/client-s3", "@smithy"],
        }),
        swcPlugin(),
      ],
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
    },
    bigPicture: {
      root: "src/big-picture",
      build: {
        outDir: "out/big-picture",
        rollupOptions: {
          input: resolve("src/big-picture/index.html"),
        },
      },
      css: {
        postcss: {
          plugins: [scopeBigPictureCss()],
        },
      },
      resolve: {
        alias: {
          "@locales": resolve("src/locales"),
          "@shared": resolve("src/shared"),
        },
      },
      plugins: [react()],
    },
    renderer: {
      build: {
        sourcemap: true,
      },
      css: {
        postcss: {
          plugins: [scopeBigPictureCss()],
        },
        preprocessorOptions: {
          scss: {
            api: "modern",
          },
        },
      },
      resolve: {
        alias: {
          "@renderer": resolve("src/renderer/src"),
          "@locales": resolve("src/locales"),
          "@shared": resolve("src/shared"),
        },
      },
      plugins: [svgr(), react()],
    },
  };
});
