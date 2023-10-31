use wasm_bindgen::prelude::*;

pub mod instrument;
pub mod options;

#[cfg(test)]
mod tests;

#[wasm_bindgen]
pub fn instrument(bytes: &[u8], _options: String) -> Vec<u8> {
    let mut module = wasabi_wasm::Module::from_bytes(bytes).unwrap().0;
    instrument::add_hooks(&mut module, options::HookSet::new(), false);
    module.to_bytes().unwrap()
}
