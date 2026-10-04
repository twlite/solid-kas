use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformedModule {
    pub id: String,
    pub code: String,
    #[serde(default)]
    pub imported_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ModuleGraph {
    pub version: u32,
    pub generation: u64,
    pub entry: String,
    pub modules: HashMap<String, TransformedModule>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum HostMessage {
    #[serde(rename = "module_graph")]
    ModuleGraph { graph: ModuleGraph },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum NativeMessage<'a> {
    #[serde(rename = "ready")]
    Ready {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
    },
    #[serde(rename = "error")]
    Error { message: &'a str },
}

impl ModuleGraph {
    pub fn production(code: String) -> Self {
        let entry = "kas:bundle".to_string();
        let module = TransformedModule {
            id: entry.clone(),
            code,
            imported_ids: vec![],
        };
        Self {
            version: PROTOCOL_VERSION,
            generation: 0,
            entry: entry.clone(),
            modules: HashMap::from([(entry, module)]),
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.version != PROTOCOL_VERSION {
            return Err(format!(
                "unsupported protocol version {}, expected {PROTOCOL_VERSION}",
                self.version
            ));
        }
        if !self.modules.contains_key(&self.entry) {
            return Err(format!("entry module {} is absent", self.entry));
        }
        if self.modules.values().any(|module| module.id.is_empty()) {
            return Err("module identifiers cannot be empty".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_protocol_round_trip() {
        let graph = ModuleGraph::production("globalThis.ok = true".into());
        let line = serde_json::to_string(&serde_json::json!({
            "type": "module_graph",
            "graph": graph,
        }))
        .unwrap();
        let parsed: HostMessage = serde_json::from_str(&line).unwrap();
        let HostMessage::ModuleGraph { graph } = parsed;
        assert_eq!(graph.entry, "kas:bundle");
        assert!(graph.validate().is_ok());
    }

    #[test]
    fn rejects_missing_entry() {
        let mut graph = ModuleGraph::production(String::new());
        graph.entry = "missing".into();
        assert!(graph.validate().unwrap_err().contains("absent"));
    }
}
