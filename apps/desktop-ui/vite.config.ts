import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

import Components from "unplugin-vue-components/vite";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const envDir = resolve(__dirname, "..");
  const env = loadEnv(mode, envDir, "");
  const port = parseInt(env.PORT || "3000");

  return {
    plugins: [
      vue(),
      tailwindcss(),
      Components({
        /* options */
      }),
    ],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
        "@shared": resolve(__dirname, "../packages/shared/src"),
      },
    },
    // resolve: {
    //   alias: {
    //     "@": fileURLToPath(new URL("./src", import.meta.url)),
    //   },
    // },
    base: "./",
    build: {
      outDir: "dist",
      assetsDir: "assets",
      emptyOutDir: true,
      target: "es2020",
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
        },
      },
      minify: false,
      // minify: "esbuild",
      // minify: "terser",
      // terserOptions: {
      //   compress: {
      //     drop_console: true,
      //     drop_debugger: true,
      //   },
      // },
    },
    server: {
      port: port,
      strictPort: true,
    },
  };
});
