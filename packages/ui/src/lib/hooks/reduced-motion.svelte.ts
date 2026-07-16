import { MediaQuery } from "svelte/reactivity";

/**
 * Shared reactive `prefers-reduced-motion` signal.
 *
 * A single `matchMedia` query + change listener for the whole app — import
 * `reducedMotion.current` anywhere motion needs to respect the OS setting.
 * Because this is one module-level instance, toggling the OS setting mid-session
 * updates every consumer (component state, transition functions, etc.) without
 * each call site wiring its own listener.
 */
export const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");
