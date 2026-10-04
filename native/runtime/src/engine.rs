use crate::{model::Model, protocol::ModuleGraph};
use rquickjs::{
    Context, Ctx, Error, Function, Module, Object, Runtime,
    loader::{ImportAttributes, Loader, Resolver},
    module::Declared,
};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
    sync::Arc,
};

#[derive(Clone)]
struct GraphModules(Arc<HashMap<String, String>>);

impl Resolver for GraphModules {
    fn resolve<'js>(
        &mut self,
        _ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<String> {
        if self.0.contains_key(name) {
            return Ok(name.to_string());
        }
        if name.starts_with('.') {
            let base = base.split('?').next().unwrap_or(base);
            let directory = base.rsplit_once('/').map(|(left, _)| left).unwrap_or("");
            let combined = format!("{directory}/{name}");
            let mut parts = Vec::new();
            for part in combined.split('/') {
                match part {
                    "" | "." => {}
                    ".." => {
                        parts.pop();
                    }
                    other => parts.push(other),
                }
            }
            let resolved = format!("/{}", parts.join("/"));
            if self.0.contains_key(&resolved) {
                return Ok(resolved);
            }
        }
        Err(Error::new_resolving_message(
            base,
            name,
            "module is absent from the Vite graph",
        ))
    }
}

impl Loader for GraphModules {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> rquickjs::Result<Module<'js, Declared>> {
        let source = self.0.get(name).ok_or_else(|| {
            Error::new_loading_message(name, "module is absent from the Vite graph")
        })?;
        Module::declare(ctx.clone(), name, source.as_bytes())
    }
}

pub struct Engine {
    _runtime: Runtime,
    context: Context,
    disposed: Cell<bool>,
}

fn js_error(operation: &'static str, error: impl ToString) -> Error {
    Error::new_from_js_message("Rust KAS host", operation, error.to_string())
}

impl Engine {
    pub fn load(graph: &ModuleGraph, model: Rc<RefCell<Model>>) -> Result<Self, String> {
        graph.validate()?;
        model.borrow_mut().clear();
        let modules = Arc::new(
            graph
                .modules
                .iter()
                .map(|(id, module)| (id.clone(), module.code.clone()))
                .collect::<HashMap<_, _>>(),
        );
        let runtime = Runtime::new().map_err(|error| error.to_string())?;
        runtime.set_max_stack_size(2 * 1024 * 1024);
        runtime.set_loader(GraphModules(modules.clone()), GraphModules(modules));
        let context = Context::full(&runtime).map_err(|error| error.to_string())?;

        context
            .with(|ctx| -> rquickjs::Result<()> {
                let host = Object::new(ctx.clone())?;

                let state = model.clone();
                host.set(
                    "createElement",
                    Function::new(ctx.clone(), move |kind: u32| {
                        state
                            .borrow_mut()
                            .create_element(kind)
                            .map_err(|error| js_error("createElement", error))
                    })?,
                )?;

                let state = model.clone();
                host.set(
                    "createText",
                    Function::new(ctx.clone(), move |value: String| {
                        Ok::<_, Error>(state.borrow_mut().create_text(value))
                    })?,
                )?;

                let state = model.clone();
                host.set(
                    "insert",
                    Function::new(
                        ctx.clone(),
                        move |parent: u32, child: u32, anchor: Option<u32>| {
                            state
                                .borrow_mut()
                                .insert(parent, child, anchor)
                                .map_err(|error| js_error("insert", error))
                        },
                    )?,
                )?;

                let state = model.clone();
                host.set(
                    "remove",
                    Function::new(ctx.clone(), move |parent: u32, child: u32| {
                        state
                            .borrow_mut()
                            .remove(parent, child)
                            .map_err(|error| js_error("remove", error))
                    })?,
                )?;

                let state = model.clone();
                host.set(
                    "setText",
                    Function::new(ctx.clone(), move |handle: u32, value: String| {
                        state
                            .borrow_mut()
                            .set_text(handle, value)
                            .map_err(|error| js_error("setText", error))
                    })?,
                )?;

                let state = model.clone();
                host.set(
                    "setOnClick",
                    Function::new(ctx.clone(), move |handle: u32, callback: u32| {
                        state
                            .borrow_mut()
                            .set_on_click(handle, callback)
                            .map_err(|error| js_error("setOnClick", error))
                    })?,
                )?;

                let state = model.clone();
                host.set(
                    "dispose",
                    Function::new(ctx.clone(), move |handle: u32| {
                        state
                            .borrow_mut()
                            .dispose(handle)
                            .map_err(|error| js_error("dispose", error))
                    })?,
                )?;
                host.set("root", 0_u32)?;
                ctx.globals().set("__kas", host)?;

                let entry = graph.modules.get(&graph.entry).expect("validated entry");
                let evaluation =
                    Module::evaluate(ctx.clone(), graph.entry.as_str(), entry.code.as_bytes())
                        .and_then(|module| module.finish::<()>());
                if let Err(error) = evaluation {
                    let detail = if error.is_exception() {
                        format!("{:?}", ctx.catch())
                    } else {
                        error.to_string()
                    };
                    return Err(rquickjs::Error::new_from_js_message(
                        "QuickJS evaluation",
                        "Rust KAS host",
                        detail,
                    ));
                }
                Ok(())
            })
            .map_err(|error| format!("QuickJS evaluation failed: {error}"))?;

        Ok(Self {
            _runtime: runtime,
            context,
            disposed: Cell::new(false),
        })
    }

    pub fn dispatch(&self, callback: u32) -> Result<(), String> {
        self.context
            .with(|ctx| -> rquickjs::Result<()> {
                let dispatch: Function = ctx.globals().get("__kas_dispatch")?;
                dispatch.call::<_, ()>((callback,))
            })
            .map_err(|error| format!("QuickJS callback failed: {error}"))
    }

    pub fn dispose(&self) {
        if self.disposed.replace(true) {
            return;
        }
        let _ = self.context.with(|ctx| -> rquickjs::Result<()> {
            if let Ok(dispose) = ctx.globals().get::<_, Function>("__kas_dispose") {
                dispose.call::<_, ()>(())?;
            }
            Ok(())
        });
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.dispose();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_operations_execute_inside_quickjs() {
        let model = Rc::new(RefCell::new(Model::default()));
        let graph = ModuleGraph::production(
            r#"
            const column = globalThis.__kas.createElement(0);
            const text = globalThis.__kas.createText("0");
            globalThis.__kas.insert(0, column, null);
            globalThis.__kas.insert(column, text, null);
            globalThis.__kas.setText(text, "1");
            "#
            .into(),
        );
        let _engine = Engine::load(&graph, model.clone()).unwrap();
        assert_eq!(
            model
                .borrow()
                .display_text(model.borrow().root_children()[0])
                .unwrap(),
            "1"
        );
    }

    #[test]
    fn disposal_is_idempotent_across_reload_and_drop() {
        let model = Rc::new(RefCell::new(Model::default()));
        let graph = ModuleGraph::production(
            r#"
            globalThis.disposeCount = 0;
            globalThis.__kas_dispose = () => {
                globalThis.disposeCount += 1;
            };
            "#
            .into(),
        );
        let engine = Engine::load(&graph, model).unwrap();
        engine.dispose();
        engine.dispose();
        let count = engine
            .context
            .with(|ctx| ctx.globals().get::<_, u32>("disposeCount").unwrap());
        assert_eq!(count, 1);
    }
}
