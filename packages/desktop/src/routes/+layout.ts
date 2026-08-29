// The desktop shell has no Node.js server to do proper SSR, so we use
// adapter-static with a fallback to index.html to put the app in SPA mode.
// See: https://svelte.dev/docs/kit/single-page-apps
import "../app.css";

export const ssr = false;
