#![feature(attr_literals, specialization, conservative_impl_trait, test)]

#[macro_use]
extern crate custom_derive;
extern crate byteorder;
extern crate rayon;
extern crate walkdir;
extern crate clap;
extern crate test;

use ast::Module;
use binary::WasmBinary;
use clap::{App, Arg};
use std::fs::File;
use std::io::{self, BufReader, BufWriter};

mod leb128;
mod ast;
mod binary;
mod instrument;
mod display;
#[cfg(test)]
mod tests;

// TODO "streaming AST" API: return Module {} after reading only the first 8 bytes, implement
// Iterator<Item = Section> for Module -> Module must somehow retain the reader to do so...

fn main() {
    let args = App::new("wasm-instrument")
        .arg(Arg::with_name("silent").short("s").long("silent"))
        .arg(Arg::with_name("input").required(true))
        .arg(Arg::with_name("output").short("o").takes_value(true).required(true))
        .arg(Arg::with_name("instrumentation").default_value("identity"))
        .get_matches();

    let silent = args.is_present("silent");
    let input = args.value_of("input").unwrap();
    let output = args.value_of("output").unwrap();
    let instrument = match args.value_of("instrumentation").unwrap() {
        "identity" => instrument::identity,
        "add" => instrument::add_trivial_function_type,
        instrumentation => unimplemented!("instrumentation {}", instrumentation)
    };

    std::process::exit(match || -> io::Result<()> {
        let module = Module::decode(&mut BufReader::new(File::open(input)?))?;

        if !silent {
            println!("before: {:?}", module);
        }

        let module = instrument(module);

        if !silent {
            println!("after: {:?}", module);
        }

        let bytes_written = module.encode(&mut BufWriter::new(File::create(output)?))?;
        println!("written encoded Module to {}, {} bytes", output, bytes_written);
        Ok(())
    }() {
        Ok(_) => 0,
        Err(ref e) => {
            eprintln!("error: {}", e);
            1
        }
    });
}