import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Adw from "gi://Adw";
import WebKit from "gi://WebKit";

import { decode } from "./util.js";
import resource from "./DocumentationViewer.blp";

export default function DocumentationViewer({ application }) {
  const builder = Gtk.Builder.new_from_resource(resource);

  const window = builder.get_object("documentation_viewer");
  const webview = builder.get_object("webview");
  const listbox = builder.get_object("listbox");
  const search_bar = builder.get_object("search_bar");
  const button_sidebar = builder.get_object("button_sidebar");
  const button_search = builder.get_object("button_search");
  const search_entry = builder.get_object("search_entry");
  const button_back = builder.get_object("button_back");
  const button_forward = builder.get_object("button_forward");

  const base_path = Gio.File.new_for_path("/app/share/doc");
  webview.load_uri(
    base_path.resolve_relative_path("gtk4/index.html").get_uri(),
  );
  let loaded = false;

  webview.connect("load-changed", (self, load_event) => {
    updateButtons();

    if (load_event === WebKit.LoadEvent.FINISHED) {
      loaded = true;
      button_sidebar.active = false;
    } else {
      loaded = false;
    }
  });

  webview.get_back_forward_list().connect("changed", () => {
    updateButtons();
  });

  function updateButtons() {
    button_back.sensitive = webview.can_go_back();
    button_forward.sensitive = webview.can_go_forward();
  }

  button_back.connect("clicked", () => {
    webview.go_back();
  });

  button_forward.connect("clicked", () => {
    webview.go_forward();
  });

  button_sidebar.connect("toggled", () => {
    if (loaded) {
      if (button_sidebar.active) disableDocSidebar(webview);
      else enableDocSidebar(webview);
    }
  });

  button_sidebar.connect("toggled", () => {
    if (loaded) {
      if (button_sidebar.active) disableDocSidebar(webview);
      else enableDocSidebar(webview);
    }
  });

  search_entry.connect("search-changed", () => {
    listbox.invalidate_filter();
  });

  search_bar.bind_property(
    "search-mode-enabled",
    button_search,
    "active",
    GObject.BindingFlags.BIDIRECTIONAL,
  );

  button_search.connect("toggled", () => {
    if (button_search.active) button_sidebar.active = true;
  });

  listbox.set_sort_func(sort);
  listbox.invalidate_sort();
  listbox.set_filter_func(filter);
  listbox.connect("row-selected", (self, row) => {
    webview.load_uri(row.uri);
  });

  getDocs(base_path, [
    "atk",
    "javascriptcoregtk-4.1",
    "libhandy-1",
    "libnotify-0",
    "webkit2gtk-4.1",
    "webkit2gtk-web-extension-4.1",
  ])
    .then((docs) => {
      for (const doc of docs) {
        const row = new Adw.ActionRow({
          title: doc.title,
        });
        row.uri = doc.uri;
        row.add_suffix(new Gtk.Image({ icon_name: "go-next-symbolic" }));
        listbox.append(row);
      }
    })
    .catch(logError);

  function sort(a, b) {
    return a.title.localeCompare(b.title);
  }

  function filter(row) {
    const re = new RegExp(search_entry.text, "i");
    return re.test(row.title);
  }

  const action_documentation = new Gio.SimpleAction({
    name: "documentation",
    parameter_type: null,
  });
  action_documentation.connect("activate", () => {
    window.present();
  });
  application.add_action(action_documentation);
}

async function getDocs(base_path, filter_docs) {
  const docs = [];
  const dirs = await list(base_path);
  const filtered = dirs.filter(dir => !(filter_docs.includes(dir)))

  for (const dir of filtered) {
    const results = await Promise.allSettled([
      readDocIndexJSON(base_path, dir),
      readDocIndexHTML(base_path, dir),
    ]);

    const fulfilled = results.find((result) => result.status === "fulfilled");
    if (!fulfilled) continue;

    const title = fulfilled.value;
    const uri = base_path.get_child(dir).get_child("index.html").get_uri();
    docs.push({
      title,
      uri,
    });
  }

  return docs;
}

async function readDocIndexJSON(base_path, dir) {
  const file = base_path.get_child(dir).get_child("index.json");
  const [data] = await file.load_contents_async(null);
  const json = JSON.parse(decode(data));
  return `${json["meta"]["ns"]}-${json["meta"]["version"]}`;
}

async function readDocIndexHTML(base_path, dir) {
  const file = base_path.get_child(dir).get_child("api-index-full.html");
  const [data] = await file.load_contents_async(null);
  const html = decode(data);
  const pattern = /<title>Index: ([^<]+)/;
  return html.match(pattern)[1];
}

async function list(dir) {
  // List all files in dir
  const files = [];
  const enumerator = await dir.enumerate_children_async(
    "standard::name",
    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
    GLib.PRIORITY_DEFAULT,
    null,
  );
  for await (const info of enumerator) {
    files.push(info.get_name());
  }
  return files;
}

async function disableDocSidebar(webview) {
  try {
    const script = `window.document.querySelector("nav").style.display = "none"`;
    await webview.evaluate_javascript(script, -1, null, null, null);
  } catch (err) {
    if (
      !err.matches(WebKit.JavascriptError, WebKit.JavascriptError.SCRIPT_FAILED)
    ) {
      logError(err);
    }
  }
}

async function enableDocSidebar(webview) {
  try {
    const script = `window.document.querySelector("nav").style.display = "block"`;
    await webview.evaluate_javascript(script, -1, null, null, null);
  } catch (err) {
    if (
      !err.matches(WebKit.JavascriptError, WebKit.JavascriptError.SCRIPT_FAILED)
    ) {
      logError(err);
    }
  }
}
