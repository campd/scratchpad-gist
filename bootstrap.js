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
var kLabelStyle = "color: hsl(210,30%,85%);text-shadow: 0 -1px 0 hsla(210,8%,5%,.45);";


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

    this.signIn = this.signIn.bind(this);
    this.signOut = this.signOut.bind(this);
    this.authChanged = this.authChanged.bind(this);
    
    Services.obs.addObserver(this.authChanged, "sp-gist-auth", false);

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
    
    destroy: function() {
        Services.obs.removeObserver(this.authChanged, "sp-gist-auth", false);

        if (this._authListener) {
            let item = this.win.document.getElementById("sp-gist-auth");
            item.removeEventListener("command", this._authListener, false);
            delete this._authListener;
        }

        if (this.menu) {
            this.menu.parentNode.removeChild(this.menu);
        }
        
        if (this.toolbar) {
            this.toolbar.parentNode.removeChild(this.toolbar);
        }
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
        // Clear out old processing instructions...
        let procs = this.win.gistProcs;
        if (procs) {
            for each (let proc in procs) {
                proc.parentNode.removeChild(proc);
            }
            delete this.win.gistProcs;
        }
        
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
    
    addToolbar: function() {
        let toolbar = this.doc.createElement("toolbar");
        toolbar.setAttribute("id", "sp-gist-toolbar");
        toolbar.setAttribute("class", "devtools-toolbar");
        toolbar.setAttribute("hidden", "true");

        let close = this.doc.createElement("toolbarbutton");
        close.setAttribute("id", "highlighter-closebutton");
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
        
        let button = this.doc.createElement("toolbarbutton");
        button.setAttribute("id", "sp-gist-fork");
        button.setAttribute("class", "devtools-toolbarbutton");
        button.setAttribute("label", "Fork");
        button.addEventListener("click", this.fork.bind(this), true);
        toolbar.appendChild(button);

        this.nbox.parentNode.insertBefore(toolbar, this.nbox);
    },
    
    updateToolbar: function() {
        this.toolbarLink.setAttribute("href", this.attachedGist.html_url);
        this.toolbarLink.setAttribute("value", this.attachedGist.html_url);
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

        let item = doc.createElement("menuitem");
        item.setAttribute("id", "sp-gist-attach");
        item.setAttribute("label", "Attach to Gist");
        item.setAttribute("class", "sp-gist-authed");
        item.addEventListener("command", this.attach.bind(this));
        popup.appendChild(item);
        
        item = doc.createElement("menuitem");
        item.setAttribute("id", "sp-gist-create");
        item.setAttribute("label", "New Private Gist");
        item.setAttribute("class", "sp-gist-authed");
        item.addEventListener("command", function() { this.create(false) }.bind(this));
        popup.appendChild(item);

        item = doc.createElement("menuitem");
        item.setAttribute("id", "sp-gist-create-public");
        item.setAttribute("label", "New Public Gist");
        item.setAttribute("class", "sp-gist-authed");
        item.addEventListener("command", function() { this.create(true) }.bind(this));
        popup.appendChild(item);
        
        item = doc.createElement("menuseparator");
        item.setAttribute("class", "sp-gist-authed");
        popup.appendChild(item);
        
        item = doc.createElement("menuitem");
        item.setAttribute("id", "sp-gist-refresh");
        item.setAttribute("label", "Refresh");
        item.setAttribute("class", "sp-gist-authed sp-gist-attached");
        item.addEventListener("command", this.refresh.bind(this));
        popup.appendChild(item);
        
        item = doc.createElement("menuitem");
        item.setAttribute("id", "sp-gist-update");
        item.setAttribute("label", "Update");
        item.setAttribute("class", "sp-gist-authed sp-gist-attached");
        item.addEventListener("command", this.update.bind(this));
        popup.appendChild(item);
    
        let help = doc.getElementById("sp-help-menu");
        menubar.insertBefore(menu, help);
        
        this.authChanged();
        this.updateMenu();
    },
    
    authChanged: function() {
        let item = this.win.document.getElementById("sp-gist-auth");
        
        if (this._authListener) {
            item.removeEventListener("command", this._authListener, false);
            delete this._authListener;
        }

        if (this.authtoken) {
            item.setAttribute("label", "Sign out");
            this._authListener = this.signOut;
        } else {
            item.setAttribute("label", "Sign in");
            this._authListener = this.signIn;
        }
        item.addEventListener("command", this._authListener, false);
        
        this.updateMenu();
    },
    
    updateMenu: function() {
        let items = this.win.document.querySelectorAll(".sp-gist-authed");
        let hide = !this.authtoken;
        for (let i = 0; i < items.length; i++) {
            items[i].hidden = hide;
        }
        
        items = this.win.document.querySelectorAll(".sp-gist-attached");
        let disabled = !this.attachedGist;
        for (let i = 0; i < items.length; i++) {
            if (disabled) {
                items[i].setAttribute("disabled", "true");
            } else {
                items[i].removeAttribute("disabled");
            }
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
        promptService.prompt(this.win, "Attach to Gist", "Enter the Gist ID",  val, "", check);
        
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
    
    fork: function() {
    alert("Forking!\n");
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
            method: "PATCH",
            path: "/gist/" + this.attachedGist.id,
            success: function(response) {
                this.load(response);
            }
        }.bind(this));
    },

    attached: function(gist) {
        this.attachedGist = gist;
        this.toolbar.hidden = false;
        this.updateMenu();
        this.updateToolbar();
    },

    _getFile: function() {
        let files = {};
        files[this.win.Scratchpad.filename] = {
            content: this.win.Scratchpad.getText()
        };
        return files;
    },
    
    create: function(pub) {
        this.request({
            method: "POST",
            path: "/gists",
            description: null,
            public: pub,
            files: this._getFile(),
            success: function(response) {
                this._attached(response);
            }.bind(this)
        });
    },
    
    update: function() {
        this.request({
            method: "PATCH",
            path: "/gists/" + this.attachedGist.id,
            files: this._getFile()
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