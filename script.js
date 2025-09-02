/* ===== CSV + Aggregation Utils ===== */
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
  const headers = rows[0].map((h) => h.trim());
  const data = rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => Object.fromEntries(headers.map((h, idx) => [h, (r[idx] ?? '').trim()])));
  return { headers, data };
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
function aggregate(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    const app_id = r.app_id || r.appId || r.app || '';
    const item_name =
      r.item_name || r.itemName || r.market_name || r.market_hash_name || r.name || '';
    const price = toInt(r.price_cents || r.priceCents || r.cents || r.price || 0);
    const qty = toQty(r.quantity || r.qty || r.count || 1);
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
    const avg_buy = qty_buy ? Math.round(b._sum_cents / qty_buy) : 0;
    const avg_sell = qty_sell ? Math.round(s._sum_cents / qty_sell) : 0;
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
      net_value,
    });
  }
  return out;
}

/* ===== Rendering ===== */
function escapeHtml(s) {
  return String(s == null ? '' : s)
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
      <td class="num">${(r.price_cents ?? 0).toLocaleString()}</td>
      <td class="num">${(r.quantity ?? 0).toLocaleString()}</td>
      <td class="num">${(r.total_cents ?? 0).toLocaleString()}</td>
    </tr>`
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
      <td class="num">${r.avg_buy.toLocaleString()}</td>
      <td class="num">${r.avg_sell.toLocaleString()}</td>
      <td class="num">${r.pl_pct == null ? '' : r.pl_pct.toFixed(2) + '%'}</td>
      <td class="num ${r.net_value >= 0 ? 'green' : 'red'}">${r.net_value.toLocaleString()}</td>
    </tr>`
    )
    .join('');
}
function renderTotals(el, rows, label) {
  const totalQty = rows.reduce((a, b) => a + (b.quantity || 0), 0);
  const totalValueCents = rows.reduce((a, b) => a + (b._sum_cents || b.total_cents || 0), 0);
  el.innerHTML = `
    <div class="card"><div class="label">Total Quantity</div><div class="value">${totalQty.toLocaleString()}</div></div>
    <div class="card"><div class="label">Total ${label} (¢)</div><div class="value ${
    label === 'Sold' ? 'green' : ''
  }">${totalValueCents.toLocaleString()}</div></div>
    <div class="card"><div class="label">Total ${label} ($)</div><div class="value ${
    label === 'Sold' ? 'green' : ''
  }">${(totalValueCents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}</div></div>`;
}
function renderNetTotals(el, rows) {
  const qtyBuy = rows.reduce((a, b) => a + (b.qty_buy || 0), 0);
  const qtySell = rows.reduce((a, b) => a + (b.qty_sell || 0), 0);
  const qtyNet = rows.reduce((a, b) => a + (b.qty_net || 0), 0);
  const netValue = rows.reduce((a, b) => a + (b.net_value || 0), 0);
  const avgPl = (() => {
    const arr = rows.map((r) => r.pl_pct).filter((v) => v != null && Number.isFinite(v));
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
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
    <div class="card"><div class="label">Net Value (¢)</div><div class="value ${
      netValue >= 0 ? 'green' : 'red'
    }">${netValue.toLocaleString()}</div></div>
    <div class="card"><div class="label">Net Value ($)</div><div class="value ${
      netValue >= 0 ? 'green' : 'red'
    }">${(netValue / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}</div></div>`;
}
function renderGrandTotals() {
  const el = document.getElementById('totalsSummary');
  const tb = state.boughtAggFiltered;
  const ts = state.soldAggFiltered;
  const totalBoughtCents = tb.reduce((a, b) => a + (b._sum_cents || b.total_cents || 0), 0);
  const totalSoldCents = ts.reduce((a, b) => a + (b._sum_cents || b.total_cents || 0), 0);
  const qtyBought = tb.reduce((a, b) => a + (b.quantity || 0), 0);
  const qtySold = ts.reduce((a, b) => a + (b.quantity || 0), 0);
  const netCents = totalSoldCents - totalBoughtCents;
  const netQty = qtySold - qtyBought;
  el.innerHTML = `
    <div class="card"><div class="label">Total Bought Qty</div><div class="value">${qtyBought.toLocaleString()}</div></div>
    <div class="card"><div class="label">Total Sold Qty</div><div class="value">${qtySold.toLocaleString()}</div></div>
    <div class="card"><div class="label">Net Qty (Sold − Bought)</div><div class="value ${
      netQty >= 0 ? 'green' : 'red'
    }">${netQty.toLocaleString()}</div></div>
    <div class="card"><div class="label">Total Bought (¢)</div><div class="value">${totalBoughtCents.toLocaleString()}</div></div>
    <div class="card"><div class="label">Total Sold (¢)</div><div class="value green">${totalSoldCents.toLocaleString()}</div></div>
    <div class="card"><div class="label">Net (¢)</div><div class="value ${
      netCents >= 0 ? 'green' : 'red'
    }">${netCents.toLocaleString()}</div></div>
    <div class="card"><div class="label">Net ($)</div><div class="value ${
      netCents >= 0 ? 'green' : 'red'
    }">${(netCents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}</div></div>`;
}

