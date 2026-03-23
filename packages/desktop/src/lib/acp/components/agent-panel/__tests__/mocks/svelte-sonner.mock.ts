/**
 * Mock for svelte-sonner toast notifications.
 *
 * This allows us to test components that use toast without
 * requiring the full svelte-sonner dependency tree.
 */

export const mockToast = {
	success: () => {},
	error: () => {},
	info: () => {},
	warning: () => {},
	loading: () => {},
	promise: () => Promise.resolve(),
	custom: () => {},
	message: () => {},
	dismiss: () => {},
};

// Export as default to match svelte-sonner's export pattern
export const toast = mockToast;
