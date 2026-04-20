mod convert;
mod full_session;
mod scan;
mod text_utils;

pub use convert::convert_full_session_to_entries;
#[cfg(test)]
pub(crate) use convert::parse_converted_session;
pub use full_session::{
    parse_full_session, parse_full_session_from_path, parse_full_session_with_path,
};
pub use scan::{
    extract_thread_metadata, process_cached_entry_for_project, read_messages_from_file,
    read_session_messages, scan_all_threads, scan_projects, scan_projects_streaming,
};

pub(crate) use scan::find_session_file;

pub fn get_session_jsonl_root() -> anyhow::Result<std::path::PathBuf> {
    text_utils::get_session_jsonl_root()
}

pub fn path_to_slug(path: &str) -> String {
    text_utils::path_to_slug(path)
}

#[cfg(test)]
mod tests;
