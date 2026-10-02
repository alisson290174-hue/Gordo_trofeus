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


// The dev server (React Fast Refresh) injects an inline script; production loads only bundled
// files, so inline scripts stay forbidden there by the CSP in index.html.
const allowInlineScriptsInDev = () => ({
  name: "baloi-dev-csp",
  transformIndexHtml(html: string, ctx: { server?: unknown }) {
    return ctx.server ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") : html;
  },
});

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
      plugins: [externalizeDepsPlugin(), swcPlugin()],
    },
    preload: {
      // Sandboxed renderers only run CommonJS preloads (no ESM, no Node modules).
      build: {
        rollupOptions: {
          output: { format: "cjs", entryFileNames: "[name].cjs" },
        },
      },
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
          "@renderer": resolve("src/renderer/src"),
          "@locales": resolve("src/locales"),
          "@shared": resolve("src/shared"),
        },
      },
      plugins: [svgr(), react(), allowInlineScriptsInDev()],
    },
    renderer: {
      build: {
        sourcemap: true,
      },
      esbuild: {
        keepNames: true,
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
      plugins: [svgr(), react(), allowInlineScriptsInDev()],
    },
  };
});
