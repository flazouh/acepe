//! Structured reducer diagnostics (R5, R11).
//!
//! Extended when live path emits `Unclassified` / failure details to the streaming log.

#[allow(dead_code)]
#[derive(Debug, Clone, Default)]
pub struct ReducerDiagnostics {
    pub notes: Vec<String>,
}
