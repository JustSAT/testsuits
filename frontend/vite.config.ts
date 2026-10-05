import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Optional deployment theme (VITE_THEME_URL, e.g. "/theme"): link its
// stylesheet and favicon in index.html so the themed palette applies before
// first paint. `post` puts the stylesheet after the app's own CSS.
function deploymentTheme(themeUrl: string | undefined): Plugin {
  return {
    name: "deployment-theme",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        if (!themeUrl) return html;
        const base = themeUrl.replace(/\/$/, "");
        return html
          .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="${base}/favicon.svg" />`)
          .replace("</head>", `  <link rel="stylesheet" href="${base}/theme.css" />\n  </head>`);
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), deploymentTheme(env.VITE_THEME_URL)],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      watch: { usePolling: true },
    },
  };
});
