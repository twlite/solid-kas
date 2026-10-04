import { render } from "@kas/solid";
import Main from "./Main";

globalThis.__kas_dispose = render(() => <Main />);