/* ===== Sorting ===== */
function makeSortable(table, rowsRef, renderFn) {
  const thead = table.querySelector('thead');
  let dir = 1,
    lastK = null;
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

/* ===== Export ===== */
function rowsToCSV(headers, rows, pick) {
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  const lines = [];
  lines.push(headers.join(','));
  for (const r of rows) {
    const row = headers.map((h) => esc(pick(r, h)));
    lines.push(row.join(','));
  }
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

/* ===== State ===== */
const state = {
  allRaw: [],
  boughtAgg: [],
  soldAgg: [],
  boughtAggFiltered: [],
  soldAggFiltered: [],
  netAggFiltered: [],
  filters: { app: '', name: '', min: null, max: null, from: null, to: null },
  serverFiles: [],
};

/* ===== Filtering & Loading ===== */
function applyFilters() {
  const app = state.filters.app.trim().toLowerCase();
  const name = state.filters.name.trim().toLowerCase();
  const min = state.filters.min,
    max = state.filters.max;
  const from = state.filters.from,
    to = state.filters.to;

  // 1) Raw-level date filtering first
  const raw =
    from == null && to == null
      ? state.allRaw
      : state.allRaw.filter((r) => {
          const ms = getTimestampMs(r);
          if (Number.isNaN(ms)) return false; // with date filter on, require a valid timestamp
          if (from != null && ms < from) return false;
          if (to != null && ms > to) return false;
          return true;
        });

  // 2) Split + aggregate
  const boughtAgg0 = aggregate(raw.filter((r) => normType(r.type) === 'bought'));
  const soldAgg0 = aggregate(raw.filter((r) => normType(r.type) === 'sold'));

  // 3) Aggregated-level attribute filters
  const inRange = (p) => {
    if (min != null && p < min) return false;
    if (max != null && p > max) return false;
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

  const ba = boughtAgg0.filter(fil).filter((r) => inRange(r.price_cents));
  const sa = soldAgg0.filter(fil).filter((r) => inRange(r.price_cents));
  const naAll = computeNet(ba, sa);
  const na = naAll.filter((r) => inRange(Math.max(r.avg_buy || 0, r.avg_sell || 0)));

  state.boughtAgg = boughtAgg0;
  state.soldAgg = soldAgg0;
  state.boughtAggFiltered = ba;
  state.soldAggFiltered = sa;
  state.netAggFiltered = na;

  renderTable(document.querySelector('#tblBought tbody'), ba);
  renderTable(document.querySelector('#tblSold tbody'), sa);
  renderNetTable(document.querySelector('#tblNet tbody'), na);
  renderTotals(document.getElementById('totalsBought'), ba, 'Bought');
  renderTotals(document.getElementById('totalsSold'), sa, 'Sold');
  renderNetTotals(document.getElementById('totalsNet'), na);
  renderGrandTotals();
}

async function loadUnifiedText(text) {
  const { data } = parseCSV(text);
  state.allRaw = data;
  applyFilters();
}
async function loadUnifiedFromFile(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  const text = await file.text();
  loadUnifiedText(text);
}
async function loadUnifiedFromPath(path) {
  try {
    const res = await fetch(path + `?t=${Date.now()}`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const text = await res.text();
    loadUnifiedText(text);
  } catch (err) {
    console.error('Failed to fetch', path, err);
    alert(
      `Failed to load ${path}:\n${err.message}\n\nTip: ensure the file exists and your dev server serves the /data folder.`
    );
  }
}

/* ===== Server helpers ===== */
async function refreshDataList(selectNewest = true) {
  try {
    const res = await fetch('/data-list');
    if (!res.ok) throw new Error('data-list ' + res.status);
    const j = await res.json();
    state.serverFiles = (j.files || []).filter((f) => /\.csv$/i.test(f.name));
    state.serverFiles.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
    const sel = document.getElementById('fileSelect');
    sel.innerHTML = state.serverFiles
      .map(
        (f) =>
          `<option value="${encodeURIComponent(f.name)}">${f.name} (${Math.round(
            (f.size || 0) / 1024
          )}KB)</option>`
      )
      .join('');
    if (selectNewest && state.serverFiles.length) {
      sel.selectedIndex = 0;
    }
  } catch (e) {
    console.warn('refreshDataList failed', e);
  }
}
async function uploadToServer(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file, file.name);
  try {
    const res = await fetch('/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error('upload ' + res.status);
    const j = await res.json();
    await refreshDataList(false);
    const sel = document.getElementById('fileSelect');
    for (let i = 0; i < sel.options.length; i++) {
      if (decodeURIComponent(sel.options[i].value) === j.name) {
        sel.selectedIndex = i;
        break;
      }
    }
    loadUnifiedFromPath('/data/' + encodeURIComponent(j.name));
  } catch (e) {
    alert('Upload failed: ' + e.message);
  } finally {
    inputEl.value = '';
  }
}

/* ===== Wireup ===== */
document.getElementById('fileAll').addEventListener('change', (e) => loadUnifiedFromFile(e.target));
document.getElementById('fileUpload').addEventListener('change', (e) => uploadToServer(e.target));
document.getElementById('btnLoadSelected').addEventListener('click', () => {
  const sel = document.getElementById('fileSelect');
  const name = decodeURIComponent(sel.value || '');
  if (name) loadUnifiedFromPath('/data/' + encodeURIComponent(name));
});
document.getElementById('btnRefresh').addEventListener('click', () => refreshDataList());

document.getElementById('btnApply').addEventListener('click', () => {
  state.filters.app = document.getElementById('fltApp').value;
  state.filters.name = document.getElementById('fltName').value;
  const minV = document.getElementById('fltMin').value;
  const maxV = document.getElementById('fltMax').value;
  const fromV = document.getElementById('fltFrom').value;
  const toV = document.getElementById('fltTo').value;
  state.filters.min = minV === '' ? null : Number(minV);
  state.filters.max = maxV === '' ? null : Number(maxV);
  state.filters.from = fromV ? new Date(fromV).getTime() : null;
  state.filters.to = toV ? new Date(toV).getTime() : null;
  applyFilters();
});
document.getElementById('btnClear').addEventListener('click', () => {
  state.filters = { app: '', name: '', min: null, max: null, from: null, to: null };
  document.getElementById('fltApp').value = '';
  document.getElementById('fltName').value = '';
  document.getElementById('fltMin').value = '';
  document.getElementById('fltMax').value = '';
  document.getElementById('fltFrom').value = '';
  document.getElementById('fltTo').value = '';
  applyFilters();
});

makeSortable(document.getElementById('tblBought'), { arr: state.boughtAggFiltered }, renderTable);
makeSortable(document.getElementById('tblSold'), { arr: state.soldAggFiltered }, renderTable);
makeSortable(document.getElementById('tblNet'), { arr: state.netAggFiltered }, renderNetTable);

document.getElementById('exportBought').addEventListener('click', () => {
  const headers = ['app_id', 'item_name', 'price_cents', 'quantity', 'total_cents'];
  const csv = rowsToCSV(headers, state.boughtAggFiltered, (r, h) => r[h]);
  downloadCSV('bought_agg.csv', csv);
});
document.getElementById('exportSold').addEventListener('click', () => {
  const headers = ['app_id', 'item_name', 'price_cents', 'quantity', 'total_cents'];
  const csv = rowsToCSV(headers, state.soldAggFiltered, (r, h) => r[h]);
  downloadCSV('sold_agg.csv', csv);
});
document.getElementById('exportNet').addEventListener('click', () => {
  const headers = [
    'app_id',
    'item_name',
    'qty_buy',
    'qty_sell',
    'qty_net',
    'avg_buy',
    'avg_sell',
    'pl_percent',
    'net_value',
  ];
  const csv = rowsToCSV(headers, state.netAggFiltered, (r, h) => {
    if (h === 'pl_percent')
      return state.netAggFiltered.find((x) => x === r).pl_pct == null ? '' : r.pl_pct.toFixed(2);
    return r[h];
  });
  downloadCSV('net_per_item.csv', csv);
});

// Init
refreshDataList(true);
