import { expect, test } from 'vitest'

const wasabi = require("../pkg");
const fs = require('fs');

test("add.wasm", async () => {
    const buf = fs.readFileSync('./example/add.wasm');
    const arr = new Uint8Array(buf);
    const { instrumented, js } = wasabi.instrument_wasm({ original: arr });
    const res = eval(js);
    const buff = new Uint8Array(instrumented);
    const { instance } = await WebAssembly.instantiate(buff, res);
    expect(instance.exports.add(1, 2)).toBe(3);
});

test("hello.wasm", async () => {
    const buf = fs.readFileSync('./example/hello.wasm');
    const arr = new Uint8Array(buf);
    const { instrumented, js } = wasabi.instrument_wasm({ original: arr });
    const res = eval(js);
    res.env = {print: console.log}
    const buff = new Uint8Array(instrumented);
    const { instance } = await WebAssembly.instantiate(buff, res);
});