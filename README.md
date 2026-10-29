# AutoBlue

Espaço livre para montar circuitos e sistemas embarcados, ver de onde a energia vem e testar tudo num simulador.

Plano completo: [docs/PLANO.md](docs/PLANO.md).

## Rodar

O simulador é Rust compilado para WebAssembly; precisa do alvo uma vez:

```sh
rustup target add wasm32-unknown-unknown
pnpm install
pnpm tauri dev
```

`pnpm test` compila o simulador e roda os testes do front-end; `cargo test --manifest-path crates/sim-core/Cargo.toml` roda os do simulador.

Navegação no canvas: rolar move, Ctrl/pinça dá zoom, Espaço+arrastar ou botão do meio move.
