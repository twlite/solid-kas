use std::collections::{HashMap, HashSet};
use thiserror::Error;

pub type Handle = u32;
pub const ROOT: Handle = 0;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ElementKind {
    Column,
    Text,
    Button,
    Row,
}

impl TryFrom<u32> for ElementKind {
    type Error = ModelError;

    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Column),
            1 => Ok(Self::Text),
            2 => Ok(Self::Button),
            3 => Ok(Self::Row),
            _ => Err(ModelError::InvalidKind(value)),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NodeKind {
    Root,
    Element(ElementKind),
    Text,
}

#[derive(Clone, Debug)]
pub struct Node {
    pub kind: NodeKind,
    pub text: String,
    pub parent: Option<Handle>,
    pub children: Vec<Handle>,
    pub on_click: Option<u32>,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum ModelError {
    #[error("unknown handle {0}")]
    Unknown(Handle),
    #[error("invalid element kind {0}")]
    InvalidKind(u32),
    #[error("node {0} cannot contain children")]
    CannotContain(Handle),
    #[error("anchor {anchor} is not a child of {parent}")]
    InvalidAnchor { parent: Handle, anchor: Handle },
    #[error("insertion would create a cycle")]
    Cycle,
    #[error("node {child} is not a child of {parent}")]
    NotAChild { parent: Handle, child: Handle },
    #[error("text can only be assigned to text nodes")]
    NotText,
    #[error("click handlers can only be assigned to buttons")]
    NotButton,
}

#[derive(Debug)]
pub struct Model {
    next: Handle,
    nodes: HashMap<Handle, Node>,
}

impl Default for Model {
    fn default() -> Self {
        let mut nodes = HashMap::new();
        nodes.insert(
            ROOT,
            Node {
                kind: NodeKind::Root,
                text: String::new(),
                parent: None,
                children: vec![],
                on_click: None,
            },
        );
        Self { next: 1, nodes }
    }
}

impl Model {
    pub fn clear(&mut self) {
        *self = Self::default();
    }

    pub fn create_element(&mut self, raw_kind: u32) -> Result<Handle, ModelError> {
        let kind = ElementKind::try_from(raw_kind)?;
        Ok(self.allocate(NodeKind::Element(kind), String::new()))
    }

    pub fn create_text(&mut self, text: String) -> Handle {
        self.allocate(NodeKind::Text, text)
    }

    fn allocate(&mut self, kind: NodeKind, text: String) -> Handle {
        let handle = self.next;
        self.next = self
            .next
            .checked_add(1)
            .expect("KAS handle space exhausted");
        self.nodes.insert(
            handle,
            Node {
                kind,
                text,
                parent: None,
                children: vec![],
                on_click: None,
            },
        );
        handle
    }

    pub fn node(&self, handle: Handle) -> Result<&Node, ModelError> {
        self.nodes.get(&handle).ok_or(ModelError::Unknown(handle))
    }

    fn can_contain(&self, handle: Handle) -> Result<bool, ModelError> {
        Ok(!matches!(self.node(handle)?.kind, NodeKind::Text))
    }

    fn is_ancestor(&self, ancestor: Handle, mut node: Handle) -> bool {
        while let Some(current) = self.nodes.get(&node) {
            if ancestor == node {
                return true;
            }
            let Some(parent) = current.parent else { break };
            node = parent;
        }
        false
    }

    pub fn insert(
        &mut self,
        parent: Handle,
        child: Handle,
        anchor: Option<Handle>,
    ) -> Result<(), ModelError> {
        if !self.can_contain(parent)? {
            return Err(ModelError::CannotContain(parent));
        }
        self.node(child)?;
        if child == ROOT || self.is_ancestor(child, parent) {
            return Err(ModelError::Cycle);
        }
        if let Some(anchor) = anchor
            && self.node(anchor)?.parent != Some(parent)
        {
            return Err(ModelError::InvalidAnchor { parent, anchor });
        }

        if let Some(old_parent) = self.node(child)?.parent {
            self.nodes
                .get_mut(&old_parent)
                .unwrap()
                .children
                .retain(|h| *h != child);
        }
        let position = anchor
            .and_then(|anchor| {
                self.nodes[&parent]
                    .children
                    .iter()
                    .position(|h| *h == anchor)
            })
            .unwrap_or(self.nodes[&parent].children.len());
        self.nodes
            .get_mut(&parent)
            .unwrap()
            .children
            .insert(position, child);
        self.nodes.get_mut(&child).unwrap().parent = Some(parent);
        Ok(())
    }

