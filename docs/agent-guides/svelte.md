# Svelte 5 Patterns

## Required Skills

**ALWAYS invoke Svelte skills before modifying or creating Svelte code.** Use the `Skill` tool with:

| Skill | When to Use |
|-------|-------------|
| `svelte-runes` | Reactive state, props, effects, rune patterns |
| `svelte-components` | Component patterns, third-party integration (Bits UI, shadcn) |
| `sveltekit-structure` | Routing, layouts, error handling, SSR |
| `sveltekit-data-flow` | Load functions, form actions, server/client data |

## Svelte 5 Runes

Use Svelte 5 runes for all reactivity:

```svelte
<script lang="ts">
  // Mutable state
  let count = $state(0);

  // Computed values (pure functions only)
  const doubled = $derived(count * 2);

  // Side effects (DOM updates, async, subscriptions)
  $effect(() => {
    console.log(`Count changed: ${count}`);
  });
</script>
```

### Rune Selection Guide

| Need | Rune | Notes |
|------|------|-------|
| Mutable value | `$state()` | For values that change over time |
| Computed value | `$derived()` | Pure functions only, use `const` for read-only |
| Side effect | `$effect()` | DOM updates, async operations, subscriptions |
| Props | `$props()` | Component inputs |
| Two-way binding | `$bindable()` | When parent needs to update child state |

### Critical Rules

- **NEVER** use `$effect` in Svelte 5 components — effects create causal loops when they read and write connected state. Use `$derived` for computed values and event handlers for actions. For async operations, move state ownership to the parent (see "Component Architecture" below).
- **NEVER** use spread syntax (`...obj`) in components — it obscures data flow and breaks TypeScript's ability to track property provenance. Explicitly enumerate all properties instead.
- **NEVER** abuse `$derived.by()` for side effects — it's for computations only
- Call runes at component top level or in class fields only
- Use `const` with `$derived` to enforce read-only behavior

## Component Patterns

### Props with TypeScript

```svelte
<script lang="ts">
  interface Props {
    name: string;
    age?: number;
    onSave?: (data: FormData) => void;
  }

  let { name, age = 18, onSave }: Props = $props();
</script>
```

### Controlled Components (Recommended)

```svelte
<!-- Parent controls state, child notifies via callback -->
<script lang="ts">
  interface Props {
    value: string;
    onChange: (value: string) => void;
  }

  let { value, onChange }: Props = $props();
</script>

<input {value} oninput={(e) => onChange(e.currentTarget.value)} />
```

### State Classes for Complex Logic

```typescript
// my-feature-state.svelte.ts
export class MyFeatureState {
  count = $state(0);
  readonly doubled = $derived(this.count * 2);

  increment() {
    this.count++;
  }
}
```

## Event Handlers

Use standard DOM properties, not `on:` directives:

```svelte
<!-- Svelte 5 -->
<button onclick={handleClick}>Click</button>
<input oninput={(e) => value = e.currentTarget.value} />

<!-- NOT Svelte 4 -->
<button on:click={handleClick}>Click</button>
```

## Forbidden Patterns

- **FORBIDDEN**: Never have optional values in components - if something is not defined, don't render that component; instead, in the parent, display something else
- **FORBIDDEN**: Never mix Svelte 4 and 5 syntax (`on:click` with `$state`)
- **FORBIDDEN**: Never use `$:` reactive statements with runes
- **FORBIDDEN**: Never use `$effect` in `.svelte` components — effects in components always risk causal loops. Move state ownership to the parent.

## Component Architecture: Presentational Pattern

Keep components purely presentational. State ownership stays in the parent:

### Pattern

```
Parent (.svelte)              Child (.svelte, purely presentational)
─────────────────────          ─────────────────────────────────────────
- owns reactive state ($state)  - NO $state for fetched/remote data
- fetches data (async/await)   - receives data as Props
- calls store updates            - emits via callbacks
- renders child                 - only renders UI
```

### Example

```svelte
<!-- Parent: owns fetch + state -->
<script lang="ts">
  let prDetails = $state<PrDetails | null>(null);
  let fetchError = $state<string | null>(null);

  // Safe: effect writes to store, store change doesn't flow back here
  $effect(() => {
    if (!prNumber || !projectPath) { prDetails = null; return; }
    const c = { cancelled: false };
    void tauriClient.git.prDetails(projectPath, prNumber).match(
      (details) => { if (!c.cancelled) prDetails = details; },
      (err) => { if (!c.cancelled) fetchError = err.message; }
    );
    return () => { c.cancelled = true; };
  });
</script>

<!-- Child: purely presentational -->
<PrStatusCard
  {prDetails}
  {fetchError}
  onMerge={(strategy) => handleMerge(strategy)}
/>
```

### When to use callbacks

- Child needs to notify parent of user actions → pass callback props (`onMerge`, `onSelect`)
- Child needs to update parent's remote state → callback that calls store (`sessionStore.updateSession`)
- Child needs to open URL, copy to clipboard → callback that runs async action

### When to avoid callbacks

- Child needs to react to prop changes (e.g., re-fetch when `prNumber` changes) → parent should own the fetch, not the child. If the child owns the fetch, it needs an effect to watch props, which creates a causal loop risk.
