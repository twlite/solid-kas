use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=KAS_PAYLOAD_PATH");
    println!("cargo:rerun-if-env-changed=KAS_JS_PAYLOAD");

    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set"));
    let destination = out.join("kas-payload.js");
    let source = env::var_os("KAS_PAYLOAD_PATH").or_else(|| env::var_os("KAS_JS_PAYLOAD"));

    match source {
        Some(path) => {
            let path = PathBuf::from(path);
            println!("cargo:rerun-if-changed={}", path.display());
            fs::copy(&path, &destination).unwrap_or_else(|error| {
                panic!("failed to embed KAS payload {}: {error}", path.display())
            });
        }
        None => fs::write(&destination, []).expect("write empty development payload"),
    }
}
