fn main() {
    #[cfg(target_os = "linux")]
    println!("cargo:rustc-link-lib=gtk-layer-shell");
    tauri_build::build()
}
