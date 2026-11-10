// PM2 process for hanyo-api (same PM2 daemon as the yoqze platform, user `deploy`).
const path = require("node:path");
const root = path.resolve(__dirname, "..");

module.exports = {
  apps: [
    {
      name: "hanyo-api",
      script: "apps/api/dist/index.js",
      cwd: root,
      node_args: "--env-file=.env",
      max_memory_restart: "512M",
      env: { NODE_ENV: "production", DATA_DIR: path.join(root, "data") },
      out_file: path.join(root, "logs/hanyo-api-out.log"),
      error_file: path.join(root, "logs/hanyo-api-error.log"),
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
