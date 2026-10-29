//! Interface mínima com o JavaScript, sem wasm-bindgen: o JS reserva memória,
//! escreve o pedido em JSON e recebe o resultado em JSON.

use serde::{Serialize, de::DeserializeOwned};

use crate::{Circuit, TransientRequest, solve, transient};

#[unsafe(no_mangle)]
pub extern "C" fn sim_alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Libera memória criada por `sim_alloc` ou devolvida por `sim_solve`/`sim_transient`.
///
/// # Safety
/// `ptr` e `cap` precisam vir de uma dessas funções, e só podem ser liberados uma vez.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sim_free(ptr: *mut u8, cap: usize) {
    unsafe { drop(Vec::from_raw_parts(ptr, 0, cap)) };
}

/// Lê o pedido, chama `f` e devolve `{"ok": ...}` ou `{"error": "..."}`.
/// O retorno empacota ponteiro (32 bits altos) e tamanho (32 bits baixos).
unsafe fn call<I: DeserializeOwned, O: Serialize>(
    ptr: *const u8,
    len: usize,
    f: impl Fn(&I) -> Result<O, String>,
) -> u64 {
    let input = unsafe { std::slice::from_raw_parts(ptr, len) };
    let out = match serde_json::from_slice::<I>(input) {
        Ok(req) => match f(&req) {
            Ok(res) => serde_json::json!({ "ok": res }),
            Err(e) => serde_json::json!({ "error": e }),
        },
        Err(e) => serde_json::json!({ "error": format!("pedido inválido: {e}") }),
    };
    let mut bytes = serde_json::to_vec(&out).unwrap_or_default();
    bytes.shrink_to_fit();
    let (p, l) = (bytes.as_mut_ptr(), bytes.len());
    std::mem::forget(bytes);
    ((p as u64) << 32) | l as u64
}

/// Ponto de operação (DC) de um `Circuit`.
///
/// # Safety
/// `ptr..ptr+len` precisa ser memória válida criada por `sim_alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sim_solve(ptr: *const u8, len: usize) -> u64 {
    unsafe { call::<Circuit, _>(ptr, len, solve) }
}

/// Simulação no tempo a partir de um `TransientRequest`.
///
/// # Safety
/// `ptr..ptr+len` precisa ser memória válida criada por `sim_alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sim_transient(ptr: *const u8, len: usize) -> u64 {
    unsafe { call::<TransientRequest, _>(ptr, len, transient) }
}
