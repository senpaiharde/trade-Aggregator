function parseCSV(text) {
  const rows = [];
  let i = 0,
    field = '',
    row = [],
    inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (c === '\r') {
        /* ignore */
      } else field += c;
    }
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return { headers: [], data: [] };

  // Normalize headers: lower-case, replace spaces & symbols with "_"
  const rawHeaders = rows[0].map((h) => h.trim());
  const normHeader = (h) =>
    h
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const headers = rawHeaders.map(normHeader);

  const data = rows
    .slice(1)
    .filter((r) => r.some((c) => (c ?? '').trim() !== ''))
    .map((r) => Object.fromEntries(headers.map((h, idx) => [h, (r[idx] ?? '').trim()])));
  return { headers, data };
}

function getAppId(r) {
  return r.app_id ?? r.appid ?? r.app ?? r.app__id ?? '';
}
function getItemName(r) {
  return r.item_name ?? r.itemname ?? r.market_name ?? r.market_hash_name ?? r.name ?? '';
}
function getItemId(r) {
  return r.item_id ?? r.itemid ?? r.id ?? '';
}
function getPriceCents(r) {
  // prefer price_cents; else "price" is treated as shekels and scaled *100
  if (r.price_cents != null && r.price_cents !== '') return toInt(r.price_cents);
  if (r.cents != null && r.cents !== '') return toInt(r.cents);
  if (r.price != null && r.price !== '') return Math.round(Number(r.price) * 100);
  return 0;
}
function getQuantity(r) {
  const q = r.quantity ?? r.qty ?? r.count;
  return toQty(q);
}

/* ===== Normalization helpers (unchanged) ===== */
function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
function toQty(x) {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n | 0 : 1;
}
function normType(t) {
  const s = String(t || '')
    .trim()
    .toLowerCase();
  if (['sale', 'sold', 'sell'].includes(s)) return 'sold';
  if (['purchase', 'buy', 'bought'].includes(s)) return 'bought';
  return '';
}
function getTimestampMs(r) {
  // works now with normalized headers too
  const keys = ['timestamp', 'ts', 'time', 'date', 'created_at', 'datetime', 'updated_at'];
  for (const k of keys) {
    if (r[k] != null && r[k] !== '') {
      const s = String(r[k]).trim();
      if (/^\d{13}$/.test(s)) return Number(s);
      if (/^\d{10}$/.test(s)) return Number(s) * 1000;
      const ms = Date.parse(s);
      return Number.isNaN(ms) ? NaN : ms;
    }
  }
  return NaN;
}
function keyOf(r) {
  const itemId = getItemId(r);
  const app = getAppId(r);
  const name = getItemName(r);
  return itemId ? String(itemId) : `${app}::${name}`;
}
function keyOf(r) {
  const itemId = r.item_id || r.itemId || r.id || '';
  const app = r.app_id || r.appId || r.app || '';
  const name = r.item_name || r.itemName || r.market_name || r.market_hash_name || r.name || '';
  return itemId ? String(itemId) : `${app}::${name}`;
}
function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
function toQty(x) {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n | 0 : 1;
}
function normType(t) {
  const s = String(t || '')
    .trim()
    .toLowerCase();
  if (['sale', 'sold', 'sell'].includes(s)) return 'sold';
  if (['purchase', 'buy', 'bought'].includes(s)) return 'bought';
  return '';
}
function getTimestampMs(r) {
  const keys = ['timestamp', 'ts', 'time', 'date', 'created_at', 'datetime', 'updated_at'];
  let v = null;
  for (const k of keys) {
    if (r[k] != null && r[k] !== '') {
      v = r[k];
      break;
    }
  }
  if (v == null) return NaN;
  const s = String(v).trim();
  if (/^\d{13}$/.test(s)) return Number(s);
  if (/^\d{10}$/.test(s)) return Number(s) * 1000;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? NaN : ms;
}

/* ===== Aggregation =====
   Assumes CSV contains price in "agorot" (cents).
   We DISPLAY shekels (₪) by dividing by 100 in render/export. */
