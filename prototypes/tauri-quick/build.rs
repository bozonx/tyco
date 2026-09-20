fn main() {
    #[cfg(all(target_os = "linux", feature = "layer"))]
    println!("cargo:rustc-link-lib=gtk-layer-shell");
    tauri_build::build();
}
