// On macOS, compiles the Swift voice helper into the sidecar path Tauri bundles (externalBin).
fn main() {
    #[cfg(target_os = "macos")]
    build_voice_helper();
    tauri_build::build()
}

#[cfg(target_os = "macos")]
fn build_voice_helper() {
    use std::path::PathBuf;
    use std::process::Command;
    println!("cargo:rerun-if-changed=voice/main.swift");
    let target = std::env::var("TARGET").expect("cargo sets TARGET");
    let arch = if target.starts_with("aarch64") { "arm64" } else { "x86_64" };
    let dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets this")).join("binaries");
    std::fs::create_dir_all(&dir).expect("create binaries dir");
    let out = dir.join(format!("roamies-voice-{target}"));
    let status = Command::new("swiftc")
        .args(["-O", "-swift-version", "5", "-target", &format!("{arch}-apple-macos11.0"), "-o"])
        .arg(&out)
        .arg("voice/main.swift")
        .status()
        .expect("swiftc not found (install the Xcode Command Line Tools)");
    assert!(status.success(), "compiling the voice helper failed");
}
