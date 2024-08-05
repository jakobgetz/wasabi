const fs = require("fs");
const path = require("path");

const dirname = path.join(path.dirname(path.dirname(__dirname)), 'pkg');

// Create the wasabi runtime
const runtimeWS = fs.createWriteStream(path.join(dirname, "./wasabi_js_merged.js"));
runtimeWS.write(`var wasabiBinary = '`);
runtimeWS.write(fs.readFileSync(path.join(dirname, '/wasabi_js_bg.wasm')).toString('base64'));
runtimeWS.write(`'\n`);
let wasabiJsApi = fs.readFileSync(path.join(dirname, '/wasabi_js.js'), 'utf-8');
wasabiJsApi = wasabiJsApi.replace(/export function/g, 'function');
wasabiJsApi = wasabiJsApi.replace(/let /g, 'var ');
wasabiJsApi = wasabiJsApi.replace(/const /g, 'var ');
wasabiJsApi = wasabiJsApi.replace(/export { initSync }/g, '');
wasabiJsApi = wasabiJsApi.replace(/export default __wbg_init;/g, '');
wasabiJsApi = wasabiJsApi.replace(/input = new URL\('wasabi_js_bg\.wasm', import\.meta\.url\);/g, '');
runtimeWS.write(wasabiJsApi);
runtimeWS.write('\n');
runtimeWS.close();
