const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'node_modules', 'simli-client', 'dist', 'index.js');

if (fs.existsSync(filePath)) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Fix 1: Linux case-sensitivity (capital C vs lowercase c)
  // Fix 2: Turbopack strict extension requirement (.js)
  content = content.replace('require("./Client.js")', 'require("./client.js")');
  content = content.replace('require("./Client")', 'require("./client.js")');
  
  fs.writeFileSync(filePath, content);
  console.log('Successfully patched simli-client case-sensitivity for Vercel.');
}