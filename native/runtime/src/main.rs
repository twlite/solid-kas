mod engine;
mod model;
mod protocol;

use crate::{
    engine::Engine,
    model::{ElementKind, Handle, Model, NodeKind},
    protocol::{HostMessage, ModuleGraph, NativeMessage, PROTOCOL_VERSION},
};
use kas::{prelude::*, runner::AppData as KasAppData, widgets::*};
use std::{
    cell::RefCell,
    env,
    io::{BufRead, BufReader, Write},
    net::TcpStream,
    rc::Rc,
    thread,
    time::Duration,
};

const EMBEDDED_PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/kas-payload.js"));

#[derive(Clone, Debug)]
struct Reload(ModuleGraph);

#[derive(Clone, Debug)]
struct Activate(u32);

#[derive(Clone, Debug)]
struct Refresh;

struct Data {
    model: Rc<RefCell<Model>>,
    engine: RefCell<Option<Engine>>,
    error: RefCell<Option<String>>,
}

impl Data {
    fn new() -> Self {
        Self {
            model: Rc::new(RefCell::new(Model::default())),
            engine: RefCell::new(None),
            error: RefCell::new(None),
        }
    }

    fn reload(&self, graph: &ModuleGraph) {
        if let Some(old) = self.engine.borrow_mut().take() {
            old.dispose();
        }
        self.model.borrow_mut().clear();
        match Engine::load(graph, self.model.clone()) {
            Ok(engine) => {
                self.engine.replace(Some(engine));
                self.error.replace(None);
            }
            Err(error) => {
                eprintln!("[kas] {error}");
                self.error.replace(Some(error));
            }
        }
    }

    fn activate(&self, callback: u32) {
        let result = self
            .engine
            .borrow()
            .as_ref()
            .ok_or_else(|| "QuickJS is not loaded".to_string())
            .and_then(|engine| engine.dispatch(callback));
        if let Err(error) = result {
            eprintln!("[kas] {error}");
            self.error.replace(Some(error));
        }
    }
}

impl KasAppData for Data {
    fn handle_message(&mut self, messages: &mut impl kas::runner::ReadMessage) {
        while messages.pop_erased().is_some() {}
    }
}

type DynWidget = Box<dyn Widget<Data = Data>>;
type RootColumn = Column<Vec<DynWidget>>;

fn widget_for(data: &Data, handle: Handle) -> DynWidget {
    let model = data.model.borrow();
    let Ok(node) = model.node(handle) else {
        return Box::new(Label::new("Invalid KAS handle").map_any::<Data>());
    };
    match node.kind {
        NodeKind::Root | NodeKind::Element(ElementKind::Column) => {
            let children = node.children.clone();
            drop(model);
            Box::new(Column::new(
                children
                    .into_iter()
                    .map(|child| widget_for(data, child))
                    .collect::<Vec<_>>(),
            ))
        }
        NodeKind::Element(ElementKind::Text) => {
            let text = model.display_text(handle).unwrap_or_default();
            Box::new(Label::new(text).map_any::<Data>())
        }
        NodeKind::Element(ElementKind::Button) => {
            let text = model.display_text(handle).unwrap_or_default();
            let callback = node.on_click;
            let button = match callback {
                Some(callback) => Button::label_msg(text, Activate(callback)),
                None => Button::label(text),
            };
            Box::new(button.map_any::<Data>())
        }
        NodeKind::Text => Box::new(Label::new(node.text.clone()).map_any::<Data>()),
    }
}

fn snapshot(data: &Data) -> Vec<DynWidget> {
    if let Some(error) = data.error.borrow().as_ref() {
        return vec![Box::new(
            Label::new(format!("JavaScript error: {error}")).map_any::<Data>(),
        )];
    }
    let roots = data.model.borrow().root_children().to_vec();
    if roots.is_empty() {
        return vec![Box::new(
            Label::new("Waiting for Vite...").map_any::<Data>(),
        )];
    }
    roots
        .into_iter()
        .map(|handle| widget_for(data, handle))
        .collect()
}

fn replace_snapshot(
    cx: &mut kas_widgets::adapt::AdaptEventCx<'_, '_>,
    column: &mut RootColumn,
    data: &Data,
) {
    while !column.is_empty() {
        column.pop(cx);
    }
    for widget in snapshot(data) {
        column.push(cx, data, widget);
    }
}

fn make_ui(data: &Data) -> impl Widget<Data = Data> + use<> {
    Column::new(snapshot(data))
        .on_configure(|cx, _| {
            let id = cx.id();
            cx.set_send_target_for::<Reload>(id);
        })
        .on_messages(|cx, column, data| {
            if let Some(Reload(graph)) = cx.try_pop() {
                data.reload(&graph);
                replace_snapshot(cx, column, data);
            }
            if let Some(Activate(callback)) = cx.try_pop() {
                data.activate(callback);
                let id = cx.id();
                cx.send(id, Refresh);
            }
            if cx.try_pop::<Refresh>().is_some() {
                replace_snapshot(cx, column, data);
            }
        })
}

fn write_message(stream: &mut TcpStream, message: &NativeMessage<'_>) -> std::io::Result<()> {
    serde_json::to_writer(&mut *stream, message)?;
    stream.write_all(b"\n")?;
    stream.flush()
}

fn spawn_dev_reader(mut proxy: kas::runner::Proxy, address: String) {
    thread::spawn(move || {
        loop {
            match TcpStream::connect(&address) {
                Ok(mut stream) => {
                    let _ = write_message(
                        &mut stream,
                        &NativeMessage::Ready {
                            protocol_version: PROTOCOL_VERSION,
                        },
                    );
                    let Ok(read_stream) = stream.try_clone() else {
                        continue;
                    };
                    for line in BufReader::new(read_stream).lines() {
                        let Ok(line) = line else { break };
                        match serde_json::from_str::<HostMessage>(&line) {
                            Ok(HostMessage::ModuleGraph { graph }) => {
                                if proxy.push(Reload(graph)).is_err() {
                                    return;
                                }
                            }
                            Err(error) => {
                                let message = error.to_string();
                                let _ = write_message(
                                    &mut stream,
                                    &NativeMessage::Error { message: &message },
                                );
                            }
                        }
                    }
                }
                Err(_) => thread::sleep(Duration::from_millis(250)),
            }
        }
    });
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let data = Data::new();
    if !EMBEDDED_PAYLOAD.is_empty() {
        let code = String::from_utf8(EMBEDDED_PAYLOAD.to_vec())?;
        data.reload(&ModuleGraph::production(code));
    }
    let ui = make_ui(&data);
    let mut runner = kas::runner::Runner::new(data)?;
    if let Ok(address) = env::var("KAS_DEV_SOCKET") {
        spawn_dev_reader(runner.create_proxy(), address);
    }
    runner.add(Window::new(ui, "Solid KAS Calculator"));
    runner.run()?;
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("kas-runtime: {error}");
        std::process::exit(1);
    }
}
