function parseCSV(text) {
  renderTotals(document.getElementById('totalsBought'), ba, 'Bought');
  renderTotals(document.getElementById('totalsSold'), sa, 'Sold');
  renderNetTotals(document.getElementById('totalsNet'), na);
  renderGrandTotals();
}

function clearFilters() {
  state.filters = { app: '', name: '', min: null, max: null };
  document.getElementById('fltApp').value = '';
  document.getElementById('fltName').value = '';
  document.getElementById('fltMin').value = '';
  document.getElementById('fltMax').value = '';
  applyFilters();
}


async function loadUnifiedText(text) {
  const { data } = parseCSV(text);
  state.allRaw = data;
  const bought = data.filter((r) => normType(r.type) === 'bought');
  const sold = data.filter((r) => normType(r.type) === 'sold');
  state.boughtRaw = bought;
  state.soldRaw = sold;
  state.boughtAgg = aggregate(bought);
  state.soldAgg = aggregate(sold);

  state.boughtAggFiltered = [...state.boughtAgg];
  state.soldAggFiltered = [...state.soldAgg];
  state.netAggFiltered = computeNet(state.boughtAgg, state.soldAgg);
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
    alert(`Failed to load ${path}:
${err.message}


Tip: ensure the file exists and your dev server serves the /data folder.`);
  }
}


document.getElementById('fileAll').addEventListener('change', (e) => loadUnifiedFromFile(e.target));
document
  .getElementById('reloadAll')
  .addEventListener('click', () => loadUnifiedFromPath('./data/transactions.csv'));

document.getElementById('btnApply').addEventListener('click', () => {
  state.filters.app = document.getElementById('fltApp').value;
  state.filters.name = document.getElementById('fltName').value;
  const minV = document.getElementById('fltMin').value;
  const maxV = document.getElementById('fltMax').value;
  state.filters.min = minV === '' ? null : Number(minV);
  state.filters.max = maxV === '' ? null : Number(maxV);
  applyFilters();
});
document.getElementById('btnClear').addEventListener('click', clearFilters);

makeSortable(document.getElementById('tblBought'), { arr: state.boughtAggFiltered }, renderTable);
makeSortable(document.getElementById('tblSold'), { arr: state.soldAggFiltered }, renderTable);
makeSortable(document.getElementById('tblNet'), { arr: state.netAggFiltered }, renderNetTable);
