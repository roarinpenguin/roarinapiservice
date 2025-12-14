'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const CERTS_DIR = path.join(DATA_DIR, 'certs');

function ensureCertsDir() {
  if (!fs.existsSync(CERTS_DIR)) {
    fs.mkdirSync(CERTS_DIR, { recursive: true });
  }
}

function getSelfSignedPaths() {
  return {
    key: path.join(CERTS_DIR, 'selfsigned.key'),
    cert: path.join(CERTS_DIR, 'selfsigned.crt')
  };
}

function getCustomPaths() {
  return {
    key: path.join(CERTS_DIR, 'server.key'),
    cert: path.join(CERTS_DIR, 'server.crt')
  };
}

function selfSignedExists() {
  const paths = getSelfSignedPaths();
  return fs.existsSync(paths.key) && fs.existsSync(paths.cert);
}

function customCertsExist() {
  const paths = getCustomPaths();
  return fs.existsSync(paths.key) && fs.existsSync(paths.cert);
}

function generateSelfSigned() {
  ensureCertsDir();
  const paths = getSelfSignedPaths();
  
  // Check if already exists
  if (selfSignedExists()) {
    console.log('🔐 Self-signed certificates already exist');
    return paths;
  }
  
  console.log('🔐 Generating self-signed certificates...');
  
  try {
    // Generate self-signed certificate using openssl
    const subject = '/C=US/ST=State/L=City/O=RoarinAPI/OU=Dev/CN=localhost';
    const cmd = `openssl req -x509 -newkey rsa:4096 -keyout "${paths.key}" -out "${paths.cert}" -days 365 -nodes -subj "${subject}" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null`;
    
    execSync(cmd, { stdio: 'pipe' });
    
    console.log('🔐 Self-signed certificates generated successfully');
    return paths;
  } catch (err) {
    console.error('Failed to generate self-signed certificates:', err.message);
    console.log('Tip: Make sure openssl is installed on your system');
    return null;
  }
}

function saveCustomCertificate(keyData, certData) {
  ensureCertsDir();
  const paths = getCustomPaths();
  
  // Handle base64 data URLs
  let keyContent = keyData;
  let certContent = certData;
  
  if (keyData.startsWith('data:')) {
    const matches = keyData.match(/^data:[^;]+;base64,(.+)$/);
    if (matches) keyContent = Buffer.from(matches[1], 'base64').toString('utf8');
  }
  
  if (certData.startsWith('data:')) {
    const matches = certData.match(/^data:[^;]+;base64,(.+)$/);
    if (matches) certContent = Buffer.from(matches[1], 'base64').toString('utf8');
  }
  
  fs.writeFileSync(paths.key, keyContent);
  fs.writeFileSync(paths.cert, certContent);
  
  // Set proper permissions on key file
  try {
    fs.chmodSync(paths.key, 0o600);
  } catch (e) {
    // Ignore on Windows
  }
  
  console.log('🔐 Custom certificates saved');
  return paths;
}

function getCertificates(useCustom = false) {
  ensureCertsDir();
  
  if (useCustom && customCertsExist()) {
    const paths = getCustomPaths();
    return {
      key: fs.readFileSync(paths.key),
      cert: fs.readFileSync(paths.cert)
    };
  }
  
  // Generate self-signed if needed
  if (!selfSignedExists()) {
    generateSelfSigned();
  }
  
  if (selfSignedExists()) {
    const paths = getSelfSignedPaths();
    return {
      key: fs.readFileSync(paths.key),
      cert: fs.readFileSync(paths.cert)
    };
  }
  
  return null;
}

function getCertificateInfo() {
  const selfSigned = selfSignedExists();
  const custom = customCertsExist();
  
  let customInfo = null;
  if (custom) {
    try {
      const paths = getCustomPaths();
      const certContent = fs.readFileSync(paths.cert, 'utf8');
      // Extract basic info using openssl
      const info = execSync(`openssl x509 -in "${paths.cert}" -noout -subject -enddate 2>/dev/null`, { encoding: 'utf8' });
      customInfo = info.trim();
    } catch (e) {
      customInfo = 'Custom certificate present';
    }
  }
  
  return {
    selfSignedExists: selfSigned,
    customExists: custom,
    customInfo
  };
}

function deleteCustomCertificates() {
  const paths = getCustomPaths();
  try {
    if (fs.existsSync(paths.key)) fs.unlinkSync(paths.key);
    if (fs.existsSync(paths.cert)) fs.unlinkSync(paths.cert);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  generateSelfSigned,
  saveCustomCertificate,
  getCertificates,
  getCertificateInfo,
  deleteCustomCertificates,
  selfSignedExists,
  customCertsExist,
  CERTS_DIR
};
