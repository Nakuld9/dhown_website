/* BUSY Bridge dashboard.
 *
 * The admin key lives in sessionStorage for the life of the tab and is sent as
 * the X-Admin-Key header. It is never placed in a URL (where it would land in
 * logs and history) and never persisted to localStorage.
 *
 * This page talks only to the bridge's own admin API. It never contacts BUSY
 * directly and holds no BUSY credentials — those stay server-side.
 */
(function () {
  'use strict';

  var KEY_NAME = 'busy-bridge-admin-key';
  var REFRESH_MS = 15000;
  var adminKey = null;
  var activeTab = 'queue';
  var refreshTimer = null;

  // --- DOM helpers ---------------------------------------------------------
  function $(id) { return document.getElementById(id); }

  /** Always build nodes via textContent — never innerHTML with server data. */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function cell(text, className) {
    return el('td', className || null, text === null || text === undefined || text === '' ? '—' : text);
  }

  function pill(value) {
    var td = el('td');
    td.appendChild(el('span', 'pill pill--' + value, value));
    return td;
  }

  function button(label, className, onClick) {
    var b = el('button', 'btn btn--tiny ' + (className || ''), label);
    b.addEventListener('click', onClick);
    return b;
  }

  function when(value) {
    if (!value) return '—';
    var normalised = value.indexOf('T') === -1 ? value.replace(' ', 'T') + 'Z' : value;
    var d = new Date(normalised);
    return isNaN(d.getTime()) ? value : d.toLocaleString();
  }

  function toast(message, kind) {
    var node = $('toast');
    node.textContent = message;
    node.className = 'toast' + (kind ? ' toast--' + kind : '');
    node.hidden = false;
    clearTimeout(node._timer);
    node._timer = setTimeout(function () { node.hidden = true; }, 4500);
  }

  // --- API -----------------------------------------------------------------
  function api(path, options) {
    options = options || {};
    var headers = { 'X-Admin-Key': adminKey };
    if (options.body) headers['Content-Type'] = 'application/json';
    return fetch('/api/v1/admin' + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.status === 401) { lock('That key was not accepted.'); throw new Error('unauthorised'); }
        if (!res.ok) {
          var err = new Error((body.error && (body.error.reason || body.error.message)) || ('HTTP ' + res.status));
          err.payload = body.error;
          throw err;
        }
        return body;
      });
    });
  }

  // --- gate ----------------------------------------------------------------
  function lock(message) {
    adminKey = null;
    try { sessionStorage.removeItem(KEY_NAME); } catch (e) { /* private mode */ }
    clearInterval(refreshTimer);
    $('app').hidden = true;
    $('gate').style.display = '';
    if (message) { $('gate-error').textContent = message; $('gate-error').hidden = false; }
  }

  function unlock(key) {
    adminKey = key;
    return api('/overview').then(function (data) {
      try { sessionStorage.setItem(KEY_NAME, key); } catch (e) { /* private mode: session-only */ }
      $('gate').style.display = 'none';
      $('gate-error').hidden = true;
      $('app').hidden = false;
      render(data);
      loadTab();
      clearInterval(refreshTimer);
      refreshTimer = setInterval(refresh, REFRESH_MS);
    });
  }

  $('gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    unlock($('key-input').value.trim()).catch(function () {
      $('gate-error').textContent = 'That key was not accepted.';
      $('gate-error').hidden = false;
    });
  });

  // --- overview ------------------------------------------------------------
  function render(data) {
    var conn = data.connection || {};
    var tile = $('tile-connection');
    tile.className = 'tile tile--wide ' + (conn.online ? 'tile--online' : 'tile--offline');
    $('v-connection').textContent = conn.online ? 'Online' : 'Offline';
    $('v-connection-sub').textContent = conn.online
      ? 'Checked ' + when(conn.lastCheckedAt)
      : (conn.lastErrorMessage || 'BUSY is not reachable. Transactions are queued.');

    $('adapter-line').textContent =
      'Adapter: ' + (conn.adapter || '—') +
      (conn.capabilities && conn.capabilities.synchronousSend === false ? ' (asynchronous hand-off)' : '');

    $('v-lastsync').textContent = data.lastSuccessfulSync ? when(data.lastSuccessfulSync) : 'Never';
    $('v-lastsync-sub').textContent = data.lastSuccessfulSync ? '' : 'No transaction has completed yet.';

    var q = data.queue || {};
    $('v-pending').textContent = q.PENDING || 0;
    $('v-processing').textContent = q.PROCESSING || 0;
    $('v-awaiting').textContent = q.AWAITING_BUSY || 0;
    $('v-success').textContent = q.SUCCESS || 0;
    $('v-failed').textContent = q.FAILED || 0;
    $('v-manual').textContent = q.MANUAL_REVIEW || 0;
    $('v-today').textContent = data.todaysTransactions || 0;
    $('refreshed').textContent = 'Updated ' + new Date().toLocaleTimeString();

    renderCapabilities(conn.capabilities || {}, data.config || {});
  }

  function refresh() {
    api('/overview').then(render).then(loadTab).catch(function () { /* surfaced by loadTab */ });
  }

  function renderCapabilities(caps, config) {
    var tbody = $('t-caps').querySelector('tbody');
    tbody.textContent = '';
    Object.keys(caps).forEach(function (name) {
      var tr = el('tr');
      tr.appendChild(cell(name, 'mono'));
      var td = el('td');
      td.appendChild(el('span', 'pill pill--' + (caps[name] ? 'SUCCESS' : 'FAILED'), caps[name] ? 'yes' : 'no'));
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    $('cfg-dump').textContent = JSON.stringify(config, null, 2);
  }

  // --- tabs ----------------------------------------------------------------
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    tab.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.classList.remove('is-active'); });
      tab.classList.add('is-active');
      activeTab = tab.dataset.tab;
      ['queue', 'mappings', 'reconciliation', 'audit', 'capabilities'].forEach(function (name) {
        $('panel-' + name).hidden = name !== activeTab;
      });
      loadTab();
    });
  });

  function loadTab() {
    if (activeTab === 'queue') return loadQueue();
    if (activeTab === 'mappings') return loadMappings();
    if (activeTab === 'reconciliation') return loadReconciliation();
    if (activeTab === 'audit') return loadAudit();
    return Promise.resolve();
  }

  // --- queue ---------------------------------------------------------------
  function loadQueue() {
    var params = [];
    if ($('f-status').value) params.push('status=' + encodeURIComponent($('f-status').value));
    if ($('f-search').value.trim()) params.push('search=' + encodeURIComponent($('f-search').value.trim()));
    return api('/queue' + (params.length ? '?' + params.join('&') : ''))
      .then(function (data) {
        var tbody = $('t-queue').querySelector('tbody');
        tbody.textContent = '';
        $('queue-empty').hidden = data.items.length > 0;
        data.items.forEach(function (item) {
          var tr = el('tr');
          tr.appendChild(cell(item.externalReference, 'mono'));
          tr.appendChild(cell(item.entityType));
          tr.appendChild(cell(item.mesEntityId, 'mono'));
          tr.appendChild(pill(item.status));
          tr.appendChild(cell(item.attemptCount, 'num'));
          tr.appendChild(cell(item.busyReference, 'mono'));
          tr.appendChild(cell(when(item.updatedAt)));

          var actions = el('td', 'actions');
          actions.appendChild(button('Payload', '', function () { viewPayload(item.id); }));
          if (item.errorCode) actions.appendChild(button('Error', '', function () { viewError(item); }));
          if (item.status !== 'SUCCESS' && item.status !== 'PROCESSING') {
            actions.appendChild(button('Retry', '', function () { retry(item.id); }));
          }
          if (item.errorCode === 'MASTER_MAPPING_ERROR') {
            actions.appendChild(button('Fix mapping', '', function () { fixMappingDialog(item); }));
          }
          if (item.status === 'SUCCESS' || item.status === 'AWAITING_BUSY') {
            actions.appendChild(button('Reconcile', '', function () { reconcileOne(item.id); }));
            actions.appendChild(button('BUSY ref', '', function () { viewBusyReference(item.id); }));
          }
          tr.appendChild(actions);
          tbody.appendChild(tr);
        });
      })
      .catch(function (err) { toast(err.message, 'bad'); });
  }

  $('f-status').addEventListener('change', loadQueue);
  $('f-search').addEventListener('input', debounce(loadQueue, 300));

  function viewPayload(id) {
    api('/queue/' + id).then(function (data) {
      var body = $('modal-body');
      body.textContent = '';
      if (data.explanation) body.appendChild(explainBlock(data.explanation));
      body.appendChild(el('h3', null, 'Payload sent to BUSY'));
      body.appendChild(el('pre', 'code', JSON.stringify(data.item.payload, null, 2)));
      body.appendChild(el('h3', null, 'Audit trail'));
      (data.audit || []).forEach(function (entry) {
        body.appendChild(el('pre', 'code',
          when(entry.createdAt) + '  ' + entry.finalStatus +
          '  attempt ' + entry.attemptCount + '  by ' + entry.actor +
          (entry.busyReference ? '\nBUSY reference: ' + entry.busyReference : '') +
          (entry.errorCode ? '\n' + entry.errorCode + ': ' + entry.errorMessage : '') +
          (entry.busyResponse ? '\n\nBUSY response:\n' + entry.busyResponse : '')));
      });
      openModal('Transaction ' + data.item.externalReference);
    }).catch(function (err) { toast(err.message, 'bad'); });
  }

  function explainBlock(explanation) {
    var box = el('div', 'explain');
    var reason = el('div');
    reason.appendChild(el('strong', null, 'Reason'));
    reason.appendChild(el('p', null, explanation.reason));
    var action = el('div');
    action.appendChild(el('strong', null, 'Action'));
    action.appendChild(el('p', null, explanation.action));
    box.appendChild(reason);
    box.appendChild(action);
    return box;
  }

  function viewError(item) {
    api('/queue/' + item.id).then(function (data) {
      var body = $('modal-body');
      body.textContent = '';
      body.appendChild(el('p', 'mono', item.entityType + ' ' + item.mesEntityId + ' — ' + item.externalReference));
      if (data.explanation) body.appendChild(explainBlock(data.explanation));
      body.appendChild(el('pre', 'code', (item.errorCode || '') + '\n\n' + (item.errorMessage || '')));
      openModal('Failed: ' + item.externalReference);
    }).catch(function (err) { toast(err.message, 'bad'); });
  }

  function retry(id) {
    toast('Retrying…');
    api('/queue/' + id + '/retry', { method: 'POST' })
      .then(function (data) {
        toast('Retry finished: ' + data.outcome.status, data.outcome.status === 'SUCCESS' ? 'ok' : 'bad');
        refresh();
      })
      .catch(function (err) { toast(err.message, 'bad'); });
  }

  function reconcileOne(id) {
    api('/queue/' + id + '/reconcile', { method: 'POST' })
      .then(function (data) {
        var r = data.reconciliation;
        toast('Reconciliation: ' + r.result, r.result === 'MATCH' ? 'ok' : 'bad');
        if (r.result !== 'MATCH') {
          var body = $('modal-body');
          body.textContent = '';
          body.appendChild(el('pre', 'code', JSON.stringify(r.differences, null, 2)));
          openModal('Reconciliation: ' + r.result);
        }
        refresh();
      })
      .catch(function (err) { toast(err.message, 'bad'); });
  }

  function viewBusyReference(id) {
    api('/queue/' + id + '/busy-reference')
      .then(function (data) {
        var body = $('modal-body');
        body.textContent = '';
        body.appendChild(el('pre', 'code', JSON.stringify(data, null, 2)));
        openModal('BUSY reference');
      })
      .catch(function (err) { toast(err.message, 'bad'); });
  }

  // --- mappings ------------------------------------------------------------
  function loadMappings() {
    var unmappedOnly = $('f-map-unmapped').checked;
    var params = [];
    if ($('f-map-entity').value) params.push('entityType=' + encodeURIComponent($('f-map-entity').value));
    if (!unmappedOnly && $('f-map-search').value.trim()) {
      params.push('search=' + encodeURIComponent($('f-map-search').value.trim()));
    }
    var path = (unmappedOnly ? '/mappings/unmapped' : '/mappings') + (params.length ? '?' + params.join('&') : '');
    return api(path)
      .then(function (data) {
        var tbody = $('t-mappings').querySelector('tbody');
        tbody.textContent = '';
        $('map-empty').hidden = data.items.length > 0;
        data.items.forEach(function (m) {
          var tr = el('tr');
          tr.appendChild(cell(m.entityType));
          tr.appendChild(cell(m.mesId, 'mono'));
          tr.appendChild(cell(m.mesName));
          tr.appendChild(cell(m.busyId, 'mono'));
          tr.appendChild(cell(m.busyCode, 'mono'));
          tr.appendChild(pill(m.syncStatus));
          tr.appendChild(cell(when(m.lastSyncedAt)));
          var actions = el('td', 'actions');
          actions.appendChild(button(m.busyId ? 'Change' : 'Map', '', function () {
            fixMappingDialog({ entityType: m.entityType, mesEntityId: m.mesId, mesName: m.mesName });
          }));
          if (m.error) actions.appendChild(button('Error', '', function () {
            var body = $('modal-body');
            body.textContent = '';
            body.appendChild(el('pre', 'code', m.error));
            openModal('Mapping error');
          }));
          tr.appendChild(actions);
          tbody.appendChild(tr);
        });
      })
      .catch(function (err) { toast(err.message, 'bad'); });
  }

  $('f-map-entity').addEventListener('change', loadMappings);
  $('f-map-unmapped').addEventListener('change', loadMappings);
  $('f-map-search').addEventListener('input', debounce(loadMappings, 300));

  /**
   * "Fix Mapping". For a document that failed on an unmapped master, the
   * subject is the master named in the error, not the document itself.
   */
  function fixMappingDialog(item) {
    var entityType = item.entityType;
    var mesId = item.mesEntityId;
    if (item.errorCode === 'MASTER_MAPPING_ERROR' && item.explanation) {
      var match = /"([^"]+)"/.exec(item.explanation.reason || '');
      if (match) mesId = match[1];
      entityType = 'ITEM';
    }

    var body = $('modal-body');
    body.textContent = '';

    var typeField = el('div', 'field');
    typeField.appendChild(el('label', null, 'Entity type'));
    var typeInput = document.createElement('select');
    ['CUSTOMER', 'VENDOR', 'ITEM', 'WAREHOUSE'].forEach(function (t) {
      var o = el('option', null, t);
      if (t === entityType) o.selected = true;
      typeInput.appendChild(o);
    });
    typeField.appendChild(typeInput);

    var mesField = el('div', 'field');
    mesField.appendChild(el('label', null, 'MES id'));
    var mesInput = document.createElement('input');
    mesInput.value = mesId || '';
    mesField.appendChild(mesInput);

    var busyField = el('div', 'field');
    busyField.appendChild(el('label', null, 'BUSY id'));
    var busyInput = document.createElement('input');
    busyInput.placeholder = 'e.g. BUSY-4587';
    busyField.appendChild(busyInput);

    var codeField = el('div', 'field');
    codeField.appendChild(el('label', null, 'BUSY code (optional)'));
    var codeInput = document.createElement('input');
    codeField.appendChild(codeInput);

    body.appendChild(typeField);
    body.appendChild(mesField);
    body.appendChild(busyField);
    body.appendChild(codeField);
    body.appendChild(button('Save mapping', 'btn', function () {
      api('/mappings', {
        method: 'POST',
        body: {
          entityType: typeInput.value,
          mesId: mesInput.value.trim(),
          busyId: busyInput.value.trim(),
          busyCode: codeInput.value.trim() || undefined
        }
      }).then(function () {
        closeModal();
        toast('Mapping saved. Retry the transaction to send it to BUSY.', 'ok');
        refresh();
      }).catch(function (err) { toast(err.message, 'bad'); });
    }));

    openModal('Map MES record to BUSY');
  }

  // --- reconciliation ------------------------------------------------------
  function loadReconciliation() {
    return api('/reconciliation?resolved=false')
      .then(function (data) {
        var summary = $('recon-summary');
        summary.textContent = '';
        Object.keys(data.summary).forEach(function (k) {
          summary.appendChild(el('span', null, k + ': ' + data.summary[k]));
        });
        var tbody = $('t-recon').querySelector('tbody');
        tbody.textContent = '';
        $('recon-empty').hidden = data.items.length > 0;
        data.items.forEach(function (r) {
          var tr = el('tr');
          tr.appendChild(pill(r.result));
          tr.appendChild(cell(r.entityType));
          tr.appendChild(cell(r.externalReference, 'mono'));
          tr.appendChild(cell(r.busyReference, 'mono'));
          tr.appendChild(cell((r.differences || []).length + ' field(s)'));
          tr.appendChild(cell(when(r.createdAt)));
          var actions = el('td', 'actions');
          actions.appendChild(button('Details', '', function () {
            var body = $('modal-body');
            body.textContent = '';
            body.appendChild(el('pre', 'code', JSON.stringify(r.differences, null, 2)));
            openModal(r.result + ': ' + (r.externalReference || r.busyReference));
          }));
          actions.appendChild(button('Resolve', '', function () {
            api('/reconciliation/' + r.id + '/resolve', { method: 'POST' })
              .then(function () { toast('Marked resolved.', 'ok'); loadReconciliation(); })
              .catch(function (err) { toast(err.message, 'bad'); });
          }));
          tr.appendChild(actions);
          tbody.appendChild(tr);
        });
      })
      .catch(function (err) { toast(err.message, 'bad'); });
  }

  // --- audit ---------------------------------------------------------------
  function loadAudit() {
    return api('/audit?limit=200')
      .then(function (data) {
        var tbody = $('t-audit').querySelector('tbody');
        tbody.textContent = '';
        $('audit-empty').hidden = data.entries.length > 0;
        data.entries.forEach(function (e) {
          var tr = el('tr');
          tr.appendChild(cell(when(e.createdAt)));
          tr.appendChild(cell(e.entityType));
          tr.appendChild(cell(e.externalReference, 'mono'));
          tr.appendChild(cell(e.operation));
          tr.appendChild(cell(e.attemptCount, 'num'));
          tr.appendChild(cell(e.actor));
          tr.appendChild(cell(e.finalStatus));
          tr.appendChild(cell(e.busyReference, 'mono'));
          tr.appendChild(cell(e.errorCode));
          tbody.appendChild(tr);
        });
      })
      .catch(function (err) { toast(err.message, 'bad'); });
  }

  // --- modal + misc --------------------------------------------------------
  function openModal(title) {
    $('modal-title').textContent = title;
    $('modal').hidden = false;
  }
  function closeModal() { $('modal').hidden = true; }

  $('modal-close').addEventListener('click', closeModal);
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  $('btn-lock').addEventListener('click', function () { lock(null); });

  $('btn-test').addEventListener('click', function () {
    api('/connection/test', { method: 'POST' })
      .then(function (data) { toast(data.message, data.online ? 'ok' : 'bad'); refresh(); })
      .catch(function (err) { toast(err.message, 'bad'); });
  });

  $('btn-reconcile-run').addEventListener('click', function () {
    toast('Running reconciliation…');
    api('/reconciliation/run', { method: 'POST' })
      .then(function (data) {
        var s = data.summary;
        toast('Checked ' + s.checked + ': ' + s.MATCH + ' match, ' + s.MISMATCH + ' mismatch, ' +
              s.MISSING_IN_BUSY + ' missing in BUSY, ' + s.DUPLICATE + ' duplicate.',
              s.MISMATCH || s.MISSING_IN_BUSY || s.DUPLICATE ? 'bad' : 'ok');
        refresh();
      })
      .catch(function (err) { toast(err.message, 'bad'); });
  });

  $('btn-tick').addEventListener('click', function () {
    api('/worker/tick', { method: 'POST' })
      .then(function (data) {
        toast(data.online ? 'Processed ' + data.processed + ' item(s).' : 'BUSY is offline; queue held.',
              data.online ? 'ok' : 'bad');
        refresh();
      })
      .catch(function (err) { toast(err.message, 'bad'); });
  });

  function debounce(fn, ms) {
    var timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  // Resume an unlocked session if the tab was reloaded.
  var stored = null;
  try { stored = sessionStorage.getItem(KEY_NAME); } catch (e) { /* private mode */ }
  if (stored) {
    unlock(stored).catch(function () { lock(null); });
  }
})();
