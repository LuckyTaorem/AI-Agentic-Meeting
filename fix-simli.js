const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'node_modules', 'simli-client', 'dist', 'index.js');

if (fs.existsSync(filePath)) {
  const content = fs.readFileSync(filePath, 'utf8');
  // Fix the missing .js extension typo from the package authors
  const fixedContent = content.replace('require("./Client")', 'require("./Client.js")');
  fs.writeFileSync(filePath, fixedContent);
  console.log('Successfully patched simli-client import typo.');
}