// Loading ONNX Runtime, and --test-ort. The helper doesn't link ONNX Runtime: it loads Microsoft's build at run time
// (fetch-onnxruntime.sh), which picks AVX2/AVX-512 code only on CPUs that have them (#128).

use parakeet_rs::ort::{self, environment::Environment, session::Session, value::Tensor};
use serde_json::json;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Instant;

#[cfg(windows)]
const LIB: &str = "onnxruntime.dll";
#[cfg(target_os = "macos")]
const LIB: &str = "libonnxruntime.dylib";
#[cfg(not(any(windows, target_os = "macos")))]
const LIB: &str = "libonnxruntime.so";

static PATH: OnceLock<PathBuf> = OnceLock::new();

/// The library to load: --ort, else ORT_DYLIB_PATH (dev and tests), else the one beside this helper.
pub fn set_path(path: Option<PathBuf>) {
    let path = path.or_else(|| std::env::var_os("ORT_DYLIB_PATH").map(PathBuf::from)).unwrap_or_else(|| PathBuf::from(LIB));
    let _ = PATH.set(path);
}

/// Loads ONNX Runtime (once) and makes an environment; an error, not a crash, when the library is missing or wrong.
pub fn environment() -> Result<Environment, String> {
    let path = PATH.get().cloned().unwrap_or_else(|| PathBuf::from(LIB));
    // A relative path is looked for beside this helper first (ort's own rule).
    let builder = ort::init_from(&path).map_err(|e| format!("ONNX Runtime didn't load: {e}"))?;
    builder.with_name("roamies-voice").build().map_err(|e| e.to_string())
}

/// --test-ort: load ONNX Runtime and multiply two matrices with it, without the speech model. CI runs it on CPUs
/// without AVX2 too (Intel SDE), where the old prebuilt ONNX Runtime died with an illegal instruction.
pub fn self_check() -> Result<serde_json::Value, String> {
    const N: usize = 64;
    let t0 = Instant::now();
    let env = environment()?;
    let mut session = Session::builder(&env).map_err(|e| e.to_string())?.commit_from_memory(&matmul_model(N as u64)).map_err(|e| e.to_string())?;
    let a: Vec<f32> = (0..N * N).map(|i| ((i / N + i % N) % 7) as f32).collect();
    let b: Vec<f32> = (0..N * N).map(|i| if i / N == i % N { 2.0 } else { 0.0 }).collect();
    let input = |v: Vec<f32>| Tensor::from_array(([N, N], v)).map_err(|e| e.to_string());
    let outputs = session.run(ort::inputs!["a" => input(a.clone())?, "b" => input(b)?]).map_err(|e| e.to_string())?;
    let (_, y) = outputs["y"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
    if y.len() != a.len() || y.iter().zip(&a).any(|(y, a)| *y != 2.0 * a) {
        return Err("MatMul gave the wrong answer".into());
    }
    Ok(json!({ "type": "ort", "ok": true, "build": ort::info(), "seconds": (t0.elapsed().as_secs_f64() * 100.0).round() / 100.0 }))
}

/// A one-node ONNX model, y = MatMul(a, b) on n×n floats, written as protobuf by hand (no ONNX tooling needed).
fn matmul_model(n: u64) -> Vec<u8> {
    fn varint(out: &mut Vec<u8>, mut v: u64) {
        while v >= 0x80 {
            out.push(v as u8 | 0x80);
            v >>= 7;
        }
        out.push(v as u8);
    }
    fn int(out: &mut Vec<u8>, field: u64, v: u64) {
        varint(out, field << 3);
        varint(out, v);
    }
    fn bytes(out: &mut Vec<u8>, field: u64, b: &[u8]) {
        varint(out, field << 3 | 2);
        varint(out, b.len() as u64);
        out.extend_from_slice(b);
    }
    // ValueInfoProto { name, type: TypeProto { tensor_type: { elem_type: FLOAT, shape: [n, n] } } }
    let value = |name: &str| {
        let (mut dim, mut shape, mut tensor, mut ty, mut info) = (vec![], vec![], vec![], vec![], vec![]);
        int(&mut dim, 1, n);
        bytes(&mut shape, 1, &dim);
        bytes(&mut shape, 1, &dim);
        int(&mut tensor, 1, 1);
        bytes(&mut tensor, 2, &shape);
        bytes(&mut ty, 1, &tensor);
        bytes(&mut info, 1, name.as_bytes());
        bytes(&mut info, 2, &ty);
        info
    };
    let (mut node, mut graph, mut opset, mut model) = (vec![], vec![], vec![], vec![]);
    bytes(&mut node, 1, b"a");
    bytes(&mut node, 1, b"b");
    bytes(&mut node, 2, b"y");
    bytes(&mut node, 4, b"MatMul");
    bytes(&mut graph, 1, &node);
    bytes(&mut graph, 2, b"check");
    bytes(&mut graph, 11, &value("a"));
    bytes(&mut graph, 11, &value("b"));
    bytes(&mut graph, 12, &value("y"));
    int(&mut opset, 2, 13);
    int(&mut model, 1, 8); // IR version 8 (ONNX 1.13+)
    bytes(&mut model, 7, &graph);
    bytes(&mut model, 8, &opset);
    model
}
