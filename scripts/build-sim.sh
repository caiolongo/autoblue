#!/bin/sh
# Compila o simulador (crates/sim-core) para WebAssembly e copia para o front-end.
set -e
cd "$(dirname "$0")/.."
cargo build --quiet --manifest-path crates/sim-core/Cargo.toml --target wasm32-unknown-unknown --release
cp crates/sim-core/target/wasm32-unknown-unknown/release/sim_core.wasm src/sim/sim-core.wasm
