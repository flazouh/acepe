# Acepe Website Style Guide

Design language inspired by the Acepe desktop app — embedded panels, monospace accents, dev-native aesthetic.

## Principles

1. **Embedded, not decorative** — UI elements look like panels in an IDE, not marketing widgets
2. **Monospace where it matters** — prices, labels, metadata, section markers use `font-mono`
3. **Sober color** — mostly neutral with selective accent color per context
4. **Dense and precise** — tight spacing, small text sizes, no unnecessary whitespace
5. **Glass and layers** — semi-transparent backgrounds with `backdrop-blur` for depth

## Cards / Panels

Cards use the "embedded panel" pattern from the desktop app:

```
rounded-xl border border-border/50 bg-card/20
backdrop-filter: blur(12px)
```

### Panel Header

Every card has a fixed-height header bar with a bottom border:

```
h-9 flex items-center justify-between border-b border-border/50 px-3
```

- **Left**: panel identity — `font-mono text-xs font-semibold`
- **Right**: metadata badge — `font-mono text-[10px] text-muted-foreground/60`
- Accent cards use `color-mix(in srgb, <accent> 20%, var(--border))` for the border

### Panel Body

```
flex flex-1 flex-col p-5
```

Body text uses `text-[13px] leading-relaxed text-muted-foreground`.

## Typography

| Element | Classes |
|---------|---------|
| Page title (hero) | `text-3xl md:text-[56px] font-semibold tracking-[-0.03em]` |
| Page subtitle | `text-lg md:text-[22px] text-muted-foreground` |
| Section label | `font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50` |
| Section heading (FAQ-style) | `font-mono text-sm font-medium uppercase tracking-wider text-muted-foreground` |
| Card header label | `font-mono text-xs font-semibold` |
| Card metadata | `font-mono text-[10px] text-muted-foreground/60` |
| Feature list item | `font-mono text-xs text-muted-foreground` |
| Body text | `text-[13px] leading-relaxed text-muted-foreground` |
| Large number (price) | `font-mono text-3xl font-bold tracking-tight text-foreground` |

## Colors

Use CSS custom properties from `layout.css`. Do not hardcode hex colors except:

- **Primary accent**: `var(--primary)` / `text-primary` — rust orange
- **Enterprise accent**: `#9858FF` — violet, used sparingly (title only)
- **Success**: `text-success` — green, for active/included states

### Accent blending

For tinted borders and backgrounds, use `color-mix`:

```css
border-color: color-mix(in srgb, var(--primary) 20%, var(--border));
background: color-mix(in srgb, var(--primary) 4%, var(--card));
```

## Buttons

### Primary CTA

```
theme-invert-btn h-9 rounded-lg text-sm font-medium
```

White on dark, dark on light. Used for the main action per page.

### Secondary / outline

```
h-9 rounded-lg border border-border bg-muted/30 text-sm font-medium text-foreground
hover:bg-muted/60
```

### Disabled / coming soon

```
h-9 rounded-lg bg-primary/10 text-sm font-medium text-primary/60 cursor-not-allowed
```

Wrap label in `<TextShimmer>` for animation.

## Feature Lists

Features render as a bordered list, terminal-output style:

```svelte
<div class="flex items-center gap-2.5 border-t border-border/30 py-2 font-mono text-xs text-muted-foreground">
    <Check class="h-3 w-3 shrink-0 text-foreground/50" />
    {feature}
</div>
```

Preceded by a section label:

```svelte
<div class="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
    includes
</div>
```

## Section Dividers

Use `// LABEL` pattern for dev-style section headings:

```svelte
<span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">//</span>
<h2 class="font-mono text-sm font-medium uppercase tracking-wider text-muted-foreground">FAQ</h2>
```

## Metadata Rows

Key-value rows separated by borders (used in blog cards, detail panels):

```svelte
<div class="flex items-center justify-between border-t border-border/30 py-2 font-mono text-xs">
    <span class="text-muted-foreground/60">label</span>
    <span class="text-foreground">value</span>
</div>
```

## Hero Badges

Small monospace pills above page titles:

```svelte
<div class="inline-flex items-center gap-2 rounded-full border border-border/50 bg-muted/30 px-3 py-1">
    <span class="font-mono text-xs text-muted-foreground">label</span>
</div>
```

## Spacing

- Card grid gap: `gap-2` (tight, embedded feel)
- Card body padding: `p-5`
- Section padding: `px-4 md:px-6`
- Page max-width: `max-w-5xl` (content), `max-w-6xl` (wide grids)
- Hero top padding: `pt-16 md:pt-24`

## Footer

Consistent across all pages:

```svelte
<footer class="border-t border-border/50 px-4 py-12 md:px-6">
    <div class="mx-auto flex max-w-6xl justify-center">
        <!-- badges, links -->
    </div>
</footer>
```