    pub fn remove(&mut self, parent: Handle, child: Handle) -> Result<(), ModelError> {
        if self.node(child)?.parent != Some(parent) {
            return Err(ModelError::NotAChild { parent, child });
        }
        self.dispose(child)
    }

    pub fn dispose(&mut self, handle: Handle) -> Result<(), ModelError> {
        if handle == ROOT {
            let children = self.nodes[&ROOT].children.clone();
            for child in children {
                self.dispose(child)?;
            }
            return Ok(());
        }
        let Some(node) = self.nodes.get(&handle).cloned() else {
            return Ok(());
        };
        if let Some(parent) = node.parent
            && let Some(parent_node) = self.nodes.get_mut(&parent)
        {
            parent_node.children.retain(|h| *h != handle);
        }
        for child in node.children {
            self.dispose(child)?;
        }
        self.nodes.remove(&handle);
        Ok(())
    }

    pub fn set_text(&mut self, handle: Handle, text: String) -> Result<(), ModelError> {
        let node = self
            .nodes
            .get_mut(&handle)
            .ok_or(ModelError::Unknown(handle))?;
        if node.kind != NodeKind::Text {
            return Err(ModelError::NotText);
        }
        node.text = text;
        Ok(())
    }

    pub fn set_on_click(&mut self, handle: Handle, callback: u32) -> Result<(), ModelError> {
        let node = self
            .nodes
            .get_mut(&handle)
            .ok_or(ModelError::Unknown(handle))?;
        if node.kind != NodeKind::Element(ElementKind::Button) {
            return Err(ModelError::NotButton);
        }
        node.on_click = (callback != 0).then_some(callback);
        Ok(())
    }

    pub fn root_children(&self) -> &[Handle] {
        &self.nodes[&ROOT].children
    }

    pub fn display_text(&self, handle: Handle) -> Result<String, ModelError> {
        let mut output = String::new();
        let mut seen = HashSet::new();
        self.append_text(handle, &mut output, &mut seen)?;
        Ok(output)
    }

    fn append_text(
        &self,
        handle: Handle,
        output: &mut String,
        seen: &mut HashSet<Handle>,
    ) -> Result<(), ModelError> {
        if !seen.insert(handle) {
            return Err(ModelError::Cycle);
        }
        let node = self.node(handle)?;
        if node.kind == NodeKind::Text {
            output.push_str(&node.text);
        }
        for child in &node.children {
            self.append_text(*child, output, seen)?;
        }
        seen.remove(&handle);
        Ok(())
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.nodes.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_and_lifecycle_are_validated() {
        let mut model = Model::default();
        let column = model.create_element(0).unwrap();
        let text = model.create_text("zero".into());
        model.insert(ROOT, column, None).unwrap();
        model.insert(column, text, None).unwrap();
        assert_eq!(model.display_text(column).unwrap(), "zero");
        model.set_text(text, "one".into()).unwrap();
        assert_eq!(model.display_text(column).unwrap(), "one");
        assert_eq!(
            model.insert(text, column, None),
            Err(ModelError::CannotContain(text))
        );
        model.remove(ROOT, column).unwrap();
        assert_eq!(model.len(), 1);
    }

    #[test]
    fn event_registration_is_disposed_with_subtree() {
        let mut model = Model::default();
        let button = model.create_element(2).unwrap();
        model.insert(ROOT, button, None).unwrap();
        model.set_on_click(button, 7).unwrap();
        assert_eq!(model.node(button).unwrap().on_click, Some(7));
        model.dispose(button).unwrap();
        assert!(matches!(model.node(button), Err(ModelError::Unknown(_))));
    }

    #[test]
    fn insertion_order_and_reparenting_work() {
        let mut model = Model::default();
        let a = model.create_element(0).unwrap();
        let b = model.create_element(0).unwrap();
        let x = model.create_text("x".into());
        let y = model.create_text("y".into());
        model.insert(ROOT, a, None).unwrap();
        model.insert(ROOT, b, None).unwrap();
        model.insert(a, x, None).unwrap();
        model.insert(a, y, Some(x)).unwrap();
        assert_eq!(model.node(a).unwrap().children, vec![y, x]);
        model.insert(b, x, None).unwrap();
        assert_eq!(model.node(a).unwrap().children, vec![y]);
        assert_eq!(model.node(b).unwrap().children, vec![x]);
    }
}
