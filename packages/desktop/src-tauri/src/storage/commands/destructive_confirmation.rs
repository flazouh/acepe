use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use rand::rngs::OsRng;
use rand::RngCore;

use crate::commands::observability::{unexpected_command_result, CommandResult};

const TOKEN_TTL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DestructiveOperationScope {
    ResetDatabase,
}

impl DestructiveOperationScope {
    fn as_str(&self) -> &'static str {
        match self {
            Self::ResetDatabase => "reset_database",
        }
    }

    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "reset_database" => Ok(Self::ResetDatabase),
            other => Err(format!("Unknown destructive operation scope: {}", other)),
        }
    }
}

#[derive(Debug, Clone)]
struct ConfirmationTokenRecord {
    operation: DestructiveOperationScope,
    target: String,
    expires_at: Instant,
}

fn token_store() -> &'static Mutex<HashMap<String, ConfirmationTokenRecord>> {
    static TOKEN_STORE: OnceLock<Mutex<HashMap<String, ConfirmationTokenRecord>>> = OnceLock::new();
    TOKEN_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn prune_expired_tokens(store: &mut HashMap<String, ConfirmationTokenRecord>, now: Instant) {
    store.retain(|_, record| record.expires_at > now);
}

pub(crate) fn issue_confirmation_token(
    operation: DestructiveOperationScope,
    target: String,
) -> String {
    let now = Instant::now();
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let token = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let record = ConfirmationTokenRecord {
        operation,
        target,
        expires_at: now + TOKEN_TTL,
    };

    let mut store = token_store()
        .lock()
        .expect("destructive confirmation token store should not be poisoned");
    prune_expired_tokens(&mut store, now);
    store.insert(token.clone(), record);
    token
}

#[allow(clippy::result_large_err)]
pub(crate) fn consume_confirmation_token(
    token: &str,
    operation: DestructiveOperationScope,
    target: &str,
    command_name: &'static str,
) -> CommandResult<()> {
    let now = Instant::now();
    let mut store = token_store()
        .lock()
        .expect("destructive confirmation token store should not be poisoned");
    prune_expired_tokens(&mut store, now);

    let Some(record) = store.remove(token) else {
        return Err(
            crate::commands::observability::SerializableCommandError::expected(
                command_name,
                "Missing, expired, or already-used destructive confirmation token",
            ),
        );
    };

    if record.operation != operation || record.target != target {
        return Err(
            crate::commands::observability::SerializableCommandError::expected(
                command_name,
                "Destructive confirmation token does not match the requested operation",
            ),
        );
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn request_destructive_confirmation_token(
    operation: String,
    target: String,
) -> CommandResult<String> {
    unexpected_command_result(
        "request_destructive_confirmation_token",
        "Failed to issue destructive confirmation token",
        async {
            let scope = DestructiveOperationScope::parse(&operation)?;
            tracing::warn!(
                operation = %scope.as_str(),
                target = %target,
                "Issuing short-lived destructive confirmation token"
            );
            Ok(issue_confirmation_token(scope, target))
        }
        .await,
    )
}

#[cfg(test)]
mod tests {
    use super::{consume_confirmation_token, issue_confirmation_token, DestructiveOperationScope};

    #[test]
    fn confirmation_tokens_are_one_time_operation_scoped_and_target_scoped() {
        let token = issue_confirmation_token(
            DestructiveOperationScope::ResetDatabase,
            "all-data".to_string(),
        );

        assert!(consume_confirmation_token(
            &token,
            DestructiveOperationScope::ResetDatabase,
            "wrong-target",
            "reset_database"
        )
        .is_err());
        assert!(consume_confirmation_token(
            &token,
            DestructiveOperationScope::ResetDatabase,
            "all-data",
            "reset_database"
        )
        .is_err());

        let token = issue_confirmation_token(
            DestructiveOperationScope::ResetDatabase,
            "all-data".to_string(),
        );
        assert!(consume_confirmation_token(
            &token,
            DestructiveOperationScope::ResetDatabase,
            "all-data",
            "reset_database"
        )
        .is_ok());
        assert!(consume_confirmation_token(
            &token,
            DestructiveOperationScope::ResetDatabase,
            "all-data",
            "reset_database"
        )
        .is_err());
    }
}
