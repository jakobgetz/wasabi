use wasm_bindgen::prelude::*;

pub mod instrument;
pub mod options;

#[cfg(test)]
mod tests;

#[wasm_bindgen]
pub fn instrument(bytes: &[u8]) -> Vec<u8> {
    let module = wasabi_wasm::Module::from_bytes(bytes);
    match module {
        Ok((mut m, _, _)) => {
            instrument::add_hooks(&mut m, options::HookSet::new(), false);
            match m.to_bytes() {
                Ok(r) => r,
                Err(_) => {
                    println!("PANIIIC 2");
                    panic!()
                }
            }
        }
        Err(_) => {
            println!("PANIIIC");
            panic!()
        }
    }
}
