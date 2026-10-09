import process from 'node:process';

const [major, minor] = process.versions.node.split('.').map(Number);
const supported = major > 22 || (major === 22 && minor >= 19);

if (!supported) {
  console.error(`Node.js 22.19.0 or newer is required by GAGA Engine 0.1.6. Current: ${process.versions.node}`);
  process.exit(1);
}

console.log(`Node.js ${process.versions.node}: supported.`);
