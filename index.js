const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const AUTH_TOKEN = process.env.AUTH_TOKEN || 'let-th3PenguinR0ar!';

// Middleware to check auth token
function checkAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || auth !== `Bearer ${AUTH_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Public ping
app.get('/ping', (req, res) => {
  res.json({ message: 'pong ZW5kcG9pbnQgaXMgL2Nhcmxpc3QsIHRva2VuIGlzIGxldC10aDNQZW5ndWluUjBhciEK' });
});

// Secure car list
app.get('/carlist', checkAuth, (req, res) => {
  res.json([
    { "manufacturer": "Ford", "model": "Mustang GT500" },
    { "manufacturer": "Koenigsegg", "model": "Agera R" },
    { "manufacturer": "McLaren", "model": "P1" },
    { "manufacturer": "Lamborghini", "model": "Sesto Elemento" },
    { "manufacturer": "Bugatti", "model": "Veyron Super Sport" },
    { "manufacturer": "GTA", "model": "Spano" },
    { "manufacturer": "Saleen", "model": "S7" },
    { "manufacturer": "Chevrolet", "model": "Camaro" },
    { "manufacturer": "Dodge", "model": "Charger SRT8" },
    { "manufacturer": "Plymouth", "model": "Barracuda" }
  ]);
});

// Secure POST: submit
app.post('/submit', checkAuth, (req, res) => {
  const input = req.body;
  res.json({ received: input });
});

// Public status
app.get('/status', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Secure POST: echo
app.post('/echo', checkAuth, (req, res) => {
  res.json({ echo: req.body });
});

// 🔧 New endpoint: GET /blueprint
app.get('/blueprint', checkAuth, (req, res) => {
  const rpgParam = req.headers['rpginside'];

  if (!rpgParam || rpgParam !== 'rt.ru') {
    return res.status(403).json({ error: 'Missing or invalid rpginside header' });
  }

  const imagePath = path.join(__dirname, 'blueprint.png');

  fs.readFile(imagePath, (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Image not found or could not be read' });
    }

    const base64Image = `data:image/png;base64,${data.toString('base64')}`;
    res.json({ blueprint: base64Image });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
