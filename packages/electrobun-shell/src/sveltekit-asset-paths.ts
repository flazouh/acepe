const ROOT_APP_HREF = 'href="/_app/'
const ROOT_APP_SRC = 'src="/_app/'
const ROOT_FAVICON = 'href="/favicon'

const RELATIVE_APP_HREF = 'href="./_app/'
const RELATIVE_APP_SRC = 'src="./_app/'
const RELATIVE_FAVICON = 'href="./favicon'

export const rewriteSvelteKitRootAbsolutePaths = (html: string): string => {
	const hrefRewritten = html.split(ROOT_APP_HREF).join(RELATIVE_APP_HREF)
	const srcRewritten = hrefRewritten.split(ROOT_APP_SRC).join(RELATIVE_APP_SRC)
	return srcRewritten.split(ROOT_FAVICON).join(RELATIVE_FAVICON)
}