function aggregate(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    const app_id = getAppId(r);
    const item_name = getItemName(r);
    const price = getPriceCents(r);
    const qty = getQuantity(r);
    const cur = map.get(k) || { key: k, app_id, item_name, qty: 0, sum: 0 };
    cur.qty += qty;
    cur.sum += price * qty; // cents
    map.set(k, cur);
  }
  return Array.from(map.values()).map((x) => ({
    key: x.key,
    app_id: x.app_id,
    item_name: x.item_name,
    price_cents: x.qty ? Math.round(x.sum / x.qty) : 0,
    quantity: x.qty,
    total_cents: x.sum,
    _sum_cents: x.sum,
  }));
}

function computeNet(boughtAgg, soldAgg) {
  const bm = new Map();
  for (const b of boughtAgg) bm.set(b.key || keyOf(b), b);
  const sm = new Map();
  for (const s of soldAgg) sm.set(s.key || keyOf(s), s);
  const keys = new Set([...bm.keys(), ...sm.keys()]);
  const out = [];
  for (const k of keys) {
    const b = bm.get(k) || {
      app_id: '',
      item_name: '',
      quantity: 0,
      _sum_cents: 0,
      price_cents: 0,
    };
    const s = sm.get(k) || {
      app_id: '',
      item_name: '',
      quantity: 0,
      _sum_cents: 0,
      price_cents: 0,
    };
    const app_id = s.app_id || b.app_id;
    const item_name = s.item_name || b.item_name;
    const qty_buy = b.quantity | 0;
    const qty_sell = s.quantity | 0;
    const qty_net = qty_sell - qty_buy;
    const avg_buy = qty_buy ? Math.round(b._sum_cents / qty_buy) : 0; // cents
    const avg_sell = qty_sell ? Math.round(s._sum_cents / qty_sell) : 0; // cents
    const net_value = (s._sum_cents | 0) - (b._sum_cents | 0); // cents
    const pl_pct = avg_buy > 0 ? (avg_sell / avg_buy - 1) * 100 : null;
    out.push({
      key: k,
      app_id,
      item_name,
      qty_buy,
      qty_sell,
      qty_net,
      avg_buy,
      avg_sell,
      pl_pct,
      net_value, // cents
      net_shekels: net_value / 100, // ₪
    });
  }
  return out;
}

/* ===== State ===== */
const state = {
  allRaw: [], // merged raw rows from ALL /data/*.csv
  boughtAgg: [],
  soldAgg: [],
  boughtAggFiltered: [],
  soldAggFiltered: [],
  netAggFiltered: [],
  filters: { app: '', name: '', min: null, max: null, from: null, to: null }, // min/max in ₪
  serverFiles: [],
};

