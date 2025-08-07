const express = require('express');
const app = express();
app.use(express.json());

const AUTH_TOKEN = process.env.AUTH_TOKEN || 'mysecrettoken';

// Middleware to check token
function checkAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || auth !== `Bearer ${AUTH_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Public test endpoint
app.get('/ping', (req, res) => {
  res.json({ message: 'pong' });
});

// Protected GET: /carlist
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

// Protected POST: /submit
app.post('/submit', checkAuth, (req, res) => {
  const input = req.body;
  res.json({ received: input });
});

// Public GET: /status
app.get('/status', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Protected POST: /echo
app.post('/echo', checkAuth, (req, res) => {
  res.json({ echo: req.body });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));

