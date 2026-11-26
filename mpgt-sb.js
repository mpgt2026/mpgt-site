/* Manila Pampanga Go Taxi: live database layer.
   Talks to Supabase over plain HTTPS (no SDK). The URL and the publishable key below are
   meant to be public; what each visitor can do is limited by the database rules (RLS). */
(function () {
  var cfg = window.MPGT_CFG || {
    url: 'https://mxkrsciiaofatycrgjby.supabase.co',
    key: 'sb_publishable_OxSAn5UQtPxigd3DZh6lEg_kPDEqCLf'
  };
  var M = window.MPGT = { on: !!(cfg && cfg.url && cfg.key), url: String((cfg && cfg.url) || '').replace(/\/+$/, ''), key: cfg && cfg.key };
  if (!M.on) return;

  var SKEY = 'mpgt.sb.session', OBKEY = 'mpgt.outbox.v1', CFGKEYS = ['rates', 'extras', 'vehicles', 'destinations'];
  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function ldel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // stable stringify (Postgres jsonb does not keep key order)
  function canon(v) {
    if (v === undefined || v === null) return 'null';
    if (typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }
  M.canon = canon;
  M.rid = function (bytes) {
    var a = new Uint8Array(bytes || 8), s = '';
    try { (window.crypto || window.msCrypto).getRandomValues(a); } catch (e) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < a.length; j++) s += (a[j] < 16 ? '0' : '') + a[j].toString(16);
    return s;
  };
  function encPath(p) { return String(p).split('/').map(encodeURIComponent).join('/'); }

  function mkErr(res, text) {
    var msg = text;
    try { var j = JSON.parse(text); msg = j.message || j.msg || j.error_description || j.error || text; } catch (e) {}
    var e = new Error(msg || ('HTTP ' + res.status));
    e.status = res.status;
    return e;
  }

  // ---- raw request -------------------------------------------------------
  M.req = function (method, path, body, o) {
    o = o || {};
    var h = { apikey: M.key };
    if (o.token) h.Authorization = 'Bearer ' + o.token;
    if (body !== undefined && !o.raw) h['Content-Type'] = 'application/json';
    if (o.headers) for (var k in o.headers) h[k] = o.headers[k];
    if (o.prefer) h.Prefer = o.prefer;
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, o.timeout || 20000) : null;
    return fetch(M.url + path, {
      method: method, headers: h,
      body: body === undefined ? undefined : (o.raw ? body : JSON.stringify(body)),
      signal: ctl ? ctl.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (text) {
        if (!res.ok) throw mkErr(res, text);
        if (!text) return null;
        try { return JSON.parse(text); } catch (e) { return text; }
      });
    }, function () {
      if (timer) clearTimeout(timer);
      var e = new Error('Network error'); e.status = 0; e.net = true; throw e;
    });
  };

  // ---- admin session -----------------------------------------------------
  M.session = function () {
    try { var s = JSON.parse(lget(SKEY)); return s && s.access_token ? s : null; } catch (e) { return null; }
  };
  function saveSession(r) {
    var s = {
      access_token: r.access_token, refresh_token: r.refresh_token,
      expires_at: Date.now() + Math.max(60, Number(r.expires_in) || 3600) * 1000,
      email: (r.user && r.user.email) || (M.session() || {}).email || ''
    };
    lset(SKEY, JSON.stringify(s));
    return s;
  }
  M.login = function (email, password) {
    return M.req('POST', '/auth/v1/token?grant_type=password', { email: email, password: password }).then(saveSession);
  };
  M.logout = function () {
    var s = M.session(); ldel(SKEY);
    if (s) { M.req('POST', '/auth/v1/logout', {}, { token: s.access_token }).catch(function () {}); }
  };
  var refreshing = null;
  M.token = function () {
    var s = M.session();
    if (!s) { var e = new Error('Not signed in'); e.status = 401; return Promise.reject(e); }
    if (s.expires_at - Date.now() > 60000) return Promise.resolve(s.access_token);
    if (!refreshing) {
      refreshing = M.req('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token })
        .then(function (r) { refreshing = null; return saveSession(r).access_token; },
              function (err) { refreshing = null; if (err.status === 400 || err.status === 401) ldel(SKEY); throw err; });
    }
    return refreshing;
  };
  M.areq = function (method, path, body, o, retried) {
    return M.token().then(function (t) {
      var o2 = {}; for (var k in (o || {})) o2[k] = o[k]; o2.token = t;
      return M.req(method, path, body, o2);
    }).catch(function (err) {
      if (err && err.status === 401 && !retried) {
        var s = M.session(); if (s) { s.expires_at = 0; lset(SKEY, JSON.stringify(s)); return M.areq(method, path, body, o, true); }
      }
      throw err;
    });
  };
  M.isAdmin = function () { return M.areq('POST', '/rest/v1/rpc/is_admin', {}).then(function (ok) { return ok === true; }); };

  // ---- files -------------------------------------------------------------
  M.upload = function (bucket, path, blob, ctype, token) {
    return M.req('POST', '/storage/v1/object/' + bucket + '/' + encPath(path), blob, {
      raw: true, token: token, timeout: 60000,
      headers: { 'Content-Type': ctype || blob.type || 'application/octet-stream', 'x-upsert': 'false' }
    });
  };
  M.publicUrl = function (bucket, path) { return M.url + '/storage/v1/object/public/' + bucket + '/' + encPath(path); };
  M.signedUrl = function (bucket, path) {
    return M.areq('POST', '/storage/v1/object/sign/' + bucket + '/' + encPath(path), { expiresIn: 3600 }).then(function (r) {
      var u = (r && (r.signedURL || r.signedUrl)) || '';
      if (!u) throw new Error('No link');
      return /^https?:/.test(u) ? u : M.url + '/storage/v1' + u;
    });
  };
  M.removeFile = function (bucket, path) { return M.areq('DELETE', '/storage/v1/object/' + bucket + '/' + encPath(path)); };
  M.dataUrlToBlob = function (d) {
    var p = String(d).split(','), m = /data:([^;]+)/.exec(p[0]);
    var bin = atob(p[1]), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: m ? m[1] : 'image/jpeg' });
  };
  function mimeOf(file) {
    var t = (file && file.type) || '';
    if (t) return t;
    var ext = (/\.([a-z0-9]{2,5})$/i.exec((file && file.name) || '') || [])[1];
    ext = (ext || '').toLowerCase();
    return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf' })[ext] || 'application/octet-stream';
  }

  // ---- website content set in Admin (rates, vehicles, destinations) ------
  M.loadConfig = function () {
    return M.req('GET', '/rest/v1/site_config?select=key,value').then(function (rows) {
      var o = {}; (rows || []).forEach(function (r) { o[r.key] = r.value; }); return o;
    });
  };
  function syncSite() {
    if (/^\/admin(\/|$|\.html)/.test(location.pathname)) return;
    M.loadConfig().then(function (db) {
      var IMGMIG = {"/assets/43a34c26030adece67c21ac79f3f96e0.jpg": "/assets/8eeaf8899d4febdb3bc89174abf0552e.jpg", "/assets/6ab722698b2020a04a7914b34213061c.jpg": "/assets/6c56b61a14b76fb0df220cf1928818ce.jpg", "/assets/705fb8381a3910ad624da9b1b7caab3f.jpg": "/assets/6f23e6069027b0fa08409bbc70479693.jpg"};
      if (Array.isArray(db.destinations)) db.destinations = db.destinations.map(function (d) { return d && IMGMIG[d.img] ? Object.assign({}, d, { img: IMGMIG[d.img] }) : d; });
      var cur = {}; try { cur = JSON.parse(lget('mpgt.admin.v1')) || {}; } catch (e) {}
      var next = {}, changed = false;
      CFGKEYS.forEach(function (k) {
        if (Array.isArray(db[k])) { next[k] = db[k]; if (canon(db[k]) !== canon(cur[k])) changed = true; }
        else if (cur[k] !== undefined) next[k] = cur[k];
      });
      var hadBookings = cur.bookings !== undefined;
      if (changed || hadBookings) lset('mpgt.admin.v1', JSON.stringify(next));
      if (changed && (window.performance && performance.now() < 8000)) {
        var last = 0; try { last = Number(sessionStorage.getItem('mpgt.cfg.rl')) || 0; } catch (e) {}
        if (Date.now() - last > 15000) { try { sessionStorage.setItem('mpgt.cfg.rl', String(Date.now())); } catch (e) {} location.reload(); }
      }
    }).catch(function () {});
  }

  // ---- bookings ----------------------------------------------------------
  M.submitBooking = function (rec, token, file) {
    return Promise.resolve().then(function () {
      if (file && !rec.receipt) {
        var ext = ((/\.([a-z0-9]{2,5})$/i.exec(file.name || '') || [])[1] || 'jpg').toLowerCase();
        var path = rec.ref + '-' + String(token).slice(0, 6) + '/' + Date.now() + '.' + ext;
        return M.upload('receipts', path, file, mimeOf(file)).then(function () {
          rec.receipt = path; rec.receiptName = String(file.name || 'receipt').slice(0, 80);
        });
      }
    }).then(function () {
      return M.req('POST', '/rest/v1/rpc/submit_booking', { p_ref: rec.ref, p_token: token, p_data: rec });
    });
  };
  var outbox = {
    list: function () { try { var j = JSON.parse(lget(OBKEY)); return Array.isArray(j) ? j : []; } catch (e) { return []; } },
    save: function (l) { lset(OBKEY, JSON.stringify(l.slice(-20))); },
    add: function (item) { var l = outbox.list().filter(function (x) { return x.rec.ref !== item.rec.ref; }); l.push(item); outbox.save(l); },
    drop: function (ref) { outbox.save(outbox.list().filter(function (x) { return x.rec.ref !== ref; })); },
    flush: function () {
      outbox.list().forEach(function (it) {
        M.submitBooking(it.rec, it.token, null).then(function () { outbox.drop(it.rec.ref); }, function (err) {
          if (err && !err.net && err.status >= 400 && err.status < 500) outbox.drop(it.rec.ref);
        });
      });
    }
  };
  M.outbox = outbox;

  // ---- reviews -----------------------------------------------------------
  M.approvedReviews = function () {
    return M.req('GET', '/rest/v1/reviews?select=id,name,trip,rating,text,photo,created_at&status=eq.approved&order=created_at.desc&limit=60');
  };
  M.submitReview = function (rev, dataUrl) {
    var photoP = Promise.resolve('');
    if (dataUrl) {
      var path = new Date().toISOString().slice(0, 7) + '/' + M.rid(8) + '.jpg';
      photoP = M.upload('review-photos', path, M.dataUrlToBlob(dataUrl), 'image/jpeg').then(function () { return M.publicUrl('review-photos', path); });
    }
    return photoP.then(function (photo) {
      return M.req('POST', '/rest/v1/reviews', { name: rev.name, trip: rev.trip || '', rating: rev.rating, text: rev.text || '', photo: photo, status: 'pending' }, { prefer: 'return=minimal' });
    });
  };

  // ---- track -------------------------------------------------------------
  M.trackBooking = function (ref, contact) {
    return M.req('POST', '/rest/v1/rpc/track_booking', { p_ref: ref, p_contact: contact });
  };

  // ---- confirmation email (admin only; sent by the /api/send-confirmation function) ----
  M.sendConfirmation = function (ref) {
    var base = (window.MPGT_API || '');
    return M.token().then(function (t) {
      if (!t) throw { status: 401 };
      return fetch(base + '/api/send-confirmation', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ ref: ref }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.httpStatus = r.status; return j; }); });
    });
  };

  // ---- rebook ------------------------------------------------------------
  M.submitRebook = function (r) {
    return M.req('POST', '/rest/v1/rebook_requests', { digits: String(r.digits), date: r.date, time: r.time, note: r.note || '' }, { prefer: 'return=minimal' });
  };

  function boot() { syncSite(); outbox.flush(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
