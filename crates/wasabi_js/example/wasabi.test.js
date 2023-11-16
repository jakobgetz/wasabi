import { expect, test } from 'vitest'

const wasabi = require("../pkg");
const fs = require('fs');

// Binary from https://github.com/danleh/wasabi/blob/fe12347f3557ca1db64b33ce9a83026143fa2e3f/tutorial-pldi2019/task0/2-add/add.wat
test("add.wasm", async () => {
    const { buff, res } = setup('example/add.wasm');
    const { instance } = await WebAssembly.instantiate(buff, res);
    expect(instance.exports.add(1, 2)).toBe(3);
});

// Binary from https://github.com/danleh/wasabi/blob/fe12347f3557ca1db64b33ce9a83026143fa2e3f/tutorial-pldi2019/task0/1-hello/hello.wat
test("hello.wasm", async () => {
    const { buff, res } = setup('example/add.wasm');
    const arr = new Uint8Array(buff);
    const { instance } = await WebAssembly.instantiate(buff, res);
});

// Binary from https://gist.github.com/doehyunbaek/3ffa3140c41b7283bf35f34d4d9ecf64
test("global.wasm", async () => {
    const { buff, res } = setup('example/global.wasm');
    res.console = console
    res.env = {from_js: new WebAssembly.Global({value: "i64", mutable: false}, 0n)}
    const { instance } = await WebAssembly.instantiate(buff, res);
    expect(instance.exports.export_global()).toBe(10n)
});

