if (!Cc) {
    var Cc = Components.classes;
}

if (!Ci) {
    var Ci = Components.interfaces;
}

var windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"]
  .getService(Ci.nsIWindowMediator);
  
var promptService = Cc["@mozilla.org/embedcomp/prompt-service;1"]
  .getService(Ci.nsIPromptService);
  
var kAuthTokenPref = "devtools.scratchpad.gist.authtoken";
var kAuthIDPref = "devtools.scratchpad.gist.authid";
var kUserPref = "devtools.scratchpad.gist.userid";

var kAuthNote = "Scratchpad";
var kLabelStyle = "color: hsl(210,30%,85%);text-shadow: 0 -1px 0 hsla(210,8%,5%,.45);margin-top: 4px";


function strPref(key) {
    try {
        return Services.prefs.getCharPref(key);
    } catch(ex) {
        return null;
    }
}

function ScratchpadGist(win)
{
    this.win = win;
    this.doc = win.document;

    this.updateUI = this.updateUI.bind(this);    
    Services.obs.addObserver(this.updateUI, "sp-gist-auth", false);

    this.addCommands();
    this.addStyles();
    this.addToolbar();
    this.addMenu();
}

ScratchpadGist.prototype = {
    get authtoken() strPref(kAuthTokenPref),    
    get authID() strPref(kAuthIDPref),
    get authUser() strPref(kUserPref),
    
    get menu() this.doc.getElementById("sp-gist-menu"),
    get toolbar() this.doc.getElementById("sp-gist-toolbar"),
    get toolbarLink() this.doc.getElementById("sp-gist-link"),
    get nbox() this.doc.getElementById("scratchpad-notificationbox"),
    get commandset() this.doc.getElementById("sp-gist-commands"),
    
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
        
        this.removeStyles();
    },

    request: function(options) {
        let xhr = new this.win.XMLHttpRequest();
        
        xhr.onreadystatechange = function() {
            if (xhr.readyState != 4)
                return;
            if (xhr.status >= 200 && xhr.status < 400) {
                if (options.success) options.success(JSON.parse(xhr.responseText));
            } else {
                if (options.err) options.err(xhr);
            }
        }
        xhr.open(options.method || "GET",
                 "https://api.github.com" + options.path,
                 true, null, null);

        xhr.setRequestHeader("Authorization", options.auth || "token " + this.authtoken);
        xhr.send(options.args ? JSON.stringify(options.args) : "");
    },
    
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

        this.doc.gistProcs = procs;
    },
    
    removeStyles: function() {
        // Clear out old processing instructions...
        let procs = this.win.gistProcs;
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
            handler: this.signIn.bind(this)
        });
        this.addCommand({
            id: "sp-gist-cmd-signout",
            label: "Sign Out",
            handler: this.signOut.bind(this)
        });
        this.addCommand({
            id: "sp-gist-cmd-attach",
            label: "Attach to Gist...",
            handler: this.attach.bind(this)
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
            handler: this.refresh.bind(this)
        });
        this.addCommand({
            id: "sp-gist-cmd-update",
            label: "Post",
            handler: this.update.bind(this)
        });
        this.addCommand({
            id: "sp-gist-cmd-fork",
            label: "Fork",
            handler: this.fork.bind(this)
        });
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

    addMenu: function() {
        let doc = this.doc;
        let menubar = doc.getElementById("sp-menubar");
        if (!menubar) {
            return;
        }
        
        let menu = doc.createElement("menu");
        menu.setAttribute("id", "sp-gist-menu");
        menu.setAttribute("label", "Gist");
    
        let popup = doc.createElement("menupopup");
        popup.setAttribute("id", "sp-gist-popup");
        menu.appendChild(popup);

        let item = doc.createElement("menuitem");
        item.setAttribute("id", "sp-gist-auth");
        popup.appendChild(item);
        
        item = doc.createElement("menuseparator");
        item.setAttribute("class", "sp-gist-authed");
        popup.appendChild(item);

        item = doc.createElement("menuitem");
        item.setAttribute("id", "sp-gist-attach");
        item.setAttribute("class", "sp-gist-authed");
        popup.appendChild(item);
        
        item = doc.createElement("menuitem");
        item.setAttribute("command", "sp-gist-cmd-create-private");
        item.setAttribute("class", "sp-gist-authed sp-gist-detached");
        popup.appendChild(item);

        item = doc.createElement("menuitem");
        item.setAttribute("command", "sp-gist-cmd-create-public");
        item.setAttribute("class", "sp-gist-authed sp-gist-detached");
        popup.appendChild(item);
        
        item = doc.createElement("menuseparator");
        item.setAttribute("class", "sp-gist-authed sp-gist-attached");
        popup.appendChild(item);
        
        item = doc.createElement("menuitem");
        item.setAttribute("command", "sp-gist-cmd-fork");
        item.setAttribute("class", "sp-gist-authed sp-gist-attached sp-gist-other");
        item.addEventListener("command", this.refresh.bind(this));
        popup.appendChild(item);

        item = doc.createElement("menuitem");
        item.setAttribute("command", "sp-gist-cmd-refresh");
        item.setAttribute("class", "sp-gist-authed sp-gist-attached");
        item.addEventListener("command", this.refresh.bind(this));
        popup.appendChild(item);
        
        item = doc.createElement("menuitem");
        item.setAttribute("command", "sp-gist-cmd-update");
        item.setAttribute("class", "sp-gist-authed sp-gist-attached sp-gist-owned");
        item.addEventListener("command", this.update.bind(this));
        popup.appendChild(item);
    
        let help = doc.getElementById("sp-help-menu");
        menubar.insertBefore(menu, help);
        
        this.updateUI();
    },
    
    addToolbar: function() {
        let toolbar = this.doc.createElement("toolbar");
        toolbar.setAttribute("id", "sp-gist-toolbar");
        toolbar.setAttribute("class", "devtools-toolbar");
        toolbar.setAttribute("hidden", "true");

        let close = this.doc.createElement("toolbarbutton");
        close.setAttribute("id", "highlighter-closebutton");
        close.setAttribute("command", "sp-gist-cmd-detach");
        toolbar.appendChild(close);
        
        let label = this.doc.createElement("label");
        label.setAttribute("style", kLabelStyle);
        label.setAttribute("value", "Attached to gist:");
        toolbar.appendChild(label);
        
        let link = this.doc.createElement("label");
        link.setAttribute("id", "sp-gist-link");
        link.setAttribute("class", "text-link");
        link.setAttribute("style", kLabelStyle);
        toolbar.appendChild(link);

        let item = this.doc.createElement("toolbarspring");
        toolbar.appendChild(item);
        
        button = this.doc.createElement("toolbarbutton");
        button.setAttribute("command", "sp-gist-cmd-refresh");
        button.setAttribute("class", "devtools-toolbarbutton");
        toolbar.appendChild(button);

        let button = this.doc.createElement("toolbarbutton");
        button.setAttribute("command", "sp-gist-cmd-fork");
        button.setAttribute("class", "devtools-toolbarbutton sp-gist-other");
        toolbar.appendChild(button);

        button = this.doc.createElement("toolbarbutton");
        button.setAttribute("command", "sp-gist-cmd-update");
        button.setAttribute("class", "devtools-toolbarbutton sp-gist-owned");
        toolbar.appendChild(button);

        this.nbox.parentNode.insertBefore(toolbar, this.nbox);
    },
    
    updateUI: function() {
        let item = this.doc.getElementById("sp-gist-auth");        
        item.setAttribute("command", this.authtoken ? "sp-gist-cmd-signout" : "sp-gist-cmd-signin");

        let item = this.doc.getElementById("sp-gist-attach");
        item.setAttribute("command", this.attachedGist ? "sp-gist-cmd-detach" : "sp-gist-cmd-attach");
    
    
        let items = this.doc.querySelectorAll("#sp-gist-toolbar toolbarbutton, #sp-gist-menu menuitem, #sp-gist-menu menuseparator");
        
        let authed = !!this.authtoken;
        let attached = !!this.attachedGist;
        let own = attached && (this.attachedGist.user.id == this.authUser);

        for (var i = 0; i < items.length; i++) {
            let item = items[i];
            if ((item.classList.contains("sp-gist-authed") && !authed) ||
                (item.classList.contains("sp-gist-attached") && !attached) ||
                (item.classList.contains("sp-gist-detached") && attached) ||
                (item.classList.contains("sp-gist-owned") && !own) ||
                (item.classList.contains("sp-gist-other") && own))

                item.setAttribute("hidden", true);
            else
                item.removeAttribute("hidden");
        }
        
        if (this.attachedGist) {
            this.toolbar.hidden = false;
            this.toolbarLink.setAttribute("href", this.attachedGist.html_url);
            this.toolbarLink.setAttribute("value", this.attachedGist.html_url);
        } else {
            this.toolbar.hidden = true;
        }
    },

    signIn: function() {
        let username = {value:null};
        let password = {value:null};
        let check = {value:false};
        promptService.promptUsernameAndPassword(null, "GitHub Credentials", "Enter your github username and credentials.",
                                                username, password, "", check);

        let auth = "Basic " + this.win.btoa(username.value + ':' + password.value);
        this.findAuth(auth);
    },
    
    findAuth: function(auth) {
        // Find an existing Scratchpad Gist authorization.
        this.request({
            method: "GET",
            path: "/authorizations",
            auth: auth,
            success: function(response) {
                for each (let authorization in response) {
                    if (authorization.app.name == kAuthNote + " (API)") {
                        this.authorized(auth, authorization);
                        return;
                    }
                }
                this.createAuth(auth);
            }.bind(this)
        });
    },
    
    createAuth: function(auth) {
        this.request({
            method: "POST",
            path: "/authorizations",
            auth: auth,
            args: {
                scopes: ["gist"],
                note: kAuthNote,
                note_url: null
            },
            success: function(response) {
                this.authorized(auth, response);
            }.bind(this)
        });        
    },

    authorized: function(auth, authorization) {
        // Fetch information about the authorized user.
        this.request({
            path: "/user",
            auth: "token " + authorization.token,
            success: function(response) {    
                Services.prefs.setCharPref(kAuthIDPref, authorization.id);
                Services.prefs.setCharPref(kAuthTokenPref, authorization.token);
                Services.prefs.setCharPref(kUserPref, response.id);
                Services.obs.notifyObservers(null, "sp-gist-auth", "");
            }
        });
    },

    signOut: function() {
        Services.prefs.clearUserPref(kAuthTokenPref);
        Services.prefs.clearUserPref(kAuthIDPref);
        Services.obs.notifyObservers(null, "sp-gist-auth", "");
    },

    attach: function() {
        let val = {value: null};
        let check = {value:false};
        promptService.prompt(this.win, "Attach to Gist", "Enter the Gist ID or URL",  val, "", check);
        
        let id = val.value;
        let gistRE = new RegExp("gist.github.com/(.*)");
        let matches = id.match(gistRE);
        if (matches) {
            id = matches[1];
        }
    
        this.request({
            path: "/gists/" + id,
            success: function(response) {
                this.attached(response);
                this.load(response);
            }.bind(this),
            error: function() {
                this.win.alert("Couldn't find gist.");
            }.bind(this)
        });
    },
        
    attached: function(gist) {
        this.attachedGist = gist;
        this.updateUI();
    },
    
    fork: function() {
        this.request({
            method: "POST",
            path: "/gists/" + this.attachedGist.id + "/fork",
            success: function(response) {
                this.attached(response);
            }.bind(this),
        });
    },
    
    refresh: function() {
        if (!this.attachedGist) {
            this.win.alert("Not attached to a gist.");
            return;
        }
        this.request({
            method: "GET",
            path: "/gists/" + this.attachedGist.id,
            success: function(response) {
                this.load(response);
            }.bind(this)
        });
    },

    _getFile: function() {
        let files = {};
        
        let scratchpad = this.win.Scratchpad;
        let filename = "scratchpad.js";
        if (scratchpad.filename) {
            filename = scratchpad.filename;
            let lastSep = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
            if (lastSep > -1) {
                filename = filename.substring(lastSep + 1);
            }
        }
        files[filename] = {
            content: this.win.Scratchpad.getText()
        };
        return files;
    },
    
    create: function(pub) {
        this.request({
            method: "POST",
            path: "/gists",
            args: {
                description: null,
                public: pub,
                files: this._getFile(),
                
            },
            success: function(response) {
                this.attached(response);
            }.bind(this)
        });
    },
    
    update: function() {
        this.request({
            method: "PATCH",
            path: "/gists/" + this.attachedGist.id,
            args: {
                description: null,
                files: this._getFile()
            }
        });
    },
    
    load: function(gist) {
        for (var i in gist.files) {
            this.loadFile(gist, gist.files[i]);
            return;
        }
    },
    
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
    let e = windowMediator.getEnumerator(null);
    while (e.hasMoreElements()) {
        attachWindow(e.getNext());
    }
    windowMediator.addListener(WindowListener);
}

function shutdown(data, reason)
{
    // Should set a type in scratchpad.
    let e = windowMediator.getEnumerator(null);
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
    windowMediator.removeListener(WindowListener);
}

shutdown();
startup();