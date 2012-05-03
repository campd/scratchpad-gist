/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

var __SCRATCHPAD__ = !(typeof(window) == "undefined");
if (__SCRATCHPAD__ && (typeof(window.gBrowser) == "undefined")) {
  throw new Error("Must be run in a browser scratchpad.");
}

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");

// Pref stores the auth token we were given by gist.
var kAuthTokenPref = "devtools.scratchpad.gist.authtoken";

// Pref stores the user we authenticated as.
var kUserPref = "devtools.scratchpad.gist.userid";

var kAuthNote = "Scratchpad";
var kLabelStyle = "color: hsl(210,30%,85%);text-shadow: 0 -1px 0 hsla(210,8%,5%,.45);margin-top: 4px;";

function strPref(key) Services.prefs.prefHasUserValue(key) ? Services.prefs.getCharPref(key) : null;

function ScratchpadGist(win)
{
  this.win = win;
  this.doc = win.document;

  this.updateUI = this.updateUI.bind(this);
  Services.obs.addObserver(this.updateUI, "sp-gist-auth", false);

  this.addStyles();
  this.addCommands();
  this.addMenu();
  this.addToolbar();
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

    this.menu.parentNode.removeChild(this.menu);
    this.toolbar.parentNode.removeChild(this.toolbar);
    this.commandset.parentNode.removeChild(this.commandset);

    let notification = this.nbox.getNotificationWithValue("gist-notification");
    if (notification) {
      this.nbox.removeNotification(notification);
    }

    this.removeStyles();
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
    for each (var item in Object.getOwnPropertyNames(attributes)) {
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

  /**
   * Add the devtools stylesheets to the scratchpad.
   */
  addStyles: function() {
    let root = this.doc.getElementsByTagName('window')[0];

    procs = [];
    let proc = this.doc.createProcessingInstruction(
      "xml-stylesheet",
      "href='chrome://browser/skin/devtools/common.css' type='text/css'");
    root.parentNode.insertBefore(proc, root);
    procs.push(proc);

    proc = this.doc.createProcessingInstruction(
      "xml-stylesheet",
      "href='chrome://browser/skin/browser.css' type='text/css'");
    root.parentNode.insertBefore(proc, root);
    procs.push(proc);

    // Store the processing instructions for removal at shutdown.
    this.gistProcs = procs;
  },

  /**
   * Clear out processing instructions previously added in addStyles().
   */
  removeStyles: function() {
    let procs = this.gistProcs;
    if (procs) {
      for each (let proc in procs) {
        proc.parentNode.removeChild(proc);
      }
      delete this.win.gistProcs;
    }
  },

  addCommands: function() {
    let commands = this.doc.createElement("commandset");
    commands.setAttribute("id", "sp-gist-commands");
    this.doc.documentElement.appendChild(commands);

    this.addCommand({
      id: "sp-gist-cmd-signin",
      label: "Sign In",
      handler: function() { this.signIn() }.bind(this)
    });
    this.addCommand({
      id: "sp-gist-cmd-signout",
      label: "Sign Out",
      handler: function() { this.signOut(); }.bind(this)
    });
    this.addCommand({
      id: "sp-gist-cmd-attach",
      label: "Attach to Gist...",
      handler: function() { this.attach(); }.bind(this)
    });
    this.addCommand({
      id: "sp-gist-cmd-detach",
      label: "Detach from Gist",
      handler: function() { this.attached(null); }.bind(this)
    });
    this.addCommand({
      id: "sp-gist-cmd-create-private",
      label: "Create Private Gist",
      handler: function() { this.create(false) }.bind(this)
    });
    this.addCommand({
      id: "sp-gist-cmd-create-public",
      label: "Create Public Gist",
      handler: function() { this.create(true) }.bind(this)
    });
    this.addCommand({
      id: "sp-gist-cmd-refresh",
      label: "Load Latest",
      handler: function() { this.refresh(); }.bind(this)
    });
    this.addCommand({
      id: "sp-gist-cmd-update",
      label: "Post",
      handler: function() { this.update(); }.bind(this)
    });
    this.addCommand({
      id: "sp-gist-cmd-fork",
      label: "Fork",
      handler: function() { this.fork(); }.bind(this)
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
    let toolbar = this.doc.createElement("toolbar");
    toolbar.setAttribute("id", "sp-gist-toolbar");
    toolbar.setAttribute("class", "devtools-toolbar");
    toolbar.setAttribute("hidden", "true");

    this.addChild(toolbar, "toolbarbutton", {
      id: "highlighter-closebutton",
      command: "sp-gist-cmd-detach"
    });

    this.addChild(toolbar, "label", {
      style: kLabelStyle,
      value: "Attached to Gist:"
    });

    this.addChild(toolbar, "label", {
      id: "sp-gist-link",
      class: "text-link",
      style: kLabelStyle
    })

    this.addChild(toolbar, "toolbarspring", {});

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
      class: "devtools-toolbarbutton"
    });

    let history = this.addChild(toolbar, "toolbarbutton", {
      label: "History",
      class: "devtools-toolbarbutton",
      type: "menu"
    });

    let historyPopup = this.addChild(history, "menupopup", {
      id: "sp-gist-history"
    });

    this.addChild(toolbar, "toolbarbutton", {
      command: "sp-gist-cmd-fork",
      class: "devtools-toolbarbutton sp-gist-other"
    });

    this.addChild(toolbar, "toolbarbutton", {
      command: "sp-gist-cmd-update",
      class: "devtools-toolbarbutton sp-gist-owned"
    });

    this.nbox.parentNode.insertBefore(toolbar, this.nbox);
  },

  updateUI: function() {
    let item = this.doc.getElementById("sp-gist-auth");
    item.setAttribute("command", this.authtoken ? "sp-gist-cmd-signout" : "sp-gist-cmd-signin");

    let item = this.doc.getElementById("sp-gist-attach");
    item.setAttribute("command", this.attachedGist ? "sp-gist-cmd-detach" : "sp-gist-cmd-attach");

    let authed = !!this.authtoken;
    let attached = !!this.attachedGist;
    let own = attached && this.attachedGist.user && (this.attachedGist.user.id == this.authUser);
    let multifile = this.attachedGist && Object.getOwnPropertyNames(this.attachedGist.files).length > 1;

    // Update the visibility of the toolbar buttons and menu items.
    // They have a set of class names which correspond to state.  A
    // given item is hidden if any of its requirements are not met.
    let items = this.doc.querySelectorAll("#sp-gist-toolbar toolbarbutton, #sp-gist-menu menuitem, #sp-gist-menu menuseparator");
    for (var i = 0; i < items.length; i++) {
      let item = items[i];
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

    if (!attached) {
      this.toolbar.setAttribute("hidden", "true");
    } else {
      // Update the toolbar and label
      this.toolbar.removeAttribute("hidden");
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

      this.fileButton.setAttribute("label", this.attachedFilename);

      // Update the file popup.
      this.clear(this.filesPopup);
      Object.getOwnPropertyNames(this.attachedGist.files).forEach(function(name) {
        let item = this.attachedGist.files[name];
        let menuitem = this.addChild(this.filesPopup, "menuitem", {
          label: item.filename,
        });
        menuitem.addEventListener("command", function() {
          this.fileButton.setAttribute("label", name);
          this.attachedFilename = name;
          this.loadFile(this.attachedGist, item);
        }.bind(this));
      }.bind(this));
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
          try {
            let response = JSON.parse(xhr.responseText)
            let prefix = typeof(options.err) == "string" ? options.err : "The request returned an error: ";
            var label = prefix + response.message + ".";
          } catch(ex) {
            var label = "Request could not be completed.";
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

    let auth = "Basic " + this.win.btoa(username.value + ':' + password.value);
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
        for each (let authorization in response) {
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
    this.request({
      method: "PATCH",
      path: "/gists/" + this.attachedGist.id,
      args: {
        description: null,
        files: this.getFile(),
      },
      success: function(response) {
        this.attached(response);
      }.bind(this)
    });
  },

  /**
   * Return a files object for the current object, as needed by
   * gist API requests.
   */
  getFile: function() {
    let files = {};

    if (this.attachedFilename) {
      var filename = this.attachedFilename;
    } else {
      let scratchpad = this.win.Scratchpad;
      var filename = "scratchpad.js";
      if (scratchpad.filename) {
        filename = scratchpad.filename;
        let lastSep = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
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
    if (!this.attachedFile) {
      this.attachedFile = Object.getOwnPropertyNames(gist.files)[0];
    }
    this.updateUI();
  },

  /**
   * Load the contents of the given gist into the scratchpad.
   *
   * @param object gist
   *   The gist as returned by an API request.
   */
  load: function(gist) {
    let file = null;

    // Try to find the currently-selected subfile.
    for (var i in gist.files) {
      if (gist.files[i].filename == this.attachedFilename) {
        this.loadFile(gist, gist.files[i]);
        return;
      }
    }
    // The attached filename was either empty or is now missing.
    // Attach to the first one.
    this.attachedFilename = Object.getOwnPropertyNames(gist.files)[0];
    this.loadFile(gist, gist.files[this.attachedFilename]);
  },

  /**
   * Load a specific file's contents from the gist.
   */
  loadFile: function(gist, file) {
    this.win.Scratchpad.setText(file.content);
    this.win.Scratchpad.setFilename(file.filename);
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
  let e = Services.wm.getEnumerator(null);
  while (e.hasMoreElements()) {
    attachWindow(e.getNext());
  }
  Services.wm.addListener(WindowListener);

  // When loading from scratchpad, stash the listener
  // on the window object so we get the right one during
  // shutdown.
  if (__SCRATCHPAD__) {
    window.document.setUserData("scratchpadGistListener", WindowListener, null);
  }
}

function shutdown(data, reason)
{
  // Should set a type in scratchpad.
  let e = Services.wm.getEnumerator(null);
  while (e.hasMoreElements()) {
    let win = e.getNext();

    if (win.ScratchpadGist) {
      win.ScratchpadGist.destroy();
      delete win.ScratchpadGist;
    }

    let menu = win.document.getElementById("sp-gist-menu");
    if (menu) {
      menu.parentNode.removeChild(menu);
    }
    let toolbar = win.document.getElementById("sp-gist-toolbar");
    if (toolbar) {
      toolbar.parentNode.removeChild(toolbar);
    }
  }

  // If we were loaded from a scratchpad, we need to remove the
  // listener added by the previous run.  Otherwise it's safe
  // to remove WindowListener directly.
  let listener = __SCRATCHPAD__ ? window.document.getUserData("scratchpadGistListener") : WindowListener;
  if (listener) {
    Services.wm.removeListener(listener);
  }
}

function install(data, reason) {}
function uninstall(data, reason) {}

if (__SCRATCHPAD__) {
  shutdown();
  startup();
}