// Binary from https://gist.github.com/doehyunbaek/3ffa3140c41b7283bf35f34d4d9ecf64
test("heatmap.wasm", async () => {
    const { buff, res } = setup('example/heatmap.wasm');
    res.go = {
        // Go's SP does not change as long as no Go code is running. Some operations (e.g. calls, getters and setters)
        // may synchronously trigger a Go event handler. This makes Go code get executed in the middle of the imported
        // function. A goroutine can switch to a new stack if the current stack is too small (see morestack function).
        // This changes the SP, thus we have to update the SP used by the imported function.

        // func wasmExit(code int32)
        "runtime.wasmExit": (sp) => {
            const code = mem().getInt32(sp + 8, true);
            this.exited = true;
            delete this._inst;
            delete this._values;
            delete this._refs;
            this.exit(code);
        },

        // func wasmWrite(fd uintptr, p unsafe.Pointer, n int32)
        "runtime.wasmWrite": (sp) => {
            const fd = getInt64(sp + 8);
            const p = getInt64(sp + 16);
            const n = mem().getInt32(sp + 24, true);
            fs.writeSync(fd, new Uint8Array(this._inst.exports.mem.buffer, p, n));
        },

        // func nanotime() int64
        "runtime.nanotime": (sp) => {
            setInt64(sp + 8, (timeOrigin + performance.now()) * 1000000);
        },

        // func walltime() (sec int64, nsec int32)
        "runtime.walltime": (sp) => {
            const msec = (new Date).getTime();
            setInt64(sp + 8, msec / 1000);
            mem().setInt32(sp + 16, (msec % 1000) * 1000000, true);
        },

        // func scheduleTimeoutEvent(delay int64) int32
        "runtime.scheduleTimeoutEvent": (sp) => {
            const id = this._nextCallbackTimeoutID;
            this._nextCallbackTimeoutID++;
            this._scheduledTimeouts.set(id, setTimeout(
                () => {
                    this._resume();
                    while (this._scheduledTimeouts.has(id)) {
                        // for some reason Go failed to register the timeout event, log and try again
                        // (temporary workaround for https://github.com/golang/go/issues/28975)
                        console.warn("scheduleTimeoutEvent: missed timeout event");
                        this._resume();
                    }
                },
                getInt64(sp + 8) + 1, // setTimeout has been seen to fire up to 1 millisecond early
            ));
            mem().setInt32(sp + 16, id, true);
        },

        // func clearTimeoutEvent(id int32)
        "runtime.clearTimeoutEvent": (sp) => {
            const id = mem().getInt32(sp + 8, true);
            clearTimeout(this._scheduledTimeouts.get(id));
            this._scheduledTimeouts.delete(id);
        },

        // func getRandomData(r []byte)
        "runtime.getRandomData": (sp) => {
            crypto.getRandomValues(loadSlice(sp + 8));
        },

        // func stringVal(value string) ref
        "syscall/js.stringVal": (sp) => {
            storeValue(sp + 24, loadString(sp + 8));
        },

        // func valueGet(v ref, p string) ref
        "syscall/js.valueGet": (sp) => {
            const result = Reflect.get(loadValue(sp + 8), loadString(sp + 16));
            sp = this._inst.exports.getsp(); // see comment above
            storeValue(sp + 32, result);
        },

        // func valueSet(v ref, p string, x ref)
        "syscall/js.valueSet": (sp) => {
            Reflect.set(loadValue(sp + 8), loadString(sp + 16), loadValue(sp + 32));
        },

        // func valueIndex(v ref, i int) ref
        "syscall/js.valueIndex": (sp) => {
            storeValue(sp + 24, Reflect.get(loadValue(sp + 8), getInt64(sp + 16)));
        },

        // valueSetIndex(v ref, i int, x ref)
        "syscall/js.valueSetIndex": (sp) => {
            Reflect.set(loadValue(sp + 8), getInt64(sp + 16), loadValue(sp + 24));
        },

        // func valueCall(v ref, m string, args []ref) (ref, bool)
        "syscall/js.valueCall": (sp) => {
            try {
                const v = loadValue(sp + 8);
                const m = Reflect.get(v, loadString(sp + 16));
                const args = loadSliceOfValues(sp + 32);
                const result = Reflect.apply(m, v, args);
                sp = this._inst.exports.getsp(); // see comment above
                storeValue(sp + 56, result);
                mem().setUint8(sp + 64, 1);
            } catch (err) {
                storeValue(sp + 56, err);
                mem().setUint8(sp + 64, 0);
            }
        },

        // func valueInvoke(v ref, args []ref) (ref, bool)
        "syscall/js.valueInvoke": (sp) => {
            try {
                const v = loadValue(sp + 8);
                const args = loadSliceOfValues(sp + 16);
                const result = Reflect.apply(v, undefined, args);
                sp = this._inst.exports.getsp(); // see comment above
                storeValue(sp + 40, result);
                mem().setUint8(sp + 48, 1);
            } catch (err) {
                storeValue(sp + 40, err);
                mem().setUint8(sp + 48, 0);
            }
        },

        // func valueNew(v ref, args []ref) (ref, bool)
        "syscall/js.valueNew": (sp) => {
            try {
                const v = loadValue(sp + 8);
                const args = loadSliceOfValues(sp + 16);
                const result = Reflect.construct(v, args);
                sp = this._inst.exports.getsp(); // see comment above
                storeValue(sp + 40, result);
                mem().setUint8(sp + 48, 1);
            } catch (err) {
                storeValue(sp + 40, err);
                mem().setUint8(sp + 48, 0);
            }
        },

        // func valueLength(v ref) int
        "syscall/js.valueLength": (sp) => {
            setInt64(sp + 16, parseInt(loadValue(sp + 8).length));
        },

        // valuePrepareString(v ref) (ref, int)
        "syscall/js.valuePrepareString": (sp) => {
            const str = encoder.encode(String(loadValue(sp + 8)));
            storeValue(sp + 16, str);
            setInt64(sp + 24, str.length);
        },

        // valueLoadString(v ref, b []byte)
        "syscall/js.valueLoadString": (sp) => {
            const str = loadValue(sp + 8);
            loadSlice(sp + 16).set(str);
        },

        // func valueInstanceOf(v ref, t ref) bool
        "syscall/js.valueInstanceOf": (sp) => {
            mem().setUint8(sp + 24, loadValue(sp + 8) instanceof loadValue(sp + 16));
        },

        // func copyBytesToGo(dst []byte, src ref) (int, bool)
        "syscall/js.copyBytesToGo": (sp) => {
            const dst = loadSlice(sp + 8);
            const src = loadValue(sp + 32);
            if (!(src instanceof Uint8Array || src instanceof Uint8ClampedArray)) {
                mem().setUint8(sp + 48, 0);
                return;
            }
            const toCopy = src.subarray(0, dst.length);
            dst.set(toCopy);
            setInt64(sp + 40, toCopy.length);
            mem().setUint8(sp + 48, 1);
        },

        // func copyBytesToJS(dst ref, src []byte) (int, bool)
        "syscall/js.copyBytesToJS": (sp) => {
            const dst = loadValue(sp + 8);
            const src = loadSlice(sp + 16);
            if (!(dst instanceof Uint8Array || dst instanceof Uint8ClampedArray)) {
                mem().setUint8(sp + 48, 0);
                return;
            }
            const toCopy = src.subarray(0, dst.length);
            dst.set(toCopy);
            setInt64(sp + 40, toCopy.length);
            mem().setUint8(sp + 48, 1);
        },

        "debug": (value) => {
            console.log(value);
        },
    }
    const { instance } = await WebAssembly.instantiate(buff, res);
});


function setup(path) {
    const buf = fs.readFileSync(path);
    const arr = new Uint8Array(buf);
    const { instrumented, js } = wasabi.instrument_wasm(arr);
    const res = eval(js);
    const buff = new Uint8Array(instrumented);
    return { buff, res };
}