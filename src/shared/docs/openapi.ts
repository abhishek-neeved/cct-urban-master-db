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
      title: 'CDMA Master DB API',
      version: '1.0.0',
      description:
        'CDMA Master DB — REST API on a feature-modular layered architecture with dependency inversion at the data-access boundary. Current surface: JWT auth (access + rotating refresh tokens).',
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
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            isVerified: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: [
            'id',
            'firstName',
            'lastName',
            'email',
            'isVerified',
            'createdAt',
            'updatedAt',
          ],
        },
        AuthPayload: {
          type: 'object',
          properties: {
            user: { $ref: '#/components/schemas/User' },
            accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            refreshToken: { type: 'string', example: 'f3a9c1d7e5b8a2f6c4d9e1b7a5f8c2d6' },
          },
          required: ['user', 'accessToken', 'refreshToken'],
        },
        TokenPair: {
          type: 'object',
          properties: {
            accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            refreshToken: { type: 'string', example: 'f3a9c1d7e5b8a2f6c4d9e1b7a5f8c2d6' },
          },
          required: ['accessToken', 'refreshToken'],
        },
        RegisterRequest: {
          type: 'object',
          properties: {
            firstName: { type: 'string', minLength: 1, maxLength: 120 },
            lastName: { type: 'string', minLength: 1, maxLength: 120 },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8, maxLength: 128 },
          },
          required: ['firstName', 'lastName', 'email', 'password'],
        },
        LoginRequest: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email', example: 'jane.doe@example.com' },
            password: { type: 'string', minLength: 1, example: 'supersecret123' },
          },
          required: ['email', 'password'],
        },
        VerifyOtpRequest: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email', example: 'jane.doe@example.com' },
            otp: { type: 'string', pattern: '^\\d{6}$', example: '042317' },
          },
          required: ['email', 'otp'],
        },
        ResendOtpRequest: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email', example: 'jane.doe@example.com' },
          },
          required: ['email'],
        },
        RefreshTokenRequest: {
          type: 'object',
          properties: {
            refreshToken: {
              type: 'string',
              minLength: 1,
              example: 'f3a9c1d7e5b8a2f6c4d9e1b7a5f8c2d6',
            },
          },
          required: ['refreshToken'],
        },
        ForgotPasswordRequest: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email', example: 'jane.doe@example.com' },
          },
          required: ['email'],
        },
        ResetPasswordRequest: {
          type: 'object',
          properties: {
            token: { type: 'string', minLength: 1, example: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' },
            password: {
              type: 'string',
              minLength: 8,
              maxLength: 128,
              example: 'new-supersecret-456',
            },
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
