function setupAnalysis(Wasabi) {
  class Trace {
    trace;
    constructor() {
      this.trace = [];
    }
    push(event) {
      console.log(JSON.stringify(event));
      this.trace.push(event);
    }
    toString() {
      return this.trace.join(`\n`);
    }
  }

  class Analysis {
    trace = new Trace();
    Wasabi;
    // shadow stuff
    funcrefToIdx;
    // helpers
    callStack = [{ idx: -1 }];
    MEM_PAGE_SIZE = 65536;
    getResult() {
      return this.trace;
    }
    constructor(Wasabi, options = { extended: false }) {
      this.Wasabi = Wasabi;
      Wasabi.analysis = {
        begin_function: (location, args) => {
          if (this.callStack[this.callStack.length - 1] !== "int") {
            const exportName =
              this.Wasabi.module.info.functions[location.func].export[0];
            const CALLED_WITH_TABLE_GET = exportName === undefined;
            if (CALLED_WITH_TABLE_GET) {
              if (
                !this.tables.some((table, i) => {
                  for (
                    let tableIndex = 0;
                    tableIndex < table.length;
                    tableIndex++
                  ) {
                    const funcidx = this.resolveFuncIdx(table, tableIndex);
                    if (funcidx === location.func) {
                      this.trace.push(
                        `TC;${location.func};${this.getName(
                          this.Wasabi.module.info.tables[i]
                        )};${tableIndex};${args.join(",")}`
                      );
                      return true;
                    }
                  }
                  return false;
                })
              ) {
                console.log(location);
                throw new Error(
                  "The function you where calling from outside the wasm module is neither exported nor in a table..."
                );
              }
            } else {
              this.trace.push(
                `EC;${location.func};${exportName};${args.join(",")}`
              );
              this.checkMemGrow();
              // this.checkTableGrow();
            }
          }
          this.callStack.push("int");
        },
        store: (location, op, memarg, value) => {
          const addr = memarg.addr + memarg.offset;
          if (this.shadowMemories.length === 0) {
            return;
          }
          let byteLength = this.getByteLength(op);
          for (let i = 0; i < byteLength; i++) {
            const value = new Uint8Array(this.memories[0].buffer)[
              addr + i
            ];
            new Uint8Array(this.shadowMemories[0].buffer)[addr + i] = value;
          }
        },
        memory_grow: (location, deltaPages, previousSizePages) => {
          // TODO: get from Wasabi
          const memoryIdx = 0;
          if (this.shadowMemories.length === 0) {
            return;
          }
          this.growShadowMem(memoryIdx, deltaPages);
        },
        load: (location, op, memarg, value) => {
          // TODO: get memIdx from Wasabi
          const memIdx = 0
          if (this.shadowMemories.length === 0) {
            return;
          }
          const addr = memarg.addr + memarg.offset;
          const memName = this.getName(
            Wasabi.module.info.memories[memIdx]
          );
          let byteLength = this.getByteLength(op);
          if (!this.mem_content_equals(memIdx, addr, byteLength)) {
            for (let i = 0; i < byteLength; i++) {
              let r = new Uint8Array(this.memories[0].buffer)[
                addr + i
              ];
              new Uint8Array(this.shadowMemories[0].buffer)[addr + i] = new Uint8Array(
                this.memories[0].buffer
              )[addr + i];
              new Uint8Array(this.memories[0].buffer)[addr + i] =
                r;
              this.trace.push(`L;${0};${memName};${addr + i};${[r]}`);
            }
          }
        },
        global: (location, op, globalIndex, value) => {
          if (op === "global.set") {
            this.shadowGlobals[globalIndex].value = value;
            return;
          }
          if (op === "global.get") {
            if ((this.shadowGlobals[globalIndex].value !== value) && !(Number.isNaN(this.shadowGlobals[globalIndex].value) && Number.isNaN(value))) {
              this.trace.push(
                `G;${globalIndex};${value}`
              );
              this.shadowGlobals[globalIndex].value = value;
            }
          }
        },
        call_pre: (location, targetFunc, args, indirectTableIdx) => {
          // call indirect case
          if (targetFunc == undefined) {
            // TODO: get tableIdx from Wasabi
            const tableIdx = 0;
            targetFunc = this.funcrefToIdx.get(this.shadowTables[tableIdx].get(indirectTableIdx));
          }
          let funcImport = Wasabi.module.info.functions[targetFunc].import;
          if (funcImport !== null) {
            this.callStack.push({ idx: targetFunc });
            this.trace.push(`IC;${targetFunc}`);
          }
        },
        call_post: (location, values) => {
          const func = this.callStack[this.callStack.length - 1];
          if (func === "int") {
            return;
          }
          this.callStack.pop();
          this.trace.push(`IR;${func.idx};${values.join(",")}`);
          this.checkMemGrow();
          // this.checkTableGrow();
        },
        return_: (location, values) => {
          this.callStack.pop();
          if (this.callStack.length === 1) {
            this.trace.push(`ER`);
          }
        },
        table_set: (location, target, value) => {
          this.shadowTables[target.tableIdx].set(target.elemIdx, value);
        },
        table_get: (location, target, value) => {
          this.tableGetEvent(target.tableIdx, target.elemIdx);
        },
      };
    }
    mem_content_equals(memIdx, addr, numBytes) {
      let result = [];
      for (let i = 0; i < numBytes; i++) {
        const data = new Uint8Array(this.memories[memIdx].buffer)[
          addr + i
        ];
        if (new Uint8Array(this.shadowMemories[memIdx].buffer)[addr + i] !== data)
          return false;
      }
      return true;
    }
    resolveFuncIdx(table, idx) {
      let resolvedFuncIdx = parseInt(table.get(idx).name);
      if (
        resolvedFuncIdx >= this.Wasabi.module.info.originalFunctionImportsCount
      ) {
        resolvedFuncIdx =
          resolvedFuncIdx -
          Object.keys(this.Wasabi.module.lowlevelHooks).length;
      }
      return resolvedFuncIdx;
    }
    tableGetEvent(tableidx, idx) {
      let table = this.tables[tableidx]
      let shadowTable = this.shadowTables[tableidx]
      if (shadowTable.get(idx) !== table.get(idx)) {
        let name = this.getName(this.Wasabi.module.info.tables[tableidx])
        let funcidx = this.resolveFuncIdx(table, idx)
        this.stats.relevantTableGets++;
        this.trace.push(`T;${tableidx};${name};${idx};${funcidx}`)
        shadowTable.set(0, table.get(idx))
      }
    }
    checkMemGrow() {
      window.mems = this.memories
      this.memories.forEach((mem, idx) => {
        if (mem.buffer.byteLength !== this.shadowMemories[idx].buffer.byteLength) {
          let memGrow = {};
          let amount =
            mem.buffer.byteLength / this.MEM_PAGE_SIZE -
            this.shadowMemories[idx].buffer.byteLength / this.MEM_PAGE_SIZE;
          memGrow[idx] = amount;
          this.growShadowMem(idx, amount);
          this.trace.push(
            `MG;${idx};${this.getName(
              this.Wasabi.module.info.memories[idx]
            )};${amount}`
          );
        }
      });
    }
    growShadowMem(memIdx, byPages) {
      const currentPages = this.shadowMemories[memIdx].buffer.byteLength / this.MEM_PAGE_SIZE;
      const newPages = currentPages + byPages;
      const newShadow = new WebAssembly.Memory({ initial: newPages, maximum: newPages });
      new Uint8Array(newShadow.buffer).set(new Uint8Array(this.shadowMemories[memIdx].buffer));
      this.shadowMemories[memIdx] = newShadow;
    }
    // checkTableGrow() {
    //   this.tables.forEach((t, idx) => {
    //     if (t.length !== this.shadowTables[idx].length) {
    //       let tableGrow = {};
    //       let amount =
    //         this.tables[idx].length -
    //         this.shadowTables[idx].length;
    //       tableGrow[idx] = amount;
    //       this.growShadowTable(idx, amount);
    //       this.trace.push(
    //         `TG;${idx};${this.getName(
    //           this.Wasabi.module.info.tables[0]
    //         )};${amount}`
    //       );
    //     }
    //   });
    // }
    // growShadowTable(tableIdx, amount) {
    //   const newShadow = new WebAssembly.Table({
    //     initial: this.tables[0].length,
    //     element: "anyfunc",
    //   });
    //   for (let i = 0; i < this.tables[tableIdx].length; i++) {
    //     newShadow.set(i, this.tables[tableIdx].get(i));
    //   }
    //   this.shadowTables[0] = newShadow;
    // }
    getName(entity) {
      if (entity.import !== null) {
        return entity.import[1];
      } else {
        return entity.export[0];
      }
    }
    /**
     * @example 'i32.load' => 4
     * 'i32.load16' => 2
     * 'i64.store' => 8
     * 'i64.store8_u' => 1
     */
    getByteLength(instr) {
      let typeIndex = 9;
      if (instr.charAt(4) === "l") {
        typeIndex = 8;
      }
      if (instr.charAt(typeIndex) === "8") {
        return parseInt(instr.charAt(typeIndex)) / 8;
      } else if (
        instr.charAt(typeIndex) === "1" ||
        instr.charAt(typeIndex) === "3"
      ) {
        return parseInt(instr.substring(typeIndex, typeIndex + 2)) / 8;
      }
      return parseInt(instr.substring(1, 3)) / 8;
    }
    init() {
      this.memories = []
      this.tables = []
      this.globals = []
      this.shadowMemories = []
      this.shadowTables = []
      this.shadowGlobals = []
      this.funcrefToIdx = new Map();
      for (let exp in this.Wasabi.module.exports) {
        let funcref = this.Wasabi.module.exports[exp];
        if (typeof funcref == "function") {
          let fidx;
          this.Wasabi.module.info.functions.forEach((f, i) => {
            if (f.export !== null && f.export[0] === exp) {
              fidx = i;
            }
          });
          this.funcrefToIdx.set(funcref, fidx);
        }
      }
      this.Wasabi.module.info.memories.forEach((memInfo) => {
        const { initial, maximum, } = memInfo;
        const originalMemory = this.Wasabi.module.exports[memInfo.export[0]];
        // TODO: make this set by maximum
        const shadowMemory = new WebAssembly.Memory({ initial, maximum: initial });
        // when the memory is not imported, the initial content is completely determined by the wasm binary
        if (memInfo.import === null) new Uint8Array(shadowMemory.buffer).set(new Uint8Array(originalMemory.buffer));
        this.memories.push(originalMemory);
        this.shadowMemories.push(shadowMemory);
      });
      this.Wasabi.module.info.tables.forEach((tableInfo) => {
        const { initial, maximum, refType } = tableInfo;
        let element;
        if (refType === "funcref") {
          element = "anyfunc";
        } else if (refType === "externref") {
          element = "externref";
        } else {
          throw new Error(`Unsupported refType: ${refType}`);
        }
        const originalTable = this.Wasabi.module.exports[tableInfo.export[0]];
        let shadowTable;
        if (tableInfo.maximum !== null) {
          shadowTable = new WebAssembly.Table({ initial, maximum, element });
        } else {
          shadowTable = new WebAssembly.Table({ initial, element });
        }
        for (let j = 0; j < originalTable.length; j++) {
          shadowTable.set(j, originalTable.get(j));
        }
        this.tables.push(originalTable);
        this.shadowTables.push(shadowTable);
      });
      this.Wasabi.module.info.globals.forEach((globalInfo, idx) => {
        const { valType, mutability } = globalInfo;
        const originalGlobal = this.Wasabi.module.exports[globalInfo.export[0]];

        const value = valType;
        let mutable;
        if (mutability === "Mut") {
          mutable = true;
        } else if (mutability === "Const") {
          mutable = false;
        }
        const shadowGlobal = new WebAssembly.Global({ value, mutable }, originalGlobal.value);
        this.globals.push(originalGlobal);
        this.shadowGlobals.push(shadowGlobal);
        if (globalInfo.import !== null) {
          this.trace.push(`IG;${idx};${originalGlobal.value}`)
        }
      });
    }
  }
  //# sourceMappingURL=tracer.cjs.map
  return new Analysis(Wasabi, { extended: undefined });
}
// in this runtime available available is:
// - setup(wasabiBinary) you need to call this to make the next function available
// - instrument_wasm() a function that takes a wasm buffer and instruments it with wasabi.
// - the setupAnalysis function returns a new Analysis instance when given the Wasabi object
function setup() {
  if (self.monkeypatched === true) {
    return;
  }
  self.monkeypatched = true;
  self.analysis = [];
  self.originalWasmBuffer = [];
  let wasabis = [];
  let i = 0;
  const printWelcome = function () {
    console.log("---------------------------------------------");
    console.log("          Wasabi analysis attached           ");
    console.log("---------------------------------------------");
    console.log("WebAssembly module instantiated.             ");
  };

  const importObjectWithHooks = function (importObject, i) {
    let importObjectWithHooks = importObject || {};
    importObjectWithHooks.__wasabi_hooks = wasabis[i].module.lowlevelHooks;
    return importObjectWithHooks;
  };

  const wireInstanceExports = function (instance, i) {
    wasabis[i].module.exports = instance.exports;
  };
  const binaryString = atob(wasabiBinary);
  const uint8Array = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    uint8Array[i] = binaryString.charCodeAt(i);
  }
  const buffer = uint8Array.buffer;

  initSync(buffer);
  let original_instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = function (buffer, importObject) {
    buffer = buffer.byte ? buffer.byte : buffer;
    // Download the wasm binary
    downloadBinary(buffer);
    const this_i = i;
    i += 1;
    // const p_instantiationTime = performanceEvent(`Time to instantiate wasm module ${this_i}`)
    console.log("WebAssembly.instantiate");
    printWelcome();
    self.originalWasmBuffer.push(Array.from(new Uint8Array(buffer)));
    const { instrumented, js } = instrument_wasm(new Uint8Array(buffer));
    // console.log(js)
    wasabis.push(eval(js + "\nWasabi"));
    buffer = new Uint8Array(instrumented);
    importObject = importObjectWithHooks(importObject, this_i);
    self.analysis.push(setupAnalysis(wasabis[this_i]));
    let result;
    result = original_instantiate(buffer, importObject);
    result.then(({ module, instance }) => {
      wireInstanceExports(instance, this_i);
      self.analysis[this_i].init();
    });
    return result;
  };
  WebAssembly.instantiateStreaming = async function (source, obj) {
    console.log('WebAssembly.instantiateStreaming')
    let response = await source;
    let body = await response.arrayBuffer();
    return WebAssembly.instantiate(body, obj);
  }
  const original_compile = WebAssembly.compile
  WebAssembly.compile = async function (bytes) {
    console.log('WebAssembly.compile')
    const module = await original_compile(bytes)
    module.bytes = bytes
    return module
  }
  WebAssembly.compileStreaming = async function (source) {
    console.log('WebAssembly.compileStreaming')
    const response = await source
    const bytes = await response.arrayBuffer()
    return await WebAssembly.compile(bytes)
  }

  const original_module = WebAssembly.Module
  WebAssembly.Module = function (bytes) {
    console.log('WebAssembly.Module')
    const module = new original_module(bytes)
    module.bytes = bytes
    return module
  }
  const original_instance = WebAssembly.Instance
  WebAssembly.Instance = function (module, importObject) {
    let buffer = module.bytes
    downloadBinary(buffer);
    const this_i = i
    i += 1
    console.log('WebAssembly.Instance')
    printWelcome()
    self.originalWasmBuffer.push(Array.from(new Uint8Array(buffer)))
    const { instrumented, js } = instrument_wasm(new Uint8Array(buffer));
    wasabis.push(eval(js + '\nWasabi'))
    buffer = new Uint8Array(instrumented)
    importObject = importObjectWithHooks(importObject, this_i)
    self.analysis.push(setupAnalysis(wasabis[this_i]))
    let result
    module = new WebAssembly.Module(buffer)
    const instance = new original_instance(module, importObject)
    result = wireInstanceExports(instance, this_i)
    return instance
  }

  function downloadBinary(buffer) {
    // Workaround for workers
    if (typeof window === 'undefined') {
      return;
    }
    let blob = new Blob([buffer], { type: "application/octet-stream" });
    let url = window.URL.createObjectURL(blob);
    let a = document.createElement("a");
    a.href = url;
    a.download = `filename-${i}.txt`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
}
setup();
