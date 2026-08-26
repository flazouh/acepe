import path from "node:path";

/**
 * @typedef {{ path: string }} HmrUpdate
 * @typedef {{ stylesheet: Array<HmrUpdate>, rest: Array<HmrUpdate> }} SplitUpdates
 */

/**
 * Convert an absolute file path into the URL Vite uses for it in HMR payloads.
 *
 * @param {string} viteRoot
 * @param {string} file
 * @returns {string}
 */
export function toHmrUpdatePath(viteRoot, file) {
	return `/${path.relative(viteRoot, file).split(path.sep).join("/")}`;
}

/**
 * Separate the stylesheet from the rest of one HMR update payload.
 *
 * Returns null whenever the payload must be forwarded untouched: a payload of
 * another type, an unexpected shape, or an update that carries only the
 * stylesheet or only other modules.
 *
 * @param {unknown} payload
 * @param {string} stylesheetPath
 * @returns {SplitUpdates | null}
 */
export function splitStylesheetUpdate(payload, stylesheetPath) {
	if (typeof payload !== "object" || payload === null) {
		return null;
	}
	const candidate = /** @type {{ type?: unknown, updates?: unknown }} */ (payload);
	if (candidate.type !== "update" || !Array.isArray(candidate.updates)) {
		return null;
	}
	const updates = /** @type {Array<HmrUpdate>} */ (candidate.updates);
	const stylesheet = updates.filter((update) => update.path === stylesheetPath);
	const rest = updates.filter((update) => update.path !== stylesheetPath);
	if (stylesheet.length === 0 || rest.length === 0) {
		return null;
	}
	return { stylesheet, rest };
}

/**
 * Take the Tailwind stylesheet off the HMR critical path.
 *
 * `@tailwindcss/vite` registers every file it scans as a watch dependency of the
 * stylesheet, so editing any component invalidates the stylesheet as well. Vite's
 * client applies one update batch only after every fetch in it resolves
 * (`Promise.all` in `HMRClient.queueUpdate`), and regenerating this stylesheet
 * costs ~85ms while the component module itself is a ~13ms cache hit. Measured on
 * a component edit: the client-side share of save-to-repaint drops from 105-134ms
 * to 21-44ms once the stylesheet leaves the batch.
 *
 * So send the stylesheet as its own update on the next macrotask. Styles still
 * arrive, they just land after the markup instead of gating it. Tailwind
 * regenerates byte-identical CSS for every edit that adds no new utility class,
 * which is most edits, and then nothing changes on screen at all. A new utility
 * class still applies within 250ms of the save.
 *
 * The stylesheet is not one of the changed file's modules: Vite finds it while
 * walking importers for accept boundaries, which happens after the `hotUpdate`
 * hooks run. The finished payload is the first place both appear together, so the
 * split has to sit on the send.
 *
 * @param {{ stylesheetFile: string, viteRoot: string }} options
 * @returns {import("vite").Plugin}
 */
export function acepeDeferStylesheetHmr({ stylesheetFile, viteRoot }) {
	const stylesheetPath = toHmrUpdatePath(viteRoot, stylesheetFile);

	return {
		name: "acepe-defer-stylesheet-hmr",
		apply: "serve",
		configureServer(server) {
			const environment = server.environments.client;
			const send = environment.hot.send.bind(environment.hot);

			environment.hot.send = (...args) => {
				const split = args.length === 1 ? splitStylesheetUpdate(args[0], stylesheetPath) : null;
				if (!split) {
					return send(...args);
				}
				send({ type: "update", updates: split.rest });
				setTimeout(() => send({ type: "update", updates: split.stylesheet }), 0);
			};
		},
	};
}
