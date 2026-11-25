/* Manila Pampanga Go Taxi: page runtime.
   Renders each page's template (the markup inside <x-dc>) with the values returned by the page's
   renderVals(), and patches the DOM again whenever the page state changes.
   Supports {{ dotted.paths }}, <template data-sc="if">, <template data-sc="for">, on* handlers,
   value/checked bindings, setState / forceUpdate and componentDidMount / DidUpdate / WillUnmount. */
(function () {
  'use strict';

  /* ---------- base class used by each page's logic ---------- */
  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
    this._cbs = [];
    this._q = false;
  }
  DCLogic.prototype.setState = function (p, cb) {
    var n = typeof p === 'function' ? p(this.state, this.props) : p;
    if (n) this.state = Object.assign({}, this.state, n);
    if (cb) this._cbs.push(cb);
    this._schedule();
  };
  DCLogic.prototype.forceUpdate = function (cb) {
    if (cb) this._cbs.push(cb);
    this._schedule();
  };
  DCLogic.prototype._schedule = function () {
    var self = this;
    if (self._q) return;
    self._q = true;
    Promise.resolve().then(function () { self._q = false; if (self._render) self._render(); });
  };

  /* ---------- expressions ---------- */
  var HOLE = /\{\{\s*([^}]*?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/;

  function lookup(scope, path) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (path === 'undefined') return undefined;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var m = /^(['"])(.*)\1$/.exec(path);
    if (m) return m[2];
    var parts = path.split('.');
    var v = scope[parts[0]];
    for (var i = 1; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  function str(v) {
    if (v == null || typeof v === 'boolean' || typeof v === 'function') return '';
    return String(v);
  }
  function interp(text, scope) {
    return text.replace(HOLE, function (_, p) { return str(lookup(scope, p)); });
  }

  /* ---------- building fresh DOM from the template ---------- */
  var TEXTY = { text: 1, email: 1, tel: 1, number: 1, search: 1, url: 1, password: 1, date: 1, time: 1, 'datetime-local': 1, month: 1, week: 1 };
  function evType(name, el) {
    if (name === 'change') {
      var t = el.localName;
      if (t === 'textarea') return 'input';
      if (t === 'input' && TEXTY[(el.getAttribute('type') || 'text').toLowerCase()]) return 'input';
    }
    return name;
  }
  function ensureListeners(el) {
    if (!el._ev) return;
    el._lt = el._lt || {};
    Object.keys(el._ev).forEach(function (t) {
      if (el._lt[t]) return;
      el._lt[t] = 1;
      el.addEventListener(t, function (e) {
        var h = this._ev && this._ev[t];
        if (typeof h === 'function') h(e);
      });
    });
  }

  function buildList(nodes, scope, out) {
    for (var i = 0; i < nodes.length; i++) buildNode(nodes[i], scope, out);
  }

  function buildNode(node, scope, out) {
    if (node.nodeType === 3) {
      var tx = node.nodeValue;
      out.appendChild(document.createTextNode(tx.indexOf('{{') > -1 ? interp(tx, scope) : tx));
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'helmet' || tag === 'script') return;

    if (tag === 'template' && node.hasAttribute('data-sc')) {
      var kind = node.getAttribute('data-sc');
      var kids = node.content.childNodes;
      if (kind === 'if') {
        var cv = node.getAttribute('value') || '';
        var wm = WHOLE.exec(cv);
        var cond = wm ? lookup(scope, wm[1]) : cv;
        if (cond) buildList(kids, scope, out);
      } else if (kind === 'for') {
        var lv = node.getAttribute('list') || '';
        var lm = WHOLE.exec(lv);
        var list = lm ? lookup(scope, lm[1]) : null;
        var as = node.getAttribute('as') || 'item';
        if (list && list.length) {
          for (var k = 0; k < list.length; k++) {
            var s2 = Object.create(scope);
            s2[as] = list[k];
            s2.$index = k;
            buildList(kids, s2, out);
          }
        }
      }
      return;
    }

    var el = document.createElementNS(node.namespaceURI, node.localName);
    var props = null, evs = null, rawEvs = null;
    var isForm = tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'option';
    for (var a = 0; a < node.attributes.length; a++) {
      var at = node.attributes[a], name = at.name, val = at.value;
      var whole = WHOLE.exec(val);
      if (/^on[a-z]+$/.test(name) && whole) {
        var fn = lookup(scope, whole[1]);
        if (typeof fn === 'function') { rawEvs = rawEvs || []; rawEvs.push([name.slice(2), fn]); }
        continue;
      }
      if (whole) {
        var raw = lookup(scope, whole[1]);
        if (isForm && (name === 'value' || name === 'checked' || name === 'selected')) {
          props = props || {};
          props[name] = name === 'value' ? str(raw) : !!raw;
          continue;
        }
        if (typeof raw === 'function' || raw == null) continue;
        if (typeof raw === 'boolean') {
          if (/^(aria-|data-)/.test(name)) el.setAttribute(name, raw ? 'true' : 'false');
          else if (raw) el.setAttribute(name, '');
          continue;
        }
        el.setAttribute(name, String(raw));
      } else if (val.indexOf('{{') > -1) {
        el.setAttribute(name, interp(val, scope));
      } else {
        try { el.setAttribute(name, val); } catch (e) {}
      }
    }
    if (rawEvs) { evs = {}; rawEvs.forEach(function (r) { evs[evType(r[0], el)] = r[1]; }); }
    buildList(tag === 'template' ? node.content.childNodes : node.childNodes, scope, el);
    if (props) {
      el._props = props;
      applyProps(el);
    }
    if (evs) { el._ev = evs; ensureListeners(el); }
    out.appendChild(el);
  }

  function applyProps(el) {
    var p = el._props;
    if (!p) return;
    if ('value' in p && el.value !== p.value) el.value = p.value;
    if ('checked' in p && el.checked !== p.checked) el.checked = p.checked;
    if ('selected' in p && el.selected !== p.selected) el.selected = p.selected;
  }

  /* ---------- patching the live DOM ---------- */
  var I18N_ATTRS = ['placeholder', 'aria-label', 'alt', 'title'];

  function sameKind(a, b) {
    if (a.nodeType !== b.nodeType) return false;
    if (a.nodeType === 1) return a.localName === b.localName && a.namespaceURI === b.namespaceURI;
    return true;
  }
  function syncAttrs(l, f) {
    var i, at;
    for (i = 0; i < f.attributes.length; i++) {
      at = f.attributes[i];
      if (at.name === 'open' && l.localName === 'details') continue;
      var cur = l.getAttribute(at.name);
      if (cur === at.value) continue;
      if (I18N_ATTRS.indexOf(at.name) > -1 && l.__enAttr && l.__enAttr[at.name]) {
        var st = l.__enAttr[at.name];
        if (st.en === at.value && st.tr !== undefined && cur === st.tr) continue;
      }
      l.setAttribute(at.name, at.value);
    }
    for (i = l.attributes.length - 1; i >= 0; i--) {
      at = l.attributes[i];
      if (at.name === 'open' && l.localName === 'details') continue;
      if (!f.hasAttribute(at.name)) l.removeAttribute(at.name);
    }
  }
  function patchNode(l, f) {
    if (l.nodeType === 3) {
      if (l.nodeValue === f.nodeValue) return;
      if (l.__en !== undefined && l.__tr !== undefined && l.nodeValue === l.__tr && l.__en === f.nodeValue) return;
      l.nodeValue = f.nodeValue;
      return;
    }
    if (l.nodeType !== 1) return;
    syncAttrs(l, f);
    l._ev = f._ev;
    l._props = f._props;
    ensureListeners(l);
    patchChildren(l, f);
    applyProps(l);
  }
  function patchChildren(lp, fp) {
    var fc = Array.prototype.slice.call(fp.childNodes);
    var i = 0;
    for (; i < fc.length; i++) {
      var l = lp.childNodes[i], f = fc[i];
      if (!l) { lp.appendChild(f); continue; }
      if (sameKind(l, f)) patchNode(l, f);
      else lp.replaceChild(f, l);
    }
    while (lp.childNodes.length > fc.length) lp.removeChild(lp.lastChild);
  }

  /* ---------- mounting a page ---------- */
  function mount() {
    var root = document.querySelector('x-dc');
    var script = document.querySelector('script[data-dc-script]');
    if (!root || !script) return;

    var st = document.createElement('style');
    st.textContent = 'x-dc{display:block}';
    document.head.appendChild(st);

    Array.prototype.slice.call(root.querySelectorAll('helmet')).forEach(function (h) {
      Array.prototype.slice.call(h.childNodes).forEach(function (c) { if (c.nodeType === 1) document.head.appendChild(c); });
      h.parentNode.removeChild(h);
    });

    var tpl = Array.prototype.slice.call(root.childNodes);
    while (root.firstChild) root.removeChild(root.firstChild);

    var props = {};
    try {
      var dp = JSON.parse(script.getAttribute('data-props') || '{}');
      Object.keys(dp).forEach(function (k) { if (k !== '$preview' && dp[k] && 'default' in dp[k]) props[k] = dp[k].default; });
    } catch (e) {}

    var Comp;
    try { Comp = new Function('DCLogic', script.textContent + '\n;return Component;')(DCLogic); }
    catch (e) { console.error('Page script failed', e); return; }
    var inst = new Comp(props);
    var first = true;
    inst._render = function () {
      var vals;
      try { vals = inst.renderVals() || {}; } catch (e) { console.error('renderVals failed', e); return; }
      var scope = Object.assign(Object.create(null), vals);
      var holder = document.createElement('div');
      buildList(tpl, scope, holder);
      var prevState = inst._prevState;
      if (first) {
        while (holder.firstChild) root.appendChild(holder.firstChild);
      } else {
        patchChildren(root, holder);
      }
      inst._prevState = inst.state;
      var cbs = inst._cbs; inst._cbs = [];
      try {
        if (first) { first = false; if (inst.componentDidMount) inst.componentDidMount(); }
        else if (inst.componentDidUpdate) inst.componentDidUpdate(inst.props, prevState);
      } catch (e) { console.error(e); }
      cbs.forEach(function (c) { try { c(); } catch (e) {} });
    };
    window.addEventListener('pagehide', function () { try { if (inst.componentWillUnmount) inst.componentWillUnmount(); } catch (e) {} });
    inst._render();

    /* canonical link from the address the site is served on */
    try {
      if (!document.querySelector('link[rel="canonical"]') && location.protocol.indexOf('http') === 0) {
        var c = document.createElement('link');
        c.rel = 'canonical';
        c.href = location.origin + location.pathname.replace(/\/index\.html$/, '/');
        document.head.appendChild(c);
      }
    } catch (e) {}
  }

  window.DCLogic = DCLogic;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
