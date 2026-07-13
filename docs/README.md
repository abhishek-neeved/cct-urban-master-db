# Documentation

Documentation for the **CDMA Master DB** service — an Express + TypeScript REST
API built with a layered (MVC + Service + Repository) architecture.

| Doc                                     | What it covers                                       |
| --------------------------------------- | ---------------------------------------------------- |
| [Getting Started](./getting-started.md) | Prerequisites, install, environment, running the app |
| [API Reference](./api-reference.md)     | Every endpoint, request/response shapes, status codes |

For how the code is organized and the conventions to follow, see
[`../CLAUDE.md`](../CLAUDE.md) and the [root README](../README.md). The source is
small and commented — the layers (controller → service → repository), logging,
validation, and error handling are documented inline where they live.
