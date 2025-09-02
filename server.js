
const express = require('express');
const multer  = require('multer');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');


fs.mkdirSync(DATA_DIR, { recursive: true });


app.use(express.static(ROOT_DIR));
app.use('/data', express.static(DATA_DIR));


const upload = multer({ storage: multer.diskStorage({
  destination: (req, file, cb) => cb(null, DATA_DIR),
  filename: (req, file, cb) => cb(null, file.originalname.replace(/[^\w\-.]+/g,'_'))
})});


app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  return res.json({ ok: true, name: req.file.filename, size: req.file.size });
});


app.get('/data-list', async (req, res) => {
  try {
    const names = await fsp.readdir(DATA_DIR);
    const files = [];
    for (const name of names){
      if (!name.toLowerCase().endsWith('.csv')) continue;
      const st = await fsp.stat(path.join(DATA_DIR, name));
      files.push({ name, size: st.size, mtimeMs: st.mtimeMs });
    }
    files.sort((a,b)=> b.mtimeMs - a.mtimeMs);
    res.json({ files });
  } catch (e){
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log('Server running at http://localhost:'+PORT));
