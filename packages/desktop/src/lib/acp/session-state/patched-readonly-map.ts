/**
 * A lazy copy-on-read ReadonlyMap view: presents `base` overlaid with `patches`
 * and minus `deletedKeys`, without materializing a new map. Generic and
 * dependency-free; used by the agent-panel materializer's index fast-paths
 * (interaction index, scene-entry-row index). GOD-safe — pure data structure.
 */
class PatchedReadonlyMap<K, V> implements ReadonlyMap<K, V> {
	readonly [Symbol.toStringTag] = "PatchedReadonlyMap";

	constructor(
		private readonly base: ReadonlyMap<K, V>,
		private readonly patches: ReadonlyMap<K, V>,
		private readonly deletedKeys: ReadonlySet<K> = new Set<K>()
	) {}

	get size(): number {
		let size = this.base.size;
		for (const key of this.deletedKeys) {
			if (this.base.has(key) && !this.patches.has(key)) {
				size -= 1;
			}
		}
		for (const key of this.patches.keys()) {
			if (!this.base.has(key)) {
				size += 1;
			}
		}
		return size;
	}

	get(key: K): V | undefined {
		if (this.patches.has(key)) {
			return this.patches.get(key);
		}
		if (this.deletedKeys.has(key)) {
			return undefined;
		}
		return this.base.get(key);
	}

	has(key: K): boolean {
		return this.patches.has(key) || (!this.deletedKeys.has(key) && this.base.has(key));
	}

	forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
		for (const [key, value] of this.entries()) {
			callbackfn.call(thisArg, value, key, this);
		}
	}

	*entries(): MapIterator<[K, V]> {
		const patchedKeys = new Set<K>();
		for (const [key, value] of this.patches.entries()) {
			patchedKeys.add(key);
			yield [key, value];
		}
		for (const [key, value] of this.base.entries()) {
			if (!patchedKeys.has(key) && !this.deletedKeys.has(key)) {
				yield [key, value];
			}
		}
	}

	*keys(): MapIterator<K> {
		for (const [key] of this.entries()) {
			yield key;
		}
	}

	*values(): MapIterator<V> {
		for (const [, value] of this.entries()) {
			yield value;
		}
	}

	[Symbol.iterator](): MapIterator<[K, V]> {
		return this.entries();
	}
}

export function createPatchedReadonlyMap<K, V>(
	base: ReadonlyMap<K, V>,
	patches: ReadonlyMap<K, V>,
	deletedKeys: ReadonlySet<K> = new Set<K>()
): ReadonlyMap<K, V> {
	return patches.size === 0 && deletedKeys.size === 0
		? base
		: new PatchedReadonlyMap(base, patches, deletedKeys);
}
