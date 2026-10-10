// electron-builder configuration. `pnpm dist` (root) or `pnpm -C apps/desktop dist` builds the UI,
// stages out/app and out/server with scripts/prepare-package.mjs, then runs electron-builder for
// the current platform and architecture. Installers land in apps/desktop/release/.
//
// Code signing is optional. With no certificates configured the build is unsigned (macOS gets an
// ad-hoc signature so it runs on Apple silicon). To sign, set the usual electron-builder variables:
//   macOS:   CSC_LINK + CSC_KEY_PASSWORD (Developer ID Application .p12), and to notarize
//            APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID (or APPLE_API_KEY*)
//   Windows: CSC_LINK + CSC_KEY_PASSWORD (or WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD)
const electronVersion = require('electron/package.json').version;
const hasMacCert = !!(process.env.CSC_LINK || process.env.CSC_NAME);

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'io.github.jeremysnr.quillgon',
  productName: 'Quillgon',
  copyright: 'Copyright © 2026 JeremySNR and Quillgon contributors',
  electronVersion,
  directories: { app: 'out/app', output: 'release', buildResources: 'build-resources' },
  // Only the shell. The UI is bundled by Vite and the server by esbuild, so no node_modules: without
  // the exclusion electron-builder falls back to apps/desktop's dependencies and packs all of them.
  files: ['package.json', 'electron/**', '!**/node_modules/**'],
  asar: true,
  // The app (main.cjs, preload.cjs) has no dependencies. The one native module, better-sqlite3,
  // belongs to the server in resources/server and prepare-package.mjs has already rebuilt it for
  // this Electron, so electron-builder has nothing to install or rebuild.
  npmRebuild: false,
  nodeGypRebuild: false,
  // electron-builder always drops a copied directory's top-level node_modules, so the server's
  // (just better-sqlite3 and its two helpers) is copied as an entry of its own.
  extraResources: [
    { from: 'out/server', to: 'server' },
    { from: 'out/server/node_modules', to: 'server/node_modules' },
  ],
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  publish: null,

  mac: {
    category: 'public.app-category.productivity',
    target: ['dmg', 'zip'],
    hardenedRuntime: true,
    // electron-builder's default entitlements include disable-library-validation, which an
    // ad-hoc signed app needs to load better_sqlite3.node.
    identity: hasMacCert ? undefined : '-',
  },
  dmg: { writeUpdateInfo: false },
  win: { target: ['nsis'] },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, differentialPackage: false },
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Office',
    synopsis: 'Write a whole novel with AI while staying in charge of the story',
    maintainer: 'Quillgon contributors',
  },
  // electron-builder's default Debian dependencies, plus git (every book is a git repository).
  deb: { depends: ['libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0', 'libuuid1', 'libsecret-1-0', 'git'] },
};
