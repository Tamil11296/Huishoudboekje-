// craco.config.js
const path = require("path");
require("dotenv").config();

module.exports = {
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
  },
  webpack: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  devServer: (devServerConfig) => {
    // Lokaal ontwikkelen: /api doorsturen naar de backend, zodat cookies same-origin blijven.
    devServerConfig.proxy = {
      "/api": { target: process.env.DEV_BACKEND_URL || "http://localhost:8001", changeOrigin: true },
    };
    return devServerConfig;
  },
};
