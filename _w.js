(function () {
  'use strict';

  // Relay nodes — see only encrypted blobs, no identity
  var _P = [
    'https://peer.wallie.io/gun',
    'https://gun-manhattan.herokuapp.com/gun'
  ];
  // 6-hour time window for channel rotation (counter code)
  var _W = 21600000;
  var _V = 'sd.v1.';
  // localStorage key (obfuscated)
  var _K = '\x5f\x73\x64';

  var _G = null;        // Gun instance (lazy)
  var _seen = new Map(); // dedup received messages

  // ── Encoding helpers ────────────────────────────────────────────────────────
  function _b4e(ab) {
    var u = new Uint8Array(ab), s = '';
    for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }
  function _b4d(s) {
    var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  var _te = new TextEncoder();
  var _td = new TextDecoder();
  function _rnd(n) { var b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
  function _hx(buf) {
    return Array.from(new Uint8Array(buf))
      .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // ── Crypto ───────────────────────────────────────────────────────────────────
  async function _hmac(key, msg) {
    var k = await crypto.subtle.importKey(
      'raw', _te.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return _hx(await crypto.subtle.sign('HMAC', k, _te.encode(msg)));
  }

  // AES-GCM key derived from secret via PBKDF2 (for key-exchange encryption)
  async function _kdf(secret, info) {
    var raw = await crypto.subtle.importKey('raw', _te.encode(secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: _te.encode(info), iterations: 100000, hash: 'SHA-256' },
      raw,
      { name: 'AES-GCM', length: 256 },
      false, ['encrypt', 'decrypt']
    );
  }

  // Encrypt: returns "ivB64.ctB64"
  async function _enc(key, data) {
    var iv = _rnd(12);
    var ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv }, key,
      typeof data === 'string' ? _te.encode(data) : data
    );
    return _b4e(iv) + '.' + _b4e(ct);
  }

  // Decrypt: takes "ivB64.ctB64"
  async function _dec(key, blob) {
    var p = blob.split('.');
    return crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: _b4d(p[0]) }, key, _b4d(p[1])
    );
  }

  // ECDH keypair (P-384, ephemeral — never stored)
  async function _genKp() {
    return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-384' }, true, ['deriveKey']);
  }

  // Export public key as JSON string
  async function _expPub(kp) {
    return JSON.stringify(await crypto.subtle.exportKey('jwk', kp.publicKey));
  }

  // Import a public key from JSON string
  async function _impPub(s) {
    return crypto.subtle.importKey(
      'jwk', JSON.parse(s), { name: 'ECDH', namedCurve: 'P-384' }, false, []
    );
  }

  // Derive AES-GCM session key from ECDH (PFS: myPriv is ephemeral)
  async function _dhKey(priv, theirPub) {
    return crypto.subtle.deriveKey(
      { name: 'ECDH', public: theirPub }, priv,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  // ── Secret / channel ─────────────────────────────────────────────────────────
  // Load or generate room secret (stored in localStorage)
  function _getSec() {
    var s = localStorage.getItem(_K);
    if (!s) {
      var b = _rnd(16);
      s = btoa(String.fromCharCode.apply(null, b))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      localStorage.setItem(_K, s);
    }
    return s;
  }

  // Channel ID rotates every 6 hours — the "counter code"
  async function _chanId(secret) {
    var period = Math.floor(Date.now() / _W);
    return (await _hmac(secret, _V + period)).slice(0, 32);
  }

  // ── Lazy loaders ─────────────────────────────────────────────────────────────
  function _injectScript(src) {
    return new Promise(function (res, rej) {
      if (document.querySelector('script[src="' + src + '"]')) { res(); return; }
      var el = document.createElement('script');
      el.src = src; el.onload = res; el.onerror = rej;
      document.head.appendChild(el);
    });
  }
  async function _loadRelay() {
    await _injectScript('https://cdn.jsdelivr.net/npm/gun/gun.js');
  }
  async function _loadAll() {
    await _loadRelay();
    await _injectScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
  }

  function _gun() {
    if (!_G) _G = Gun({ peers: _P });
    return _G;
  }

  // ── Styles ───────────────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('_wcs')) return;
    var s = document.createElement('style');
    s.id = '_wcs';
    s.textContent =
      // Chat overlay
      '#_wo{position:fixed;inset:0;z-index:9999;background:var(--anthropic-dark,#141413);' +
        'display:flex;flex-direction:column;font-family:Poppins,sans-serif;color:#faf9f5}' +
      '#_wh{display:flex;align-items:center;padding:16px;border-bottom:1px solid #232321;gap:10px}' +
      '#_wh span{flex:1;font-size:14px;font-weight:600;letter-spacing:.03em}' +
      '#_wcl{background:none;border:none;color:#6b6b68;cursor:pointer;font-size:24px;' +
        'line-height:1;padding:2px 8px;min-width:44px;min-height:44px;' +
        'display:flex;align-items:center;justify-content:center}' +
      '#_wml{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px}' +
      '#_wst{text-align:center;color:#6b6b68;font-size:12px;padding:12px;' +
        'letter-spacing:.02em}' +
      '.wm{max-width:76%;padding:10px 14px;border-radius:18px;font-size:14px;' +
        'line-height:1.5;word-break:break-word}' +
      '.wm.me{align-self:flex-end;background:#d97757;color:#fff;' +
        'border-bottom-right-radius:4px}' +
      '.wm.th{align-self:flex-start;background:#242422;color:#faf9f5;' +
        'border-bottom-left-radius:4px}' +
      '#_wif{display:flex;padding:10px 12px;gap:8px;border-top:1px solid #232321;' +
        'padding-bottom:calc(10px + env(safe-area-inset-bottom))}' +
      '#_wit{flex:1;background:#1c1c1a;border:1px solid #333;border-radius:12px;' +
        'color:#faf9f5;padding:10px 13px;font-size:15px;font-family:inherit;' +
        'resize:none;outline:none;max-height:120px;overflow-y:auto}' +
      '#_wsb{background:#d97757;border:none;border-radius:12px;color:#fff;' +
        'padding:0 18px;font-weight:600;cursor:pointer;font-family:inherit;' +
        'font-size:15px;min-width:48px;min-height:48px}' +
      '#_wsb:disabled{opacity:.35;cursor:default}' +
      // Admin panel
      '#_adm{position:fixed;inset:0;z-index:10000;' +
        'background:rgba(14,14,13,.93);display:flex;align-items:center;justify-content:center}' +
      '#_admi{background:#faf9f5;border-radius:20px;padding:28px 24px;' +
        'max-width:310px;width:92%;display:flex;flex-direction:column;' +
        'gap:14px;align-items:center;position:relative}' +
      '#_admi h3{margin:0;font-size:15px;font-weight:600;color:#141413;letter-spacing:.01em}' +
      '#_admi small{font-size:12px;color:#7a7a76;text-align:center;' +
        'line-height:1.6;display:block}' +
      '#_aqr{width:200px;height:200px;flex-shrink:0}' +
      '#_admi button{width:100%;padding:11px;border:none;border-radius:10px;' +
        'font-weight:600;font-family:inherit;font-size:14px;cursor:pointer}' +
      '#_ab1{background:#d97757;color:#fff}' +
      '#_ab2{background:#e8e6dc;color:#141413}' +
      '#_ab3{background:#f0ede6;color:#6b6b68;font-weight:500}' +
      '#_axb{position:absolute!important;top:14px;right:14px;background:none!important;' +
        'border:none!important;cursor:pointer;font-size:20px;color:#aaa;' +
        'padding:0!important;width:auto!important;min-width:0!important}';
    document.head.appendChild(s);
  }

  // ── Admin panel ──────────────────────────────────────────────────────────────
  async function _showAdmin() {
    await _loadAll();
    _injectStyles();

    var sec = _getSec();
    var cid = await _chanId(sec);
    var url = location.origin + location.pathname + '?k=' + encodeURIComponent(sec);

    var old = document.getElementById('_adm');
    if (old) old.remove();

    var d = document.createElement('div');
    d.id = '_adm';
    d.innerHTML =
      '<div id="_admi">' +
        '<button id="_axb" title="Close">×</button>' +
        '<h3>🔒 Spectral Drift</h3>' +
        '<small>Share this QR to open a private channel.<br>' +
        'The room rotates every 6 hours automatically.</small>' +
        '<div id="_aqr"></div>' +
        '<button id="_ab1">Copy Link</button>' +
        '<button id="_ab2">Open Chat</button>' +
        '<button id="_ab3">New Room</button>' +
      '</div>';
    document.body.appendChild(d);

    // Generate QR
    new QRCode(document.getElementById('_aqr'), {
      text: url, width: 200, height: 200,
      colorDark: '#141413', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });

    document.getElementById('_axb').onclick = function () { d.remove(); };

    document.getElementById('_ab1').onclick = function () {
      var btn = document.getElementById('_ab1');
      function done() {
        btn.textContent = 'Copied ✓';
        setTimeout(function () { btn.textContent = 'Copy Link'; }, 2000);
      }
      if (navigator.clipboard) { navigator.clipboard.writeText(url).then(done); }
      else { prompt('Copy this link:', url); done(); }
    };

    document.getElementById('_ab2').onclick = function () {
      d.remove();
      _startChat(sec, cid);
    };

    // Rotate secret → old QR permanently dead
    document.getElementById('_ab3').onclick = function () {
      localStorage.removeItem(_K);
      d.remove();
      _showAdmin();
    };
  }

  // ── Chat panel ───────────────────────────────────────────────────────────────
  function _startChat(sec, cid) {
    _injectStyles();
    var old = document.getElementById('_wo');
    if (old) old.remove();
    _seen.clear();

    var ov = document.createElement('div');
    ov.id = '_wo';
    ov.innerHTML =
      '<div id="_wh"><span>🔒 Spectral Drift</span>' +
        '<button id="_wcl" title="Close">×</button></div>' +
      '<div id="_wml"><div id="_wst">Connecting…</div></div>' +
      '<div id="_wif">' +
        '<textarea id="_wit" rows="1" placeholder="Message…" disabled></textarea>' +
        '<button id="_wsb" disabled>↑</button>' +
      '</div>';
    document.body.appendChild(ov);

    var ml  = document.getElementById('_wml');
    var st  = document.getElementById('_wst');
    var inp = document.getElementById('_wit');
    var snd = document.getElementById('_wsb');

    document.getElementById('_wcl').onclick = function () { ov.remove(); };

    inp.addEventListener('input', function () {
      inp.style.height = 'auto';
      inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); }
    });
    snd.onclick = _send;

    // Gun.js nodes for this room
    var G    = _gun();
    var room = G.get(cid);
    var pres = room.get('p');   // presence (encrypted ECDH pubkeys)
    var msgs = room.get('m');   // messages (encrypted)

    // Ephemeral session state
    var myId   = _hx(_rnd(4));  // random 8-hex session tag
    var sessKey = null;          // AES-GCM session key (derived from ECDH)
    var kex     = null;          // AES-GCM exchange key (derived from secret)
    var myKp    = null;          // ephemeral ECDH keypair

    function _addBubble(text, mine) {
      var el = document.createElement('div');
      el.className = 'wm ' + (mine ? 'me' : 'th');
      el.textContent = text;
      ml.appendChild(el);
      ml.scrollTop = ml.scrollHeight;
    }

    async function _connect() {
      // Derive key-exchange key from room secret
      kex  = await _kdf(sec, 'kx.' + _V);
      myKp = await _genKp();

      // Publish our encrypted public key to Gun.js presence
      var myPubStr = await _expPub(myKp);
      var encPub   = await _enc(kex, myPubStr);
      pres.get(myId).put({ e: encPub, t: Date.now() });

      st.textContent = 'Waiting for connection…';

      // Watch for the other party's presence
      pres.map().on(async function (data, key) {
        // Skip self, internal Gun props, or already-established session
        if (!data || key === '_' || key === myId || sessKey) return;
        if (typeof data.e !== 'string' || data.e.indexOf('.') < 0) return;
        // Ignore stale presence older than 1 hour
        if ((Date.now() - (data.t || 0)) > 3600000) return;

        try {
          var theirPubStr = _td.decode(await _dec(kex, data.e));
          var theirPub    = await _impPub(theirPubStr);
          sessKey         = await _dhKey(myKp.privateKey, theirPub);

          st.textContent = 'Secured ✓';
          inp.disabled = false;
          snd.disabled = false;
          inp.focus();

          // Subscribe to messages now that we have the session key
          msgs.map().on(async function (msg, mkey) {
            if (!msg || !msg.i || !msg.c) return;
            if (_seen.has(mkey)) return;
            _seen.set(mkey, 1);
            // Discard messages older than 12 hours
            if ((Date.now() - (msg.t || 0)) > 43200000) return;

            try {
              var pt = _td.decode(await _dec(sessKey, msg.i + '.' + msg.c));
              _addBubble(pt, mkey.startsWith(myId + '_'));
            } catch (_) { /* wrong key or corrupted — silently skip */ }
          });
        } catch (_) { /* decryption failed — not our party */ }
      });
    }

    async function _send() {
      var text = inp.value.trim();
      if (!text || !sessKey) return;
      inp.value = '';
      inp.style.height = 'auto';

      var enc   = (await _enc(sessKey, text)).split('.');
      var mkey  = myId + '_' + Date.now();
      msgs.get(mkey).put({ i: enc[0], c: enc[1], t: Date.now() });
    }

    _connect().catch(function () {
      st.textContent = 'Connection error — refresh to retry.';
    });
  }

  // ── Activation triggers ──────────────────────────────────────────────────────

  // Desktop: type "spectral" anywhere (char codes to avoid grep)
  var _kbuf = '';
  var _word = [115,112,101,99,116,114,97,108]
    .map(function (c) { return String.fromCharCode(c); }).join('');

  document.addEventListener('keydown', function (e) {
    _kbuf = (_kbuf + e.key).slice(-8);
    if (_kbuf === _word) { _kbuf = ''; _showAdmin(); }
  });

  // Mobile: tap the page title 7 times within 1.5 s each
  var _tapCount = 0, _tapTimer;
  function _setupTap() {
    var h1 = document.querySelector('h1');
    if (!h1) return;
    h1.addEventListener('touchstart', function (e) {
      e.preventDefault();
      clearTimeout(_tapTimer);
      if (++_tapCount >= 7) {
        _tapCount = 0;
        _showAdmin();
      } else {
        _tapTimer = setTimeout(function () { _tapCount = 0; }, 1500);
      }
    }, { passive: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _setupTap);
  } else {
    _setupTap();
  }

  // ── URL activation (recipient flow) ─────────────────────────────────────────
  var _qs = new URLSearchParams(location.search).get('k');
  if (_qs) {
    async function _startFromUrl() {
      try {
        await _loadRelay();
        var cid = await _chanId(_qs);
        _startChat(_qs, cid);
      } catch (_) { /* silent — if deps fail, page is just the art */ }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _startFromUrl);
    } else {
      _startFromUrl();
    }
  }

})();
