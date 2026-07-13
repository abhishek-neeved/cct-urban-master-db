import path from 'path';
import swaggerJSDoc from 'swagger-jsdoc';
import { env } from '@config/env';

/**
 * OpenAPI document, assembled by swagger-jsdoc from annotation comments.
 *
 * - Shared building blocks (security schemes + reusable schemas) live in the
 *   `components` block below.
 * - Each path is documented with an `@openapi` JSDoc block next to the route it
 *   describes (see each module's `*.routes.ts`), so docs stay beside the code.
 *
 * The `apis` glob is resolved relative to this file so it works both in dev
 * (`.ts` under `src/`) and after a build (`.js` under `dist/`).
 */
const options: swaggerJSDoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Express TS Auth API',
      version: '1.0.0',
      description:
        'JWT auth flow (access + rotating refresh tokens) built on a layered architecture.',
    },
    servers: [{ url: env.APP_URL }],
    tags: [
      { name: 'Auth', description: 'Registration, login, tokens and password reset' },
      { name: 'Health', description: 'Liveness and readiness probes' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'name', 'email', 'createdAt', 'updatedAt'],
        },
        AuthPayload: {
          type: 'object',
          properties: {
            user: { $ref: '#/components/schemas/User' },
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
          },
          required: ['user', 'accessToken', 'refreshToken'],
        },
        TokenPair: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
          },
          required: ['accessToken', 'refreshToken'],
        },
        RegisterRequest: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8, maxLength: 128 },
          },
          required: ['name', 'email', 'password'],
        },
        LoginRequest: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 1 },
          },
          required: ['email', 'password'],
        },
        RefreshTokenRequest: {
          type: 'object',
          properties: {
            refreshToken: { type: 'string', minLength: 1 },
          },
          required: ['refreshToken'],
        },
        ForgotPasswordRequest: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
          },
          required: ['email'],
        },
        ResetPasswordRequest: {
          type: 'object',
          properties: {
            token: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 8, maxLength: 128 },
          },
          required: ['token', 'password'],
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                details: {},
              },
              required: ['message'],
            },
            requestId: { type: 'string' },
          },
          required: ['success', 'error'],
        },
      },
    },
  },
  // Forward slashes only: the glob library treats backslashes as escapes, so a
  // Windows-style path.join() result would silently match nothing.
  apis: [
    // Health probes are documented in the top-level router; feature routes
    // (auth, etc.) are documented next to each module's `*.routes.ts`.
    path.join(import.meta.dirname, '..', '..', 'routes', '*.{ts,js}').replace(/\\/g, '/'),
    path
      .join(import.meta.dirname, '..', '..', 'modules', '**', '*.routes.{ts,js}')
      .replace(/\\/g, '/'),
  ],
};

export const openApiDocument = swaggerJSDoc(options) as Record<string, unknown>;
