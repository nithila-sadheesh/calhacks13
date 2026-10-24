// `npm run phone`: serves the dev app over HTTPS on the local network so a phone can open it.
// Phones only allow camera, microphone and location on HTTPS pages. Makes a self-signed
// certificate for this machine's LAN addresses with openssl (kept in the git-ignored .certs/),
// then starts Vite with HTTPS=1, which vite.config.ts reads. The phone shows a certificate warning
// the first time; in Safari tap Show Details, then visit this website.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

const DIR = '.certs';
const KEY = `${DIR}/dev-key.pem`;
const CERT = `${DIR}/dev-cert.pem`;
const HOSTS = `${DIR}/hosts.txt`;
const PORT = 5173;

const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => a!.address);

const names = ['localhost', '127.0.0.1', ...lanAddresses].sort();
const current = existsSync(HOSTS) ? readFileSync(HOSTS, 'utf8') : '';

// A new Wi-Fi network means a new LAN address, which the certificate must name.
if (!existsSync(KEY) || !existsSync(CERT) || current !== names.join('\n')) {
  mkdirSync(DIR, { recursive: true });
  const san = names.map((n) => (/^[\d.]+$/.test(n) ? `IP:${n}` : `DNS:${n}`)).join(',');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      // iOS rejects server certificates valid for more than 825 days.
      '-days',
      '397',
      '-subj',
      '/CN=Learner Co-Pilot dev',
      '-addext',
      `subjectAltName=${san}`,
      '-addext',
      'extendedKeyUsage=serverAuth',
      '-keyout',
      KEY,
      '-out',
      CERT,
    ],
    { stdio: 'ignore' },
  );
  writeFileSync(HOSTS, names.join('\n'));
}

console.log('\nOpen on your phone (same Wi-Fi):');
for (const ip of lanAddresses) console.log(`  https://${ip}:${PORT}/`);
console.log(
  'First visit: accept the certificate warning (Safari: Show Details > visit this website).\n',
);

spawn('npx', ['vite', '--host', '--port', String(PORT), '--strictPort'], {
  stdio: 'inherit',
  env: { ...process.env, HTTPS: '1' },
}).on('exit', (code) => process.exit(code ?? 0));