/* ===== Rendering ===== */
function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function renderTable(tbody, rows) {
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td><span class="pill">${escapeHtml(r.app_id)}</span></td>
      <td>${escapeHtml(r.item_name)}</td>
      <td class="num">₪ ${(r.price_cents / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}</td>
      <td class="num">${(r.quantity ?? 0).toLocaleString()}</td>
      <td class="num">₪ ${(r.total_cents / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}</td>
    </tr>
  `
    )
    .join('');
}

function renderNetTable(tbody, rows) {
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td><span class="pill">${escapeHtml(r.app_id)}</span></td>
      <td>${escapeHtml(r.item_name)}</td>
      <td class="num">${r.qty_buy.toLocaleString()}</td>
      <td class="num">${r.qty_sell.toLocaleString()}</td>
      <td class="num ${r.qty_net >= 0 ? 'green' : 'red'}">${r.qty_net.toLocaleString()}</td>
      <td class="num">₪ ${(r.avg_buy / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}</td>
      <td class="num">₪ ${(r.avg_sell / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}</td>
      <td class="num">${r.pl_pct == null ? '' : r.pl_pct.toFixed(2) + '%'}</td>
      <td class="num ${r.net_shekels >= 0 ? 'green' : 'red'}">₪ ${r.net_shekels.toLocaleString(
        undefined,
        { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      )}</td>
    </tr>
  `
    )
    .join('');
}

function renderTotals(el, rows, label) {
  const totalQty = rows.reduce((a, b) => a + (b.quantity || 0), 0);
  const totalCents = rows.reduce((a, b) => a + (b._sum_cents || b.total_cents || 0), 0);
  el.innerHTML = `
    <div class="card"><div class="label">Total Quantity</div><div class="value">${totalQty.toLocaleString()}</div></div>
    <div class="card"><div class="label">Total ${label} (₪)</div><div class="value ${
    label === 'Sold' ? 'green' : ''
  }">₪ ${(totalCents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}</div></div>
  `;
}

function renderNetTotals(el, rows) {
  const qtyBuy = rows.reduce((a, b) => a + (b.qty_buy || 0), 0);
  const qtySell = rows.reduce((a, b) => a + (b.qty_sell || 0), 0);
  const qtyNet = rows.reduce((a, b) => a + (b.qty_net || 0), 0);
  const netCents = rows.reduce((a, b) => a + (b.net_value || 0), 0);
  const netShekels = netCents / 100;
  const avgPl = (() => {
    const arr = rows.map((r) => r.pl_pct).filter((v) => v != null && Number.isFinite(v));
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  })();
  el.innerHTML = `
    <div class="card"><div class="label">Buy Qty (Σ)</div><div class="value">${qtyBuy.toLocaleString()}</div></div>
    <div class="card"><div class="label">Sell Qty (Σ)</div><div class="value">${qtySell.toLocaleString()}</div></div>
    <div class="card"><div class="label">Net Qty (Σ)</div><div class="value ${
      qtyNet >= 0 ? 'green' : 'red'
    }">${qtyNet.toLocaleString()}</div></div>
    <div class="card"><div class="label">Avg P/L %</div><div class="value">${
      avgPl == null ? '' : avgPl.toFixed(2) + '%'
    }</div></div>
    <div class="card"><div class="label">Net (₪)</div><div class="value ${
      netShekels >= 0 ? 'green' : 'red'
    }">₪ ${netShekels.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}</div></div>
  `;
}

function renderGrandTotals() {
  const el = document.getElementById('totalsSummary');
  const tb = state.boughtAggFiltered,
    ts = state.soldAggFiltered;
  const totalBoughtCents = tb.reduce((a, b) => a + (b._sum_cents || b.total_cents || 0), 0);
  const totalSoldCents = ts.reduce((a, b) => a + (b._sum_cents || b.total_cents || 0), 0);
  const qtyBought = tb.reduce((a, b) => a + (b.quantity || 0), 0);
  const qtySold = ts.reduce((a, b) => a + (b.quantity || 0), 0);
  const netCents = totalSoldCents - totalBoughtCents;
  const netQty = qtySold - qtyBought;
  el.innerHTML = `
    <div class="card"><div class="label">Total Bought Qty</div><div class="value">${qtyBought.toLocaleString()}</div></div>
    <div class="card"><div class="label">Total Sold Qty</div><div class="value">${qtySold.toLocaleString()}</div></div>
    <div class="card"><div class="label">Net Qty</div><div class="value ${
      netQty >= 0 ? 'green' : 'red'
    }">${netQty.toLocaleString()}</div></div>
    <div class="card"><div class="label">Net (₪)</div><div class="value ${
      netCents >= 0 ? 'green' : 'red'
    }">₪ ${(netCents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}</div></div>
  `;
}

/* ===== Sorting ===== */
function makeSortable(table, rowsRef, renderFn) {
  const thead = table.querySelector('thead');
  let dir = 1,
    lastK = null;
  if (!thead) return;
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (!th) return;
    const k = th.dataset.k;
    if (!k) return;
    if (k === lastK) dir *= -1;
    else {
      dir = 1;
      lastK = k;
    }
    rowsRef.arr.sort((a, b) => {
      const va = a[k],
        vb = b[k];
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    renderFn(table.querySelector('tbody'), rowsRef.arr);
  });
}

/* ===== Export (optional if buttons exist) ===== */
function rowsToCSV(headers, rows, pick) {
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(pick(r, h))).join(','));
  return lines.join('\n');
}
function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ===== Filtering & recompute ===== */
function applyFilters() {
  const app = state.filters.app.trim().toLowerCase();
  const name = state.filters.name.trim().toLowerCase();
  const minShek = state.filters.min,
    maxShek = state.filters.max;
  const from = state.filters.from,
    to = state.filters.to;

  // 1) Raw-level date filter (if set, require valid ts)
  const raw =
    from == null && to == null
      ? state.allRaw
      : state.allRaw.filter((r) => {
          const ms = getTimestampMs(r);
          if (Number.isNaN(ms)) return false;
          if (from != null && ms < from) return false;
          if (to != null && ms > to) return false;
          return true;
        });
  const boughtAgg0 = aggregate(
    raw.filter((r) => normType(r.type || r.transaction_type) === 'bought')
  );
  const soldAgg0 = aggregate(raw.filter((r) => normType(r.type || r.transaction_type) === 'sold'));
  // 3) Attribute & price range (entered in ₪ -> compare in cents)
  const inRangeCents = (pCents) => {
    const p = Number(pCents);
    if (minShek != null && p < Math.round(minShek * 100)) return false;
    if (maxShek != null && p > Math.round(maxShek * 100)) return false;
    return true;
  };
  const fil = (row) => {
    if (
      app &&
      String(row.app_id || '')
        .toLowerCase()
        .indexOf(app) === -1
    )
      return false;
    if (
      name &&
      String(row.item_name || '')
        .toLowerCase()
        .indexOf(name) === -1
    )
      return false;
    return true;
  };
  function log(...a) {
    console.log('[TA]', ...a);
  }
  async function autoLoadAllCSVs() {
    await refreshDataList();
    if (!state.serverFiles.length) {
      log('No .csv files in /data');
      state.allRaw = [];
      applyFilters();
      return;
    }
    const names = state.serverFiles.map((f) => f.name);
    const datasets = await Promise.all(
      names.map((n) =>
        fetchCSVRows('/data/' + encodeURIComponent(n)).catch((e) => {
          log('read fail', n, e);
          return [];
        })
      )
    );
    state.allRaw = datasets.flat();
    log('merged rows:', state.allRaw.length);
    applyFilters();
  }
  const ba = boughtAgg0.filter(fil).filter((r) => inRangeCents(r.price_cents));
  const sa = soldAgg0.filter(fil).filter((r) => inRangeCents(r.price_cents));
  const na = computeNet(ba, sa).filter((r) =>
    inRangeCents(Math.max(r.avg_buy || 0, r.avg_sell || 0))
  );

  state.boughtAgg = boughtAgg0;
  state.soldAgg = soldAgg0;
  state.boughtAggFiltered = ba;
  state.soldAggFiltered = sa;
  state.netAggFiltered = na;

  // Render
  renderTable(document.querySelector('#tblBought tbody'), ba);
  renderTable(document.querySelector('#tblSold tbody'), sa);
  renderNetTable(document.querySelector('#tblNet tbody'), na);
  renderTotals(document.getElementById('totalsBought'), ba, 'Bought');
  renderTotals(document.getElementById('totalsSold'), sa, 'Sold');
  renderNetTotals(document.getElementById('totalsNet'), na);
  renderGrandTotals();
}

