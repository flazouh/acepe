const LEGACY_LOCALE_SEGMENTS = new Set(["en", "es"]);

export function canonicalizePathname(pathname: string): string {
	const normalizedLeadingSlash = `/${pathname.replace(/^\/+/, "")}`;
	const trimmedPath = normalizedLeadingSlash.replace(/\/+$/, "");
	return trimmedPath === "" ? "/" : trimmedPath;
}

export function getLegacyLocaleRedirectPath(url: URL): string | null {
	const pathSegments = url.pathname.split("/");
	const localeSegment = pathSegments[1];

	if (!LEGACY_LOCALE_SEGMENTS.has(localeSegment)) {
		return null;
	}

	const remainingPath = pathSegments.slice(2).join("/");
	const canonicalPath = canonicalizePathname(remainingPath === "" ? "/" : `/${remainingPath}`);

	return `${canonicalPath}${url.search}`;
}
