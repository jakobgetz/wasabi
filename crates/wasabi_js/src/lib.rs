use serde::{Deserialize, Serialize};
use wasabi::{instrument::add_hooks, options::{HookSet, Hook}};
use wasabi_wasm::Module;
use wasm_bindgen::{prelude::wasm_bindgen, JsValue};

#[derive(Serialize, Deserialize)]
pub struct Input {
    pub original: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
pub struct Output {
    pub instrumented: Vec<u8>,
    pub js: String,
}

#[wasm_bindgen]
pub fn instrument_wasm(val: JsValue) -> Result<JsValue, JsValue> {
    console_error_panic_hook::set_once();
    let Input { original } = serde_wasm_bindgen::from_value(val)?;
    // TODO: make hookset configurable
    let mut _enabled_hooks = HookSet::new();
    for hook in [Hook::Begin, Hook::Call, Hook::Global, Hook::Load, Hook::Store, Hook::MemoryGrow, Hook::TableSet, Hook::TableGet, Hook::End] {
        _enabled_hooks.insert(hook);
    }
    // TODO: make optnodejs configurable
    let opt_nodejs = false;

    let (mut module, _offsets, _warnings) = Module::from_bytes(&original).unwrap();
    let (js, hook_count) = add_hooks(&mut module, _enabled_hooks, opt_nodejs).unwrap();
    let instrumented = module.to_bytes().unwrap();
    println!("inserted {hook_count} low-level hooks");

    let output = Output { instrumented, js };
    Ok(serde_wasm_bindgen::to_value(&output)?)
}
