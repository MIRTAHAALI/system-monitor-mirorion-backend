# System Monitor Backend

NestJS + TypeScript backend for the System Monitoring Platform.

## Requirements

* Node.js 18+ (recommended: 20+)
* npm 9+
* PM2 (for production deployment)

## Installation

```bash
npm install
```

## Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

### Environment Variables

| Variable                    | Default                 | Description                                                                 |
| --------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `NODE_ENV`                  | `development`           | Environment mode                                                            |
| `PORT`                      | `4000`                  | Server port                                                                 |
| `CORS_ORIGIN`               | `http://localhost:5173` | Allowed CORS origin (REST and Socket.IO)                                    |
| `LOG_LEVEL`                 | `info`                  | Log level (`trace`, `debug`, `info`, `warn`, `error`)                       |
| `METRICS_INTERVAL_MS`       | `1000`                  | Core metrics (CPU, memory, disk, network) collection interval              |
| `PROCESS_INTERVAL_MS`       | `3000`                  | Process list collection interval                                            |
| `DISK_INTERVAL_MS`          | `2000`                  | Minimum refresh for filesystem sizes (cached for at least 10 seconds)       |
| `TEMPERATURE_INTERVAL_MS`   | `3000`                  | Battery, GPU and temperature collection interval                            |
| `HISTORY_RETENTION_POLICY`  | `1d`                    | How long history is kept: `1d`, `1w`, `1m`, `3m`, `6m`, `1y`                |
| `HISTORY_CACHE_ENTRIES`     | `5000`                  | Newest history samples kept in memory per metric                            |
| `ENABLE_GPU_MONITORING`     | `true`                  | Enable GPU monitoring                                                       |
| `ENABLE_BATTERY_MONITORING` | `true`                  | Enable battery monitoring                                                   |
| `ENABLE_PROCESS_MONITORING` | `true`                  | Enable process monitoring                                                   |
| `ADMIN_USERNAME`            | —                       | Admin username (see [Authentication](#authentication))                      |
| `ADMIN_PASSWORD_HASH`       | —                       | bcrypt hash of the admin password, from `npm run hash-password`             |
| `ADMIN_PASSWORD`            | —                       | Plain-text admin password (use instead of `ADMIN_PASSWORD_HASH`)            |
| `JWT_SECRET`                | `data/.jwt_secret`      | Token signing key, at least 32 characters                                   |
| `JWT_EXPIRES_IN_SECONDS`    | `604800` (7 days)       | How long a login stays valid                                                |
| `ENABLE_SWAGGER`            | on unless production    | Serve Swagger UI at `/api/docs`                                             |
| `NETWORK_INTERVAL_MS`       | `1000`                  | Currently unused (network is collected with core metrics)                   |
| `METRICS_HISTORY_SIZE`      | `300`                   | Currently unused                                                            |
| `AUTH_ENABLED`              | `false`                 | Currently unused: authentication is always on                               |

## Authentication

Every API endpoint and Socket.IO connection requires login, except `/api/v1/health` and the login endpoints. There is a single admin user. Its credentials come from one of two places, checked in this order:

1. **Environment variables** (`.env` or the real environment). Used when `ADMIN_USERNAME` is set. Nothing is written to disk.
2. **`data/.credentials.json`**, created by an interactive prompt the first time the server starts.

### Option 1: Set credentials in `.env` (recommended for servers, PM2 and Docker)

Generate a password hash. The password is typed into a hidden prompt, so it does not end up in your shell history:

```bash
npm run hash-password
```

It prints a line such as `ADMIN_PASSWORD_HASH=$2b$12$...`. Add it to `.env` together with a username:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=$2b$12$...
```

Restart the server. The log shows `✅ Loaded credentials from environment for user: admin`.

You can set `ADMIN_PASSWORD=YourPassword123` instead of `ADMIN_PASSWORD_HASH`, but the password is then stored readable in `.env`, so the hash is safer. Set only one of the two.

To keep logins valid across restarts on machines where `data/` is not persisted (for example containers), also set `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

```env
JWT_SECRET=<the printed value>
```

The server refuses to start, with a clear message, if these settings are inconsistent: a password without a username, a password shorter than 8 characters, an invalid hash, both `ADMIN_PASSWORD` and `ADMIN_PASSWORD_HASH`, or a `JWT_SECRET` shorter than 32 characters.

> **Docker Compose:** inside `docker-compose.yml`, write every `$` in the hash as `$$`, because Compose treats `$` as a variable. A `.env` file needs no escaping.

### Option 2: Interactive setup on first start

If `ADMIN_USERNAME` is not set and `data/.credentials.json` does not exist, the server asks in the terminal before it starts:

```
🔐 System Monitor — Initial Setup
   Username:
   Password:          (hidden while typing)
   Confirm password:
```

The password needs at least 8 characters. Only a bcrypt hash is saved, to `data/.credentials.json`, readable only by your user. Later starts load this file and do not ask again.

The prompt needs a terminal, so it does not work under PM2 or in Docker. Use Option 1 there.

Start the server from the `backend` directory: `data/` is resolved relative to the directory the server is started from.

### Changing or removing credentials

* **Set in `.env`:** edit the values, or delete the `ADMIN_*` lines to fall back to `data/.credentials.json` (or the prompt). Then restart.
* **Created by the prompt:** stop the server, delete the file, and start again to be asked for new credentials:

  ```bash
  rm data/.credentials.json
  ```

Existing logins remain valid until they expire (`JWT_EXPIRES_IN_SECONDS`) unless the username changes. To log everyone out immediately, also delete `data/.jwt_secret` (or change `JWT_SECRET`) and restart.

### Login protection

* After 5 failed logins from the same IP within a minute, further attempts get `429 Too Many Requests` until the minute is up.
* Socket.IO clients must send the token in the connection `auth` payload (`io(url, { auth: { token } })`). Tokens in the URL query string are rejected. Connected sockets are closed when their token expires.

## Development

```bash
npm run start:dev
```

## Production Build

```bash
npm run build
npm run start:prod
```

## Production Deployment with PM2

PM2 can be used to run the NestJS backend as a background process and automatically restart it if the application crashes.

### 1. Install PM2

Install PM2 globally:

```bash
npm install -g pm2
```

Verify the installation:

```bash
pm2 --version
```

### 2. Install Dependencies

From the project directory:

```bash
npm install
```

### 3. Configure Environment

Create the production `.env` file:

```bash
cp .env.example .env
```

Update the required production values:

```env
NODE_ENV=production
PORT=4000
CORS_ORIGIN=http://your-frontend-domain.com
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<output of npm run hash-password>
```

PM2 runs without a terminal, so the first-start credential prompt cannot be answered. Set the admin credentials in `.env` as shown (see [Authentication](#authentication)).

### 4. Build the Application

Build the NestJS application:

```bash
npm run build
```

This generates the production files inside the `dist` directory.

### 5. Start with PM2

Start the compiled NestJS application using PM2:

```bash
pm2 start dist/main.js --name system-monitor-backend
```

Check the application status:

```bash
pm2 status
```

### 6. View Logs

View application logs:

```bash
pm2 logs system-monitor-backend
```

View only the last 100 log lines:

```bash
pm2 logs system-monitor-backend --lines 100
```

### 7. Restart the Application

After making code changes and rebuilding:

```bash
npm run build
pm2 restart system-monitor-backend
```

### 8. Stop the Application

```bash
pm2 stop system-monitor-backend
```

### 9. Remove the Application from PM2

```bash
pm2 delete system-monitor-backend
```

### 10. Enable Automatic Startup

To make PM2 automatically start the application after a server reboot:

```bash
pm2 startup
```

PM2 will display a command that needs to be executed with elevated privileges. Run that command, then save the current PM2 processes:

```bash
pm2 save
```

After this, the backend will automatically restart when the server reboots.

### PM2 Useful Commands

| Command                              | Description                      |
| ------------------------------------ | -------------------------------- |
| `pm2 status`                         | Show running applications        |
| `pm2 logs system-monitor-backend`    | View application logs            |
| `pm2 restart system-monitor-backend` | Restart application              |
| `pm2 stop system-monitor-backend`    | Stop application                 |
| `pm2 delete system-monitor-backend`  | Remove application               |
| `pm2 monit`                          | Monitor CPU and memory usage     |
| `pm2 save`                           | Save current PM2 processes       |
| `pm2 startup`                        | Configure startup on system boot |

### Recommended Deployment Flow

For subsequent deployments, use:

```bash
git pull
npm install
npm run build
pm2 restart system-monitor-backend
```

You can verify that the application is running with:

```bash
pm2 status
pm2 logs system-monitor-backend
```

## API Documentation

Once running, visit `http://localhost:4000/api/docs` for Swagger documentation. Swagger is turned off when `NODE_ENV=production`; set `ENABLE_SWAGGER=true` to turn it on.

## REST API

All endpoints except `/api/v1/health` and `/api/v1/auth/*` need an `Authorization: Bearer <token>` header. Get a token from the login endpoint.

### Auth

* `POST /api/v1/auth/login` - Log in with `{ "username", "password" }` and receive a token
* `POST /api/v1/auth/verify` - Check whether `{ "token" }` is valid

### System

* `GET /api/v1/system/info` - System information
* `GET /api/v1/system/metrics` - Complete metrics snapshot

### CPU

* `GET /api/v1/cpu` - CPU metrics

### Memory

* `GET /api/v1/memory` - Memory and swap metrics

### Disk

* `GET /api/v1/disk` - Disk usage and I/O

### Network

* `GET /api/v1/network` - Network interfaces and metrics
* `GET /api/v1/network/status` - Network connectivity

### Processes

* `GET /api/v1/processes` - List processes (supports `?limit` up to 1000, `?sort=cpu|memory`, `?search`)
* `GET /api/v1/processes/top` - Top processes (supports `?limit`, `?sort=cpu|memory`)
* `GET /api/v1/processes/:pid` - Process details

### Hardware

* `GET /api/v1/battery` - Battery information
* `GET /api/v1/gpu` - GPU information
* `GET /api/v1/temperature` - Temperature sensors

### Runtime

* `GET /api/v1/runtime` - Node.js runtime information

### Metrics

Metric names: `cpu`, `memory`, `networkDownload`, `networkUpload`, `disk`, `battery`, `gpu`, `temperature`. Times are ISO 8601 timestamps.

* `GET /api/v1/metrics/history` - History for one metric (supports `?metric`, `?limit`, `?startTime`, `?endTime`)
* `GET /api/v1/metrics/history/all` - Recent history for every metric (supports `?limit`, `?startTime`, `?endTime`)
* `GET /api/v1/metrics/history/stats` - Stored entry count and retention policy
* `GET /api/v1/metrics/history/export/:metric` - Download one metric as CSV (supports `?startTime`, `?endTime`)
* `GET /api/v1/metrics/history/export` - Download all metrics as CSV (supports `?startTime`, `?endTime`)
* `DELETE /api/v1/metrics/history` - Clear history (supports `?metric`; clears everything without it)
* `GET /api/v1/metrics/history/retention` - Current retention policy
* `PUT /api/v1/metrics/history/retention/:policy` - Set retention policy (`1d`, `1w`, `1m`, `3m`, `6m`, `1y`). The older `GET` form still works but is deprecated.
* `GET /api/v1/socket/status` - Socket.IO connection status

### Health

* `GET /api/v1/health` - Health check

## Socket.IO

Connects on the same port (4000). Pass the login token in the connection auth payload:

```ts
io('http://localhost:4000', { auth: { token } });
```

### Events

| Event                | Direction       | Description                                             |
| -------------------- | --------------- | ------------------------------------------------------- |
| `system:metrics`     | Server → Client | Full snapshot: CPU, memory, disk, network and runtime   |
| `processes:update`   | Server → Client | Process list (top 20 by CPU)                            |
| `battery:update`     | Server → Client | Battery status                                          |
| `gpu:update`         | Server → Client | GPU metrics                                             |
| `temperature:update` | Server → Client | Temperature data                                        |

The separate `cpu:update`, `memory:update`, `disk:update`, `network:update` and `runtime:update` events are no longer sent; their data is already in `system:metrics`.

## Supported Platforms

* Linux
* macOS
* Windows

### Platform Notes

* **GPU monitoring** requires NVIDIA drivers (Linux/Windows) or is limited on macOS
* **Temperature sensors** availability varies by hardware
* **Battery info** only available on laptops/devices with batteries
* **Disk I/O rates** depend on platform support

## Docker

```bash
docker build -t system-monitor-backend .
docker run -p 4000:4000 \
  -e ADMIN_USERNAME=admin \
  -e 'ADMIN_PASSWORD_HASH=<output of npm run hash-password>' \
  -e JWT_SECRET=<random string of at least 32 characters> \
  system-monitor-backend
```

A container has no terminal for the first-start prompt, so the admin credentials must come from environment variables. Without a mounted `data/` volume, history is lost when the container is recreated.

### Docker Limitations

Running inside Docker limits access to host hardware metrics. For full monitoring, run directly on the host or use `pid: host` and volume mounts for `/proc`.

## Testing

```bash
npm test
npm run test:cov
```

## Linting

```bash
npm run lint
```
