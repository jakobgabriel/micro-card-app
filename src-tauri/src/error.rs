//! One error type for the whole backend. Every variant serialises to a plain
//! sentence, because these strings are shown to the user verbatim.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Could not read or write that folder: {0}")]
    Io(#[from] std::io::Error),

    #[error("No vault is set up yet.")]
    NoVault,

    #[error("Card not found: {0}")]
    NotFound(String),

    #[error("{0}")]
    Message(String),
}

impl Error {
    pub fn msg(text: impl Into<String>) -> Self {
        Error::Message(text.into())
    }
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
