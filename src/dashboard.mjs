import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DASHBOARD_PORT } from './constants.mjs';
import { getDashboardAuth, parseTorchConfig } from './torch-config.mjs';

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss:; object-src 'none'; base-uri 'self';",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

function timingSafeCompare(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Pad both buffers to equal length so the comparison takes constant time
    // regardless of input lengths. The length difference is still observable,
    // but the content timing channel is closed.
    const maxLen = Math.max(bufA.length, bufB.length);
    const paddedA = Buffer.alloc(maxLen);
    const paddedB = Buffer.alloc(maxLen);
    bufA.copy(paddedA);
    bufB.copy(paddedB);
    return crypto.timingSafeEqual(paddedA, paddedB);
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyPassword(input, stored) {
  if (stored.startsWith('scrypt:')) {
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    try {
      const salt = Buffer.from(parts[1], 'hex');
      const hash = Buffer.from(parts[2], 'hex');
      const derived = crypto.scryptSync(input, salt, 64);
      return crypto.timingSafeEqual(derived, hash);
    } catch {
      return false;
    }
  }
  return timingSafeCompare(input, stored);
}

export async function cmdDashboard(port = DEFAULT_DASHBOARD_PORT, host = '127.0.0.1') {
  // Resolve package root relative to this file (src/dashboard.mjs)
  // this file is in <root>/src/dashboard.mjs, so '..' goes to <root>
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const auth = await getDashboardAuth();

  // Rate limiting state
  const MAX_AUTH_ATTEMPTS = 5;
  const BLOCK_DURATION_MS = 300000; // 5 minutes
  const CLEANUP_INTERVAL_MS = 600000; // 10 minutes
  const rateLimit = new Map(); // ip -> { attempts, blockExpires, lastSeen }

  // Cleanup old entries
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of rateLimit.entries()) {
      if (data.blockExpires && data.blockExpires < now) {
        rateLimit.delete(ip);
      } else if (!data.blockExpires && (now - data.lastSeen > CLEANUP_INTERVAL_MS)) {
        rateLimit.delete(ip);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  const server = http.createServer(async (req, res) => {
    try {
    // Basic Auth check
    if (auth) {
      const clientIp = req.socket.remoteAddress;
      const now = Date.now();

      // Check rate limit
      const clientState = rateLimit.get(clientIp) || { attempts: 0, blockExpires: 0, lastSeen: now };

      // Update last seen
      clientState.lastSeen = now;

      if (clientState.blockExpires > now) {
        res.writeHead(429, {
          ...SECURITY_HEADERS,
          'Retry-After': Math.ceil((clientState.blockExpires - now) / 1000)
        });
        res.end('Too Many Requests');
        return;
      } else if (clientState.blockExpires) {
        // Block expired, reset state
        clientState.attempts = 0;
        clientState.blockExpires = 0;
      }

      const authHeader = req.headers.authorization;
      if (!authHeader) {
        res.writeHead(401, { ...SECURITY_HEADERS, 'WWW-Authenticate': 'Basic realm="TORCH Dashboard"' });
        res.end('Authentication required');
        return;
      }
      const parts = authHeader.split(' ');
      const type = parts[0];
      const credentials = parts[1];
      let isValid = false;
      if (type === 'Basic' && credentials) {
        try {
          const decoded = Buffer.from(credentials, 'base64').toString();
          isValid = verifyPassword(decoded, auth);
        } catch {
          isValid = false;
        }
      }

      if (!isValid) {
        // Increment attempts
        clientState.attempts += 1;
        if (clientState.attempts >= MAX_AUTH_ATTEMPTS) {
          clientState.blockExpires = Date.now() + BLOCK_DURATION_MS;
        }
        rateLimit.set(clientIp, clientState);

        res.writeHead(401, { ...SECURITY_HEADERS, 'WWW-Authenticate': 'Basic realm="TORCH Dashboard"' });
        res.end('Invalid credentials');
        return;
      }

      // Reset attempts on success
      if (rateLimit.has(clientIp)) {
        rateLimit.delete(clientIp);
      }
    }

    // URL parsing
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = url.pathname;

    // Redirect / to /dashboard/
    if (pathname === '/' || pathname === '/dashboard') {
      res.writeHead(302, { ...SECURITY_HEADERS, 'Location': '/dashboard/' });
      res.end();
      return;
    }

    async function statSafe(p) {
      try {
        return await fsp.stat(p);
      } catch {
        return null;
      }
    }

    // Special case: /torch-config.json
    // Priority: Env Var > User's CWD > Package default
    if (pathname === '/torch-config.json') {
      let configContent = null;

      if (process.env.TORCH_CONFIG_PATH) {
        const envPath = path.resolve(process.cwd(), process.env.TORCH_CONFIG_PATH);
        try {
          configContent = await fsp.readFile(envPath, 'utf8');
        } catch {
          // Explicitly provided config path not found, do not fall back
        }
      } else {
        const userConfigPath = path.resolve(process.cwd(), 'torch-config.json');
        try {
          configContent = await fsp.readFile(userConfigPath, 'utf8');
        } catch {
          // Try package default
          const packageConfigPath = path.join(packageRoot, 'torch-config.json');
          try {
            configContent = await fsp.readFile(packageConfigPath, 'utf8');
          } catch {
            // Not found in either location
          }
        }
      }

      if (configContent) {
        try {
          const rawConfig = JSON.parse(configContent);
          const safeConfig = parseTorchConfig(rawConfig);

          // Security: Whitelist only fields required by the dashboard frontend
          const publicConfig = {
            dashboard: safeConfig.dashboard ? { ...safeConfig.dashboard } : {},
            nostrLock: safeConfig.nostrLock
              ? {
                  namespace: safeConfig.nostrLock.namespace,
                  relays: safeConfig.nostrLock.relays,
                }
              : {},
          };

          // Remove sensitive dashboard auth
          if (publicConfig.dashboard.auth) {
            delete publicConfig.dashboard.auth;
          }

          res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
          res.end(JSON.stringify(publicConfig, null, 2));
          return;
        } catch (err) {
          console.error('Error parsing torch-config.json:', err);
          res.writeHead(500, SECURITY_HEADERS);
          res.end('Internal Server Error');
          return;
        }
      } else {
        res.writeHead(404, SECURITY_HEADERS);
        res.end('Not Found');
        return;
      }
    }

    // Security check: prevent directory traversal
    // Resolve path relative to packageRoot.
    // We strip the leading slash from pathname (which comes from URL) to treat it as relative.
    const relativePath = pathname.replace(/^\//, '');
    let filePath = path.resolve(packageRoot, relativePath);

    // Security check: restrict access to allowed paths
    const allowedPaths = [
      path.join(packageRoot, 'dashboard'),
      path.join(packageRoot, 'landing'),
      path.join(packageRoot, 'assets'),
      path.join(packageRoot, 'src', 'docs'),
      path.join(packageRoot, 'src', 'prompts'),
      path.join(packageRoot, 'src', 'constants.mjs'),
      path.join(packageRoot, 'torch-config.json')
    ];

    const isAllowed = allowedPaths.some(allowedPath => {
      const rel = path.relative(allowedPath, filePath);
      return !rel.startsWith('..') && !path.isAbsolute(rel);
    });

    if (!isAllowed) {
      res.writeHead(403, SECURITY_HEADERS);
      res.end('Forbidden');
      return;
    }

    // If directory, try index.html
    let fileStat = await statSafe(filePath);
    if (fileStat && fileStat.isDirectory()) {
       filePath = path.join(filePath, 'index.html');
       fileStat = await statSafe(filePath);
    }

    // Check if file exists and is a file
    if (!fileStat || !fileStat.isFile()) {
      res.writeHead(404, SECURITY_HEADERS);
      res.end('Not Found');
      return;
    }

    // MIME types
    const extname = path.extname(filePath);
    let contentType = 'text/plain';
    switch (extname) {
      case '.html': contentType = 'text/html'; break;
      case '.js': contentType = 'text/javascript'; break;
      case '.mjs': contentType = 'text/javascript'; break;
      case '.css': contentType = 'text/css'; break;
      case '.json': contentType = 'application/json'; break;
      case '.png': contentType = 'image/png'; break;
      case '.jpg': contentType = 'image/jpeg'; break;
      case '.svg': contentType = 'image/svg+xml'; break;
      case '.ico': contentType = 'image/x-icon'; break;
      case '.md': contentType = 'text/markdown'; break;
    }

    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      console.error('Dashboard Server Error:', err);
      if (!res.headersSent) {
        res.writeHead(500, SECURITY_HEADERS);
        res.end('Internal Server Error');
      }
    }
  });

  server.on('close', () => {
    clearInterval(cleanupInterval);
  });

  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const listenUrl = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/dashboard/`;
      console.log(`Dashboard running at ${listenUrl}`);
      if (auth) {
        console.log('Authentication: enabled (Basic Auth)');
      } else {
        console.warn('Authentication: DISABLED (Dashboard is public)');
      }
      console.log(`Serving files from ${packageRoot}`);
      console.log(`Using configuration from ${process.cwd()}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}
