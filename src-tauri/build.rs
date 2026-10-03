fn main() {
    // the target, not the host this script runs on, decides; they differ
    // when cross-compiling
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        println!("cargo:rustc-link-lib=gtk-layer-shell");
    }
    tauri_build::build()
}
