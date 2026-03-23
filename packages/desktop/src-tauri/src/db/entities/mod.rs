//! Sea ORM entities

pub mod prelude;

pub mod api_key;
pub mod app_setting;
pub mod checkpoint;
pub mod file_snapshot;
pub mod project;
pub mod session_metadata;
pub mod session_review_state;
pub mod skill;
pub mod skill_sync_history;
pub mod skill_sync_target;
pub mod sql_connection;
pub mod sql_query_history;
pub mod user_keybinding;

pub use api_key::Entity as ApiKey;
pub use app_setting::Entity as AppSetting;
pub use checkpoint::Entity as Checkpoint;
pub use file_snapshot::Entity as FileSnapshot;
pub use project::Entity as Project;
pub use session_metadata::Entity as SessionMetadata;
pub use session_review_state::Entity as SessionReviewState;
pub use skill::Entity as Skill;
pub use skill_sync_history::Entity as SkillSyncHistory;
pub use skill_sync_target::Entity as SkillSyncTarget;
pub use sql_connection::Entity as SqlConnection;
pub use sql_query_history::Entity as SqlQueryHistory;
pub use user_keybinding::Entity as UserKeybinding;
