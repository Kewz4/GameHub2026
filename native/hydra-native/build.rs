fn main() {
    napi_build::setup();

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/bin/presentmon-bridge.rs");
}
