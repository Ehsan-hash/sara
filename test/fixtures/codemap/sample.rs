use std::collections::HashMap;
use crate::util::{parse, format};

mod util;

/// A thing.
pub struct Thing<'a> {
    name: &'a str,
}

pub enum Kind {
    Small,
    Large,
}

pub trait Describe {
    fn describe(&self) -> String;
}

impl<'a> Describe for Thing<'a> {
    fn describe(&self) -> String {
        let c = '{';
        format!("{}{}", self.name, c)
    }
}

impl<'a> Thing<'a> {
    pub fn new(name: &'a str) -> Self {
        Thing { name }
    }
}

pub fn run(map: HashMap<String, i32>) -> usize {
    map.len()
}

fn private_helper() {}

macro_rules! square {
    ($x:expr) => { $x * $x };
}
