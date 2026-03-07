# Auth Service

NestJS service that handles user registration, login, JWT access/refresh tokens, logout (with token revocation), and token validation. It exposes HTTP endpoints and listens on RabbitMQ for token validation requests from other services.

## What it does

- **Users**: Stores users in MongoDB (name, email, role, password hash, optional refresh-token hash) via Typegoose.
- **Auth flows**: Register, login, refresh tokens, logout. Passwords are hashed with bcrypt. Access tokens are short-lived; refresh tokens are longer-lived and stored hashed per user.
- **Logout**: Uses access token (Bearer). On logout, the access token is blacklisted so it cannot be used for `/auth/me` or protected routes until it would have expired.
- **Token validation**: Other services (e.g. product-service) can validate a Bearer token by sending an RMQ message `auth.validate-token`; this service replies with user id, email, and role.
- **Events**: On registration, emits a `user.created` event over RabbitMQ (e.g. for product-service to consume).

## Prerequisites

- Node.js (v18+)
- MongoDB (e.g. `mongodb://localhost:27017`)
- RabbitMQ (e.g. `amqp://guest:guest@localhost:5672`)

## Setup

1. **Install dependencies**

   ```bash
   npm install --legacy-peer-deps
   ```

2. **Environment**

   Copy the example env and set your values:

   ```bash
   cp .env.example .env
   ```

   Edit `.env`. Main variables:

   | Variable | Description |
   |----------|-------------|
   | `AUTH_PORT` | HTTP port (default `3000`) |
   | `AUTH_MONGO_URI` | MongoDB connection string |
   | `JWT_ACCESS_SECRET` | Secret for signing access tokens |
   | `JWT_ACCESS_EXPIRES_IN` | Access token TTL (e.g. `15m`) |
   | `JWT_REFRESH_SECRET` | Secret for signing refresh tokens |
   | `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL (e.g. `7d`) |
   | `RABBITMQ_URL` | RabbitMQ connection URL |
   | `RABBITMQ_AUTH_QUEUE` | Queue for token-validation RPC |
   | `RABBITMQ_USER_EVENTS_QUEUE` | Queue for emitting `user.created` |

3. **Build**

   ```bash
   npm run build
   ```

## Run

```bash
# Development (watch mode)
npm run start:dev

# Production
npm run start:prod
```

Default HTTP port: `3000` (or `AUTH_PORT` from `.env`).

## HTTP endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/register` | Register (body: name, email, password, optional role) |
| `POST` | `/auth/login` | Login (body: email, password) |
| `POST` | `/auth/refresh` | New tokens (body: refreshToken) |
| `POST` | `/auth/logout` | Logout (header: `Authorization: Bearer <accessToken>`) |
| `GET` | `/auth/me` | Current user (header: `Authorization: Bearer <accessToken>`) |
| `POST` | `/auth/validate` | Validate token (body: token) |

## RabbitMQ

- **Server**: Listens on `RABBITMQ_AUTH_QUEUE` for RPC.
  - Pattern `auth.validate-token`: payload `{ token }`, returns `{ userId, email, role }` or error.
- **Client**: Emits `user.created` to `RABBITMQ_USER_EVENTS_QUEUE` on registration (payload: id, email, name, role).

## Scripts

- `npm run build` – Compile
- `npm run start` – Run once
- `npm run start:dev` – Run in watch mode
- `npm run start:prod` – Run compiled (e.g. `node dist/main`)
- `npm run lint` – Lint
- `npm run test` – Unit tests
