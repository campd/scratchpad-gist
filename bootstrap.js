/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

var __SCRATCHPAD__ = !(typeof(window) == "undefined");
if (__SCRATCHPAD__ && (typeof(window.gBrowser) == "undefined")) {
  throw new Error("Must be run in a browser scratchpad.");
}

// If we're developing in scratchpad, shutdown the previous run
// before continuing.
if (__SCRATCHPAD__ && (typeof(shutdown) != "undefined")) {
  shutdown();
}

// should be consts but redefining makes this a pain.
var { interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");


// Pref stores the auth token we were given by gist.
const kAuthTokenPref = "devtools.scratchpad.gist.authtoken";

// Pref stores the user we authenticated as.
const kUserPref = "devtools.scratchpad.gist.userid";

const kAuthNote = "Scratchpad";
const kLabelStyle = "margin-top: 4px;";


function strPref(key) Services.prefs.prefHasUserValue(key) ? Services.prefs.getCharPref(key) : null;

function ScratchpadGist(win)
{
  this.win = win;
  this.doc = win.document;

  this.updateUI = this.updateUI.bind(this);
  Services.obs.addObserver(this.updateUI, "sp-gist-auth", false);

  this.overrideOpenFile();
  this.addCommands();
  this.addMenu();
  this.addToolbar();
  this.addToolbarButtons();
  this.updateUI();
}

ScratchpadGist.prototype = {
  get authtoken() strPref(kAuthTokenPref),
  get authUser() strPref(kUserPref),

  get menu() this.doc.getElementById("sp-gist-menu"),
  get toolbar() this.doc.getElementById("sp-gist-toolbar"),
  get toolbarLink() this.doc.getElementById("sp-gist-link"),
  get nbox() this.doc.getElementById("scratchpad-notificationbox"),
  get commandset() this.doc.getElementById("sp-gist-commands"),
  get historyPopup() this.doc.getElementById("sp-gist-history"),
  get fileButton() this.doc.getElementById("sp-gist-file"),
  get filesPopup() this.doc.getElementById("sp-gist-files"),

  destroy: function() {
    Services.obs.removeObserver(this.updateUI, "sp-gist-auth", false);

    if (this._authListener) {
      let item = this.doc.getElementById("sp-gist-auth");
      item.removeEventListener("command", this._authListener, false);
      delete this._authListener;
    }

    this.menu.remove();
    this.commandset.remove();

    // remove toolbar buttons and things
    this.doc.getElementById("sp-gist-label").remove();
    this.toolbarLink.remove();
    this.doc.getElementById("sp-gist-springy").remove();
    this.fileButton.remove();
    this.doc.getElementById("sp-gist-refresh").remove();
    this.doc.getElementById("sp-gist-history-button").remove();
    this.doc.getElementById("sp-gist-fork").remove();
    this.doc.getElementById("sp-gist-post").remove();

    let notification = this.nbox.getNotificationWithValue("gist-notification");
    if (notification) {
      this.nbox.removeNotification(notification);
    }

    if (this.toolbar)
      this.toolbar.remove();

    let tbar = this.doc.getElementById("sp-toolbar");
    tbar.remove();

    this.doc.getElementById("sp-gist-toolbox").remove();

    this.doc.documentElement.insertBefore(tbar, this.nbox);

    if (this.__originalOpenFile) {
      this.win.Scratchpad.openFile = this.__originalOpenFile;
      this.__originalOpenFile = null;
    }
  },

  /**
   * A few dom helpers...
   */

  clear: function(elt) {
    while (elt.hasChildNodes()) {
      elt.removeChild(elt.firstChild);
    }
  },

  addChild: function(parent, tag, attributes) {
    let element = this.doc.createElement(tag);
    for (let item of Object.getOwnPropertyNames(attributes)) {
      element.setAttribute(item, attributes[item]);
    }
    parent.appendChild(element);
    return element;
  },

  addCommand: function(options) {
    let command = this.doc.createElement("command");
    command.setAttribute("id", options.id);
    if (options.label) {
      command.setAttribute("label", options.label);
    }
    command.addEventListener("command", options.handler, true);
    this.commandset.appendChild(command);
  },

  addCommands: function() {
    let commands = this.doc.createElement("commandset");
    commands.setAttribute("id", "sp-gist-commands");
    this.doc.documentElement.appendChild(commands);

    this.addCommand({
      id: "sp-gist-cmd-signin",
      label: "Sign In",
      handler: () => this.signIn()
    });
    this.addCommand({
      id: "sp-gist-cmd-signout",
      label: "Sign Out",
      handler: () => this.signOut()
    });
    this.addCommand({
      id: "sp-gist-cmd-attach",
      label: "Attach to Gist...",
      handler: () => this.attach()
    });
    this.addCommand({
      id: "sp-gist-cmd-detach",
      label: "Detach from Gist",
      handler: () => this.attached(null)
    });
    this.addCommand({
      id: "sp-gist-cmd-create-private",
      label: "Create Private Gist",
      handler: () => this.create(false)
    });
    this.addCommand({
      id: "sp-gist-cmd-create-public",
      label: "Create Public Gist",
      handler: () => this.create(true)
    });
    this.addCommand({
      id: "sp-gist-cmd-refresh",
      label: "Load Latest",
      handler: () => this.refresh()
    });
    this.addCommand({
      id: "sp-gist-cmd-update",
      label: "Post",
      handler: () => this.update()
    });
    this.addCommand({
      id: "sp-gist-cmd-fork",
      label: "Fork",
      handler: () => this.fork()
    });
  },

  addMenu: function() {
    let doc = this.doc;
    let menubar = doc.getElementById("sp-menubar");
    if (!menubar) {
      return;
    }

    let menu = doc.createElement("menu");
    menu.setAttribute("id", "sp-gist-menu");
    menu.setAttribute("label", "Gist");

    let popup = this.addChild(menu, "menupopup", { id: "sp-gist-popup" });

    this.addChild(popup, "menuitem", { id: "sp-gist-auth" });

    this.addChild(popup, "menuseparator", { class: "sp-gist-authed" });

    this.addChild(popup, "menuitem", {
      id: "sp-gist-attach",
      class: "sp-gist-authed"
    });

    this.addChild(popup, "menuitem", {
      command: "sp-gist-cmd-create-public",
      class: "sp-gist-authed sp-gist-detached"
    });
    this.addChild(popup, "menuitem", {
      command: "sp-gist-cmd-create-private",
      class: "sp-gist-authed sp-gist-detached"
    });

    this.addChild(popup, "menuseparator", { class: "sp-gist-authed sp-gist-attached" });

    this.addChild(popup, "menuitem", {
      command: "sp-gist-cmd-refresh",
      class: "sp-gist-authed sp-gist-attached"
    });

    this.addChild(popup, "menuitem", {
      command: "sp-gist-cmd-fork",
      class: "sp-gist-authed sp-gist-attached sp-gist-other"
    });

    this.addChild(popup, "menuitem", {
      command: "sp-gist-cmd-update",
      class: "sp-gist-authed sp-gist-owned"
    });

    let help = doc.getElementById("sp-help-menu");
    menubar.insertBefore(menu, help);
  },

  addToolbar: function() {
    let sp_toolbar = this.doc.getElementById("sp-toolbar");

    let toolbox = this.doc.createElement("toolbox");
    toolbox.id = "sp-gist-toolbox";
    toolbox.class = "devtools-toolbar";

    this.doc.documentElement.insertBefore(toolbox, this.nbox);

    sp_toolbar.remove();
    toolbox.appendChild(sp_toolbar);

    this.addChild(toolbox, "toolbar", {
      id: "sp-gist-toolbar",
      class: "devtools-toolbar"
    });
  },

  addToolbarButtons: function() {
    let toolbar = this.toolbar;

    this.addChild(toolbar, "label", {
      style: kLabelStyle,
      id: "sp-gist-label",
      value: "Gist:"
    });

    this.addChild(toolbar, "label", {
      style: kLabelStyle,
      id: "sp-gist-link",
      class: "text-link",
    });

    this.addChild(toolbar, "toolbarspring", {id: "sp-gist-springy"});

    let fileSelector = this.addChild(toolbar, "toolbarbutton", {
      id: "sp-gist-file",
      class: "devtools-toolbarbutton sp-gist-multifile",
      type: "menu"
    });

    this.addChild(fileSelector, "menupopup", {
      id: "sp-gist-files"
    });

    this.addChild(toolbar, "toolbarbutton", {
      command: "sp-gist-cmd-refresh",
      id: "sp-gist-refresh",
      class: "devtools-toolbarbutton"
    });

    let history = this.addChild(toolbar, "toolbarbutton", {
      label: "History",
      class: "devtools-toolbarbutton",
      id: "sp-gist-history-button",
      type: "menu"
    });

    this.addChild(history, "menupopup", {
      id: "sp-gist-history"
    });

    this.addChild(toolbar, "toolbarbutton", {
      id: "sp-gist-fork",
      command: "sp-gist-cmd-fork",
      class: "devtools-toolbarbutton sp-gist-other"
    });

    this.addChild(toolbar, "toolbarbutton", {
      id: "sp-gist-post",
      command: "sp-gist-cmd-update",
      class: "devtools-toolbarbutton sp-gist-owned"
    });
  },

  updateUI: function() {
    let auth = this.doc.getElementById("sp-gist-auth");
    auth.setAttribute("command", this.authtoken ? "sp-gist-cmd-signout" : "sp-gist-cmd-signin");

    let attach = this.doc.getElementById("sp-gist-attach");
    attach.setAttribute("command", this.attachedGist ? "sp-gist-cmd-detach" : "sp-gist-cmd-attach");

    let authed = !!this.authtoken;
    let attached = !!this.attachedGist;
    let own = attached && this.attachedGist.user && (this.attachedGist.user.id == this.authUser);
    let multifile = this.attachedGist && Object.getOwnPropertyNames(this.attachedGist.files).length > 1;

    // Update the visibility of the toolbar buttons and menu items.
    // They have a set of class names which correspond to state.  A
    // given item is hidden if any of its requirements are not met.
    let items = this.doc.querySelectorAll("#sp-gist-label #sp-gist-post #sp-gist-fork #sp-gist-history-button #sp-gist-refresh #sp-gist-file #sp-gist-menu menuitem, #sp-gist-menu menuseparator");
    for (let item of items) {
      if ((item.classList.contains("sp-gist-authed") && !authed) ||
        (item.classList.contains("sp-gist-attached") && !attached) ||
        (item.classList.contains("sp-gist-detached") && attached) ||
        (item.classList.contains("sp-gist-owned") && !own) ||
        (item.classList.contains("sp-gist-other") && own) ||
        (item.classList.contains("sp-gist-multifile") && !multifile))

        item.setAttribute("hidden", "true");
      else
        item.removeAttribute("hidden");
    }

    if (attached) {
      // Update the toolbar and label
      this.toolbarLink.setAttribute("href", this.attachedGist.html_url);
      this.toolbarLink.setAttribute("value", this.attachedGist.html_url);

      // Update the history popup from the attached gist...
      this.clear(this.historyPopup);

      this.attachedGist.history.forEach(function(item) {
        let menuitem = this.addChild(this.historyPopup, "menuitem", {
          label: item.version.substr(0, 6) + " " + item.user.login,
        });
        menuitem.addEventListener("command", function() {
          this.refresh(item.version);
        }.bind(this), true);
      }.bind(this));

      this.fileButton.setAttribute("label", this.attachedFile);
      this.loadFile(this.attachedGist, this.attachedGist.files[this.attachedFile]);

      // Update the file popup.
      this.clear(this.filesPopup);
      Object.getOwnPropertyNames(this.attachedGist.files).forEach(function(name) {
        let item = this.attachedGist.files[name];
        let menuitem = this.addChild(this.filesPopup, "menuitem", {
          label: item.filename,
        });
        menuitem.addEventListener("command", function() {
          this.fileButton.setAttribute("label", name);
          this.attachedFile = name;
          this.loadFile(this.attachedGist, item);
        }.bind(this));
      }.bind(this));
    }
  },

  /**
   * Overrides the scratchpad's open file method to take care of gists in the
   * recent file list.
   */
  overrideOpenFile: function() {
    if (!this.__originalOpenFile) {
      this.__originalOpenFile = this.win.Scratchpad.openFile;
      this.win.Scratchpad.openFile = (index) => {
        let path = this.win.Scratchpad.getRecentFiles()[index];
        if (!path || !path.startsWith("Gist")) {
          this.__originalOpenFile.call(this.win.Scratchpad, index);
          return;
        }
        if (!!this.authtoken) {
          let id = path.split(" ")[1];
          this.request({
            path: "/gists/" + id,
            err: "Could not attach to the Gist: ",
            success: function(response) {
              this.attached(response);
            }.bind(this),
            error: "Couldn't find gist."
          });
        }
      }
    }
  },

  /**
   * Issue a github API request.
   */
  request: function(options) {
    let xhr = new this.win.XMLHttpRequest();
    xhr.mozBackgroundRequest = true;

    xhr.onreadystatechange = function() {
      if (xhr.readyState != 4)
        return;
      if (xhr.status >= 200 && xhr.status < 400) {
        if (options.success) options.success(JSON.parse(xhr.responseText));
      } else {
        if (typeof(options.err) == "function") {
          options.err(xhr);
        } else {
          let label;
          try {
            let response = JSON.parse(xhr.responseText);
            let prefix = typeof(options.err) == "string" ? options.err : "The request returned an error: ";
            label = prefix + response.message + ".";
          } catch(ex) {
            label = "Request could not be completed.";
          }
          this.notify(this.nbox.PRIORITY_CRITICAL_HIGH, label);
        }
      }
    }.bind(this);

    xhr.open(options.method || "GET",
     "https://api.github.com" + options.path,
     true, null, null);

    xhr.setRequestHeader("Authorization", options.auth || "token " + this.authtoken);
    xhr.send(options.args ? JSON.stringify(options.args) : "");
  },

  /**
   * Notify the user with the notification box.
   */
  notify: function(priority, label, buttons) {
    let notification = this.nbox.getNotificationWithValue("gist-notification");
    if (notification) {
      this.nbox.removeNotification(notification);
    }

    this.nbox.appendNotification(
      label, "gist-notification", null, priority, buttons, null
    );
  },

  /**
   * Show the signin dialog and start the authentication process.
   */
  signIn: function() {
    let username = {value:null};
    let password = {value:null};
    let check = {value:false};
    Services.prompt.promptUsernameAndPassword(null, "GitHub Credentials", "Enter your github username and credentials.",
      username, password, "", check);

    let auth = "Basic " + this.win.btoa(username.value + ":" + password.value);
    this.findAuth(auth);
  },

  /**
   * Try to find an existing authorization for this application.  If one is
   * not found, this method will call createAuth() to create one.
   */
  findAuth: function(auth) {
    // Find an existing Scratchpad Gist authorization.
    this.request({
      method: "GET",
      path: "/authorizations",
      err: "Couldn't log in: ",
      auth: auth,
      success: function(response) {
        for (let authorization of response) {
          if (authorization.app.name == kAuthNote + " (API)") {
            this.authorized(authorization);
            return;
          }
        }
        this.createAuth(auth);
      }.bind(this)
    });
  },

  /**
   * Create a gist authorization for this application.
   */
  createAuth: function(auth) {
    this.request({
      method: "POST",
      path: "/authorizations",
      auth: auth,
      error: "Couldn't log in: ",
      args: {
        scopes: ["gist"],
        note: kAuthNote,
        note_url: null
      },
      success: function(response) {
        this.authorized(response);
      }.bind(this)
    });
  },

  /**
   * Now that we've gotten an authorization token, request user
   * information so we know who we are.
   */
  authorized: function(authorization) {
    // Fetch information about the authorized user.
    this.request({
      path: "/user",
      auth: "token " + authorization.token,
      success: function(response) {
        // Done logging in, set the auth preferences.
        Services.prefs.setCharPref(kAuthTokenPref, authorization.token);
        Services.prefs.setCharPref(kUserPref, response.id);
        this.notify(this.nbox.PRIORITY_INFO_HIGH, "Logged in as " + response.name + ".");

        // Notify other scratchpad windows that we're logged in.  This will
        // refresh the UI.
        Services.obs.notifyObservers(null, "sp-gist-auth", "");
      }.bind(this)
    });
  },

  /**
   * Forget the currently logged-in user.
   */
  signOut: function() {
    Services.prefs.clearUserPref(kAuthTokenPref);

    // Notify other scratchpad windows that we're logged in.  This will
    // refresh the UI.
    Services.obs.notifyObservers(null, "sp-gist-auth", "");
  },

  /**
   * Prompt the user to attach to a gist.
   */
  attach: function() {
    let val = {value: null};
    let check = {value:false};
    Services.prompt.prompt(
      this.win, "Attach to Gist", "Enter the Gist ID or URL",  val, "", check
    );

    let id = val.value;
    if (id === null)
      return;

    // If a URL was specified, pull out the gist id.
    let gistRE = new RegExp("gist.github.com/(.*)");
    let matches = id.match(gistRE);
    if (matches) {
      id = matches[1];
    }

    this.request({
      path: "/gists/" + id,
      err: "Could not attach to the Gist: ",
      success: function(response) {
        this.attached(response);
      }.bind(this),
      error: "Couldn't find gist."
    });
  },

  /**
   * Fork the currently-attached gist.
   */
  fork: function() {
    this.request({
      method: "POST",
      path: "/gists/" + this.attachedGist.id + "/fork",
      success: function(response) {
        this.attached(response);
      }.bind(this),
    });
  },

  /**
   * Fetch the currently-attached gist from the server and load
   * it in to the scratchpad.
   *
   * @param string version optional
   *   Optionally specifies the specific version to fetch.
   */
  refresh: function(version) {
    let path = "/gists/" + this.attachedGist.id;
    if (version) {
        path += "/" + version;
    }
    this.request({
      method: "GET",
      path: path,
      success: function(response) {
        this.load(response);
      }.bind(this)
    });
  },

  /**
   * Post the current contents of the scratchpad as a new gist.
   * Attaches to the new gist.
   *
   * @param boolean pub
   *   True to create a public gist.
   */
  create: function(pub) {
    this.request({
      method: "POST",
      path: "/gists",
      args: {
        description: null,
        public: pub,
        files: this.getFile()
      },
      success: function(response) {
        this.attached(response);
      }.bind(this)
    });
  },

  /**
   * Upload the contents of the scratchpad to the currently-attached gist.
   */
  update: function() {
    this.cursorBeforeSave = this.win.Scratchpad.editor.getCursor();
    this.request({
      method: "PATCH",
      path: "/gists/" + this.attachedGist.id,
      args: {
        description: null,
        files: this.getFile(),
      },
      success: function(response) {
        this.attached(response);
        this.win.Scratchpad.editor.setCursor(this.cursorBeforeSave);
        this.cursorBeforeSave = null;
      }.bind(this)
    });
  },

  /**
   * Return a files object for the current object, as needed by
   * gist API requests.
   */
  getFile: function() {
    let files = {};
    let filename = "scratchpad.js";

    if (this.attachedFile) {
      filename = this.attachedFile;
    } else {
      let scratchpad = this.win.Scratchpad;
      if (scratchpad.filename) {
        filename = scratchpad.filename;
        let lastSep = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
        if (lastSep > -1) {
          filename = filename.substring(lastSep + 1);
        }
      }
    }
    files[filename] = {
      content: this.win.Scratchpad.getText()
    };
    return files;
  },

  /**
   * Called when we've attached to a gist.
   */
  attached: function(gist) {
    this.attachedGist = gist;

    this.addEntryToRecentFilesMenu(gist);
    if (!this.attachedFile) {
      this.attachedFile = Object.getOwnPropertyNames(gist.files)[0];
    } else if (!gist) {
      this.win.Scratchpad.setFilename(null);
      this.win.Scratchpad.dirty = true;
    }
    // override the save method of scratchpad
    if (this.__originalSaveFile && !gist) {
        this.win.Scratchpad.saveFile = this.__originalSaveFile;
        this.__originalSaveFile = null;
    } else if (!this.__originalSaveFile && gist) {
      this.__originalSaveFile = this.win.Scratchpad.saveFile;
      this.win.Scratchpad.saveFile = () => {
        this.update();
      };
    }
    this.win.Scratchpad.dirty = false;
    this.updateUI();
  },

  /**
   * Load the contents of the given gist into the scratchpad.
   *
   * @param object gist
   *   The gist as returned by an API request.
   */
  load: function(gist) {
    // Try to find the currently-selected subfile.
    for (let i in gist.files) {
      if (gist.files[i].filename == this.attachedFile) {
        this.loadFile(gist, gist.files[i]);
        return;
      }
    }
    // The attached filename was either empty or is now missing.
    // Attach to the first one.
    this.attachedFile = Object.getOwnPropertyNames(gist.files)[0];
    this.loadFile(gist, gist.files[this.attachedFile]);
  },

  /**
   * Load a specific file's contents from the gist.
   */
  loadFile: function(gist, file) {
    this.win.Scratchpad.setText(file.content);
    this.win.Scratchpad.setFilename(file.filename);
    this.win.Scratchpad.dirty = false;
  },

  /**
   * Adds an entry to the scratchpad's recent file menu to open recently visited
   * gists.
   */
  addEntryToRecentFilesMenu: function(gist) {
    if (gist) {
      let files = "";
      let count = 0;
      for (let file in gist.files) {
        files += file;
        count++;
        if (count > 2) {
          files += " and ";
          break;
        } else if (count == gist.files.length - 1) {
          files += " and ";
        } else if (count < gist.files.length) {
          files += ", ";
        }
      }
      if (count < gist.files.length) {
        files += (gist.files.length - count) + " more";
      }
      this.win.Scratchpad.setRecentFile({
        path: "Gist: " + gist.id + " (" + files + ")"
      });
      let entry = this.win.document.getElementById("sp-open_recent-menu")
                      .firstChild.firstChild;
      entry.setAttribute("checked", true);
      entry.setAttribute("disabled", true);
    }
  },
};

function attachWindow(win) {
  if (win.Scratchpad && win.document.getElementById("scratchpad-notificationbox")) {
    win.ScratchpadGist = new ScratchpadGist(win);
  }
}

var WindowListener = {
  onOpenWindow: function(win) {
    // Wait for the window to finish loading
    // XXX redefining "win" I don't even...
    let win = win.QueryInterface(Ci.nsIInterfaceRequestor)
      .getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
    win.addEventListener("load", function onLoad() {
      win.removeEventListener("load", onLoad, false);
      attachWindow(win);
    }, false);
  },
  onCloseWindow: function(win) { },
  onWindowTitleChange: function(win, title) { }
};

function startup(data, reason)
{
  // Should set a type in scratchpad.
  let e = Services.wm.getEnumerator("devtools:scratchpad");
  while (e.hasMoreElements()) {
    attachWindow(e.getNext());
  }
  Services.wm.addListener(WindowListener);
}

function shutdown(data, reason)
{
  // Should set a type in scratchpad.
  let e = Services.wm.getEnumerator("devtools:scratchpad");
  while (e.hasMoreElements()) {
    let win = e.getNext();

    if (win.ScratchpadGist) {
      win.ScratchpadGist.destroy();
      delete win.ScratchpadGist;
    }
    let menu = win.document.getElementById("sp-gist-menu");
    if (menu) {
      menu.remove();
    }
  }

  if (WindowListener) {
    Services.wm.removeListener(WindowListener);
  }
}

function install(data, reason) { }
function uninstall(data, reason) { }

// If running in the scratchpad, run startup manually.
if (__SCRATCHPAD__) {
  startup();
}
