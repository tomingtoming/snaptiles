//! The .rc model format: attribute expressions and the section parser (ports of `src/rc/*`).

pub mod expr;
pub mod parser;

pub use expr::{eval_expr, expr_is_constant, Env};
pub use parser::{count_nodes, find_blocks, parse_rc, Attrs, ChipNode, Dir, KeyBinding, RcModel, RcParseError, Script, ScriptLang, ValDecl};
