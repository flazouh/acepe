fn main() {
    if let Err(err) = fix_path_env::fix() {
        eprintln!("Failed to sync PATH from shell: {err}");
    }
    acepe_lib::run_sidecar()
}
