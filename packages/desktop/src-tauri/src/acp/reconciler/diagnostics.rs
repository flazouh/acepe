//! Structured reducer diagnostics (R5, R11).
//!
//! Extended when live path emits `Unclassified` / failure details to the streaming log.

#[expect(
    dead_code,
    reason = "Reserved for upcoming reducer diagnostics wiring."
)]
#[derive(Debug, Clone, Default)]
pub struct ReducerDiagnostics {
    pub notes: Vec<String>,
}
