//! Replays an engine input captured from the browser (the f64 wire buffer, little-endian) and
//! prints where the time goes. Capture inputs with `web/test/capture-engine-input.mjs`.
//!   LF_TIME=1 cargo run --release --example replay -- input.bin [reps]
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).expect("input file");
    let buf: Vec<f64> = bytes.chunks(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect();
    let reps: usize = a.get(2).and_then(|r| r.parse().ok()).unwrap_or(3);
    let mut best = f64::INFINITY;
    for _ in 0..reps {
        let t = std::time::Instant::now();
        let out = lodeflow_layout::codec::run(&buf);
        let ms = t.elapsed().as_secs_f64() * 1e3;
        best = best.min(ms);
        println!("total {ms:.1} ms (output {} values)", out.len());
        if let Ok(path) = std::env::var("LF_OUT") {
            let bytes: Vec<u8> = out.iter().flat_map(|v| v.to_le_bytes()).collect();
            std::fs::write(path, bytes).expect("write output");
        }
    }
    println!("best {best:.1} ms");
}
