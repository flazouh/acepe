/**
 * Per-checkout identity for a dev app instance.
 *
 * Several worktrees of this repo can run their own dev app at the same time,
 * which is what makes parallel QA possible. Each needs three things nobody
 * else is using: a Vite port, a launchd label, and a QA socket id. All three
 * derive from the checkout path, so a worktree gets a stable identity without
 * anyone assigning one, and the same worktree always comes back to the same
 * port.
 *
 * The primary checkout keeps the historical ids, so existing muscle memory
 * (`bun run qa doctor`, port 1420) keeps working there.
 */

export const DEFAULT_APP_ID = "com.acepe.app";
export const DEFAULT_PORT = 1420;
export const DEFAULT_LABEL = "acepe.vite";

/** Ports 1421-1519. 1420 belongs to the primary checkout. */
const PORT_RANGE_START = 1421;
const PORT_RANGE_SIZE = 99;

export interface DevInstance {
	/** Short, filesystem-safe name for this checkout. */
	readonly id: string;
	readonly port: number;
	readonly appId: string;
	readonly launchdLabel: string;
	readonly viteLogPath: string;
	/** True for the primary checkout, which keeps the historical defaults. */
	readonly isPrimary: boolean;
}

/** FNV-1a. Small, dependency-free, and stable across runs and machines. */
function hash(input: string): number {
	let value = 0x811c9dc5;
	for (let index = 0; index < input.length; index += 1) {
		value ^= input.charCodeAt(index);
		value = Math.imul(value, 0x01000193) >>> 0;
	}
	return value >>> 0;
}

export function sanitizeInstanceId(raw: string): string {
	const cleaned = raw
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return cleaned === "" ? "worktree" : cleaned.slice(0, 32);
}

/**
 * `primaryRoot` is the checkout that keeps port 1420 and the bare app id.
 * Everything else is derived from `checkoutRoot`.
 */
export function resolveDevInstance(input: {
	readonly checkoutRoot: string;
	readonly primaryRoot: string;
}): DevInstance {
	const isPrimary = input.checkoutRoot === input.primaryRoot;
	if (isPrimary) {
		return {
			id: "primary",
			port: DEFAULT_PORT,
			appId: DEFAULT_APP_ID,
			launchdLabel: DEFAULT_LABEL,
			viteLogPath: "/tmp/acepe-vite.log",
			isPrimary: true,
		};
	}

	const name = sanitizeInstanceId(
		input.checkoutRoot.split("/").filter(Boolean).pop() ?? "",
	);
	const port = PORT_RANGE_START + (hash(input.checkoutRoot) % PORT_RANGE_SIZE);

	return {
		id: name,
		port,
		appId: `${DEFAULT_APP_ID}.${name}`,
		launchdLabel: `${DEFAULT_LABEL}.${name}`,
		viteLogPath: `/tmp/acepe-vite-${name}.log`,
		isPrimary: false,
	};
}

/** `eval`-able shell assignments, so dev-app.sh has one source of truth. */
export function toShellExports(instance: DevInstance): string {
	return [
		`ACEPE_INSTANCE_ID='${instance.id}'`,
		`ACEPE_INSTANCE_PORT='${String(instance.port)}'`,
		`ACEPE_INSTANCE_APP_ID='${instance.appId}'`,
		`ACEPE_INSTANCE_LABEL='${instance.launchdLabel}'`,
		`ACEPE_INSTANCE_LOG='${instance.viteLogPath}'`,
	].join("\n");
}

if (import.meta.main) {
	const checkoutRoot = Bun.argv[2] ?? process.cwd();
	const primaryRoot = Bun.argv[3] ?? checkoutRoot;
	console.log(
		toShellExports(resolveDevInstance({ checkoutRoot, primaryRoot })),
	);
}
