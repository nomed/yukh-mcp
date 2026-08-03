# Run the inert gateway

Use this process to inspect the MCP transport and health surface. It publishes
no tools, resources, prompts, providers, or credentials.

## Node.js

Requires Node.js 22 or newer:

```sh
npm ci --ignore-scripts
npm run build
npm start
```

In another terminal:

```sh
curl --fail http://127.0.0.1:3000/healthz
curl --fail http://127.0.0.1:3000/readyz
```

Stop the process with `Ctrl-C`.

## Container

```sh
docker compose up --build
```

The container binds to host loopback and uses a read-only root filesystem,
non-root user, dropped Linux capabilities, resource limits, and
`no-new-privileges`. Stop it with `Ctrl-C`.

## Do not expose it

This is a development skeleton, not a deployment profile. It has no
authentication adapter, operational capability, durable audit store, or
production security claim.

See [Runtime surface](../architecture/runtime-skeleton.md) for routes and
configuration.