/* ===== Loaders ===== */
async function fetchCSVRows(path) {
  const res = await fetch(path + `?t=${Date.now()}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const text = await res.text();
  return parseCSV(text).data;
}

async function refreshDataList() {
  const res = await fetch('/data-list');
  if (!res.ok) throw new Error('data-list ' + res.status);
  const j = await res.json();
  state.serverFiles = (j.files || []).filter((f) => /\.csv$/i.test(f.name));
  state.serverFiles.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
}

async function autoLoadAllCSVs() {
  await refreshDataList(); // GET /data-list  (served by server.js)  [static /data also served]
  if (!state.serverFiles.length) {
    // ok if empty — UI stays blank
    state.allRaw = [];
    applyFilters();
    return;
  }
  const allNames = state.serverFiles.map((f) => f.name);
  const datasets = await Promise.all(
    allNames.map((n) => fetchCSVRows('/data/' + encodeURIComponent(n)).catch(() => []))
  );
  state.allRaw = datasets.flat();
  applyFilters();
}

/* ===== Wire-up ===== */
function safeBind(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

document.addEventListener('DOMContentLoaded', () => {
  // Filters
  safeBind('btnApply', () => {
    state.filters.app = document.getElementById('fltApp')?.value || '';
    state.filters.name = document.getElementById('fltName')?.value || '';
    const minV = document.getElementById('fltMin')?.value ?? '';
    const maxV = document.getElementById('fltMax')?.value ?? '';
    const fromV = document.getElementById('fltFrom')?.value ?? '';
    const toV = document.getElementById('fltTo')?.value ?? '';
    state.filters.min = minV === '' ? null : Number(minV);
    state.filters.max = maxV === '' ? null : Number(maxV);
    state.filters.from = fromV ? new Date(fromV).getTime() : null;
    state.filters.to = toV ? new Date(toV).getTime() : null;
    applyFilters();
  });
  safeBind('btnClear', () => {
    state.filters = { app: '', name: '', min: null, max: null, from: null, to: null };
    if (document.getElementById('fltApp')) document.getElementById('fltApp').value = '';
    if (document.getElementById('fltName')) document.getElementById('fltName').value = '';
    if (document.getElementById('fltMin')) document.getElementById('fltMin').value = '';
    if (document.getElementById('fltMax')) document.getElementById('fltMax').value = '';
    if (document.getElementById('fltFrom')) document.getElementById('fltFrom').value = '';
    if (document.getElementById('fltTo')) document.getElementById('fltTo').value = '';
    applyFilters();
  });

  // Optional export buttons if present in your HTML
  safeBind('exportBought', () => {
    const headers = ['app_id', 'item_name', 'avg_price_shekels', 'quantity', 'total_shekels'];
    const csv = rowsToCSV(headers, state.boughtAggFiltered, (r, h) => {
      switch (h) {
        case 'avg_price_shekels':
          return (r.price_cents / 100).toFixed(2);
        case 'total_shekels':
          return (r.total_cents / 100).toFixed(2);
        default:
          return r[h];
      }
    });
    downloadCSV('bought_agg.csv', csv);
  });
  safeBind('exportSold', () => {
    const headers = ['app_id', 'item_name', 'avg_price_shekels', 'quantity', 'total_shekels'];
    const csv = rowsToCSV(headers, state.soldAggFiltered, (r, h) => {
      switch (h) {
        case 'avg_price_shekels':
          return (r.price_cents / 100).toFixed(2);
        case 'total_shekels':
          return (r.total_cents / 100).toFixed(2);
        default:
          return r[h];
      }
    });
    downloadCSV('sold_agg.csv', csv);
  });
  safeBind('exportNet', () => {
    const headers = [
      'app_id',
      'item_name',
      'qty_buy',
      'qty_sell',
      'qty_net',
      'avg_buy_shekels',
      'avg_sell_shekels',
      'pl_percent',
      'net_shekels',
    ];
    const csv = rowsToCSV(headers, state.netAggFiltered, (r, h) => {
      switch (h) {
        case 'avg_buy_shekels':
          return (r.avg_buy / 100).toFixed(2);
        case 'avg_sell_shekels':
          return (r.avg_sell / 100).toFixed(2);
        case 'pl_percent':
          return r.pl_pct == null ? '' : r.pl_pct.toFixed(2);
        case 'net_shekels':
          return (r.net_value / 100).toFixed(2);
        default:
          return r[h];
      }
    });
    downloadCSV('net_per_item.csv', csv);
  });

  // Sortable tables
  makeSortable(document.getElementById('tblBought'), { arr: state.boughtAggFiltered }, renderTable);
  makeSortable(document.getElementById('tblSold'), { arr: state.soldAggFiltered }, renderTable);
  makeSortable(document.getElementById('tblNet'), { arr: state.netAggFiltered }, renderNetTable);

  // Auto-load & combine everything in /data
  autoLoadAllCSVs(); // Uses /data-list and static /data/* from your server.  (server.js)
});
