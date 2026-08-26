// AC-271 (data loss): the tracer sqlite DB used to resolve to a bare
// filename ("acepe-tracer.sqlite") next to the launcher executable, inside
// the app bundle -- see native-wrapper-cwd.ts's applyNativeWrapperCwdOrExit,
// which chdir's the bun process into Contents/MacOS before index.ts ever
// opens the DB. `electrobun:build` recreates that directory on every build,
// so every rebuild silently wiped the user's real projects and sessions.
//
// This module resolves the DB under the OS app-data directory instead (the
// same directory notion packages/server/src/rpc/fsPathGuard.ts's AppDataDir
// already uses for the fs-path confinement guard -- bootstrap.ts derives
// AppDataDir from `path.dirname(filename)`, so pointing `filename` here
// automatically moves AppDataDir and the worktrees root too), and migrates
// a pre-existing bundle-local DB into the new location on first run so
// nobody loses history to this fix itself.
//
// Every function here is pure (or takes injected fs primitives) so the
// resolution and migration decision can be unit tested with a fake/temp
// HOME instead of the real one -- see tracer-db-path.test.ts.

const INSTANCE_SANITIZE_PATTERN = /[^a-zA-Z0-9.-]/g;

/** Mirrors electrobun-qa's socket-path.ts DEFAULT_APP_ID -- same bundle identifier, kept as a local literal to avoid a new cross-package coupling for one string. */
export const TRACER_APP_ID = "com.acepe.app";

export const sanitizeInstanceId = (instance: string): string =>
	instance.replace(INSTANCE_SANITIZE_PATTERN, "-");

/**
 * The DB filename for a given ELECTROBUN_QA_APP_ID instance ("" = the
 * default, non-QA instance). Unchanged from the pre-fix behavior -- only
 * the directory this filename resolves under changes.
 */
export const tracerDbFilename = (instance: string): string =>
	instance === "" ? "acepe-tracer.sqlite" : `acepe-tracer-${sanitizeInstanceId(instance)}.sqlite`;

export interface AppDataRootInput {
	readonly platform: string;
	readonly home: string;
	readonly appId: string;
	/** Windows %APPDATA%, when known. Falls back to `${home}\AppData\Roaming`. */
	readonly appDataEnv?: string;
	/** $XDG_DATA_HOME, when known. Falls back to `${home}/.local/share`. */
	readonly xdgDataHome?: string;
}

/**
 * The OS-conventional per-app data directory. macOS is the only platform
 * Acepe ships today (~/Library/Application Support/<appId>); win32/other are
 * best-effort fallbacks so this never throws on an unsupported platform.
 */
export const resolveAppDataRoot = (input: AppDataRootInput): string => {
	if (input.platform === "darwin") {
		return `${input.home}/Library/Application Support/${input.appId}`;
	}
	if (input.platform === "win32") {
		const base = input.appDataEnv ?? `${input.home}\\AppData\\Roaming`;
		return `${base}\\${input.appId}`;
	}
	const base = input.xdgDataHome ?? `${input.home}/.local/share`;
	return `${base}/${input.appId}`;
};

const pathSeparatorFor = (platform: string): string => (platform === "win32" ? "\\" : "/");

export interface TracerDbPathInput extends AppDataRootInput {
	readonly instance: string;
}

/** The full, absolute path the tracer sqlite DB should open at. */
export const resolveTracerDbPath = (input: TracerDbPathInput): string => {
	const root = resolveAppDataRoot(input);
	const sep = pathSeparatorFor(input.platform);
	return `${root}${sep}${tracerDbFilename(input.instance)}`;
};

export type LegacyTracerDbMigrationResult = "migrated" | "skipped-exists" | "skipped-no-legacy";

export interface MigrateLegacyTracerDbInput {
	readonly legacyPath: string;
	readonly targetPath: string;
	readonly targetDir: string;
	readonly exists: (path: string) => boolean;
	readonly mkdirSync: (dir: string) => void;
	readonly copyFileSync: (src: string, dst: string) => void;
}

/**
 * Copies a bundle-local DB left behind by a pre-fix build into the new
 * app-data location, once. Never touches (moves or deletes) the legacy
 * file -- a build that still writes to the old bundle-local path (an old
 * app version briefly running side by side) must keep working against it.
 * A no-op once the target already exists, so this never overwrites real
 * data the new location has already accumulated.
 */
export const migrateLegacyTracerDb = (
	input: MigrateLegacyTracerDbInput
): LegacyTracerDbMigrationResult => {
	if (input.exists(input.targetPath) === true) {
		return "skipped-exists";
	}
	if (input.exists(input.legacyPath) === false) {
		return "skipped-no-legacy";
	}
	input.mkdirSync(input.targetDir);
	input.copyFileSync(input.legacyPath, input.targetPath);
	return "migrated";
};
