/**
 * Lazy-array proxy helpers used by PanelStore to build read-only array views
 * over prepended, appended, patched, or removed entries without copying.
 */

export function createPrependedItemArray<T>(item: T, baseItems: readonly T[]): T[] {
	const target = new Array<T>(baseItems.length + 1);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield selectPrependedItem(item, baseItems, index);
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return selectPrependedItem(item, baseItems, index);
				}
				if (property === "slice") {
					return (start?: number, end?: number) => Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: selectPrependedItem(item, baseItems, index),
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	}) as T[];
}

export function createAppendedItemArray<T>(baseItems: readonly T[], item: T): T[] {
	const target = new Array<T>(baseItems.length + 1);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield index === baseItems.length ? item : baseItems[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return index === baseItems.length ? item : baseItems[index];
				}
				if (property === "slice") {
					return (start?: number, end?: number) => Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: index === baseItems.length ? item : baseItems[index],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	}) as T[];
}

export function createPatchedItemArray<T extends { readonly id: string }>(
	baseItems: readonly T[],
	updatedItem: T
): T[] {
	const patchedIndex = findItemIndexById(baseItems, updatedItem.id);
	if (patchedIndex === -1) {
		return baseItems as T[];
	}

	const target = new Array<T>(baseItems.length);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield index === patchedIndex ? updatedItem : baseItems[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return index === patchedIndex ? updatedItem : baseItems[index];
				}
				if (property === "slice") {
					return (start?: number, end?: number) => Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: index === patchedIndex ? updatedItem : baseItems[index],
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	}) as T[];
}

export function createRemovedItemArray<T extends { readonly id: string }>(
	baseItems: readonly T[],
	removedId: string
): T[] {
	const removedIndex = findItemIndexById(baseItems, removedId);
	if (removedIndex === -1) {
		return baseItems as T[];
	}

	const target = new Array<T>(baseItems.length - 1);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield selectRemovedItem(baseItems, removedIndex, index);
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return selectRemovedItem(baseItems, removedIndex, index);
				}
				if (property === "slice") {
					return (start?: number, end?: number) => Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: selectRemovedItem(baseItems, removedIndex, index),
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
		ownKeys(targetArray) {
			return createArrayLikeOwnKeys(targetArray.length);
		},
	}) as T[];
}

export function findItemIndexById<T extends { readonly id: string }>(
	items: readonly T[],
	id: string
): number {
	for (let index = 0; index < items.length; index += 1) {
		if (items[index]?.id === id) {
			return index;
		}
	}
	return -1;
}

export function selectPrependedItem<T>(
	item: T,
	baseItems: readonly T[],
	index: number
): T | undefined {
	if (index === 0) {
		return item;
	}
	return baseItems[index - 1];
}

export function selectRemovedItem<T>(
	baseItems: readonly T[],
	removedIndex: number,
	index: number
): T | undefined {
	return baseItems[index < removedIndex ? index : index + 1];
}

export function toArrayIndex(property: string): number | null {
	if (property === "") {
		return null;
	}
	const index = Number(property);
	return Number.isInteger(index) && index >= 0 && String(index) === property ? index : null;
}

export function createArrayLikeOwnKeys(length: number): string[] {
	const keys: string[] = [];
	for (let index = 0; index < length; index += 1) {
		keys.push(String(index));
	}
	keys.push("length");
	return keys;
}
