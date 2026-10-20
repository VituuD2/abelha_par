import packageJson from "../../package.json";

export const APP_RELEASE = {
  version: packageJson.version,
  date: "2026-10-20",
  build: "10202600", // MMDDYY + release revision for that day; retained from the app's existing format.
} as const;

export const APP_VERSION_LABEL = `v${APP_RELEASE.version} - ${APP_RELEASE.build}`;
