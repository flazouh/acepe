export const svelteBundleCopy = {
	"build/": "views/mainview/",
} as const

// SvelteKit routes on pathname. "views://mainview/" gives a pathname
// of "/index.html", which matches no route, so its router renders its own 404.
// The directory form gives "/" and matches the root route.
export const svelteBundleViewUrl = "views://mainview/"
