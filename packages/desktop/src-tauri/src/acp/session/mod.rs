//! Clean session ingress architecture (plan 2026-07-12).
//!
//! One `ProviderEvent` vocabulary, one `engine::fold`, live and history differ
//! only in ingress source — never in truth building.

pub mod delivery;
pub mod engine;
pub mod fold_export;
pub mod ingress;

#[cfg(test)]
mod tests;
