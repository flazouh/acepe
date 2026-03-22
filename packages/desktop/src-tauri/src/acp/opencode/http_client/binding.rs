use std::path::{Path, PathBuf};

use super::*;

impl OpenCodeHttpClient {
    pub(super) fn normalize_path(path: &Path) -> PathBuf {
        std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
    }

    pub(super) async fn validate_session_binding(&self, session: &Session) -> AcpResult<()> {
        let expected_directory = {
            let manager = self.manager.lock().await;
            manager.project_root().to_path_buf()
        };
        let expected_directory_normalized = Self::normalize_path(&expected_directory);
        let actual_directory_normalized = Self::normalize_path(Path::new(&session.directory));

        if expected_directory_normalized != actual_directory_normalized {
            return Err(AcpError::InvalidState(format!(
                "OpenCode session binding mismatch: expected directory {}, got {}",
                expected_directory_normalized.display(),
                actual_directory_normalized.display()
            )));
        }

        if session.project_id == "global" {
            return Err(AcpError::InvalidState(format!(
                "OpenCode session binding mismatch: expected project key {}, got global",
                self.manager_project_key
            )));
        }

        Ok(())
    }
}
