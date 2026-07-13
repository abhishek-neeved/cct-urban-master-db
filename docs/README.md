# Documentation

Documentation for the **CDMA Master DB** service — an Express + TypeScript REST
API built with a layered (MVC + Service + Repository) architecture.

| Doc                                     | What it covers                                        |
| --------------------------------------- | ----------------------------------------------------- |
| [Getting Started](./getting-started.md) | Prerequisites, install, environment, running the app  |
| [Configuration](./configuration.md)     | Every environment variable, defaults, production rules |
| [API Reference](./api-reference.md)     | Every endpoint, request/response shapes, status codes |
| [Deployment](./deployment.md)           | Docker build/run, health checks, production checklist |

For how the code is organized and the conventions to follow, see
[`../CLAUDE.md`](../CLAUDE.md) and the [root README](../README.md). The source is
small and commented — the layers (controller → service → repository), logging,
validation, and error handling are documented inline where they live.
