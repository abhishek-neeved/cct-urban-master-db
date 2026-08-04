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
        'CDMA Master DB — REST API on a feature-modular layered architecture with dependency inversion at the data-access boundary. Current surface: JWT auth (access + rotating refresh tokens), OTP-based email verification, password reset, and user profiles.',
    },
    servers: [{ url: env.APP_URL }],
    tags: [
      {
        name: 'Auth',
        description: 'Registration, email/OTP verification, login, tokens and password reset',
      },
      { name: 'Users', description: 'Authenticated profile reads and updates' },
      { name: 'Uploads', description: 'Presigned S3 upload/view URLs for user-submitted files' },
      { name: 'KYC', description: 'Identity verification submission and admin review' },
      {
        name: 'Criminal Record',
        description: 'Criminal-record check status — read-only for users, admin-settable',
      },
      { name: 'OnboardingFee', description: 'Razorpay-backed one-time onboarding-fee payment' },
      { name: 'Dashboard', description: 'Composed read-only summary for the dashboard screen' },
      { name: 'Health', description: 'Combined liveness + readiness probe' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'accessToken',
          description:
            'Set automatically on login/refresh (httpOnly). Alternative to bearerAuth for browser clients.',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['admin', 'service_provider', 'customer'] },
            serviceCategory: {
              type: 'string',
              nullable: true,
              enum: ['electrician', 'plumber', 'cleaner', 'carpenter', 'painter', 'other', null],
              description:
                'Only set for service_provider, and only after the one-time onboarding step.',
            },
            phoneNumber: {
              type: 'string',
              nullable: true,
              description: 'Optional for every role, editable any time via PATCH /users/me.',
            },
            isVerified: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: [
            'id',
            'firstName',
            'lastName',
            'email',
            'role',
            'serviceCategory',
            'phoneNumber',
            'isVerified',
            'createdAt',
            'updatedAt',
          ],
        },
        UpdateProfileRequest: {
          type: 'object',
          description: 'At least one of firstName/lastName/phoneNumber must be provided.',
          properties: {
            firstName: { type: 'string', minLength: 1, maxLength: 120 },
            lastName: { type: 'string', minLength: 1, maxLength: 120 },
            phoneNumber: { type: 'string', pattern: '^\\+?[0-9]{7,15}$' },
          },
        },
        ServiceProviderListing: {
          type: 'object',
          properties: {
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            serviceCategory: {
              type: 'string',
              enum: ['electrician', 'plumber', 'cleaner', 'carpenter', 'painter', 'other'],
            },
            phoneNumber: { type: 'string', nullable: true },
          },
          required: ['firstName', 'lastName', 'serviceCategory', 'phoneNumber'],
        },
        PresignUploadRequest: {
          type: 'object',
          properties: {
            purpose: {
              type: 'string',
              enum: ['kyc-aadhar', 'kyc-pan', 'kyc-photo'],
            },
            contentType: {
              type: 'string',
              enum: ['image/jpeg', 'image/png', 'application/pdf'],
            },
          },
          required: ['purpose', 'contentType'],
        },
        PresignedUpload: {
          type: 'object',
          properties: {
            uploadUrl: { type: 'string', example: 'https://s3.amazonaws.com/...' },
            key: { type: 'string', example: 'kyc-aadhar/64f.../3fa8...uuid' },
            expiresIn: { type: 'integer', example: 300 },
          },
          required: ['uploadUrl', 'key', 'expiresIn'],
        },
        KycRecord: {
          type: 'object',
          description:
            'Built up incrementally: the row is created by the first successful /verify-mobile/confirm call and stays `not_started` until /submit, which requires mobileVerified/aadhaarVerified/panVerified all true.',
          properties: {
            status: { type: 'string', enum: ['not_started', 'pending', 'verified', 'rejected'] },
            mobileNumber: { type: 'string', example: '9876543210' },
            mobileVerified: { type: 'boolean' },
            aadharNumber: { type: 'string', example: '123456789012' },
            aadhaarVerified: { type: 'boolean' },
            panNumber: { type: 'string', example: 'ABCDE1234F' },
            panVerified: { type: 'boolean' },
            address: { type: 'string' },
            submittedAt: { type: 'string', format: 'date-time' },
            rejectionReason: { type: 'string' },
          },
          required: ['status', 'mobileVerified', 'aadhaarVerified', 'panVerified'],
        },
        AdminKycRecord: {
          allOf: [
            { $ref: '#/components/schemas/KycRecord' },
            {
              type: 'object',
              properties: {
                id: { type: 'string' },
                userId: { type: 'string' },
                reviewedBy: { type: 'string' },
                reviewedAt: { type: 'string', format: 'date-time' },
              },
              required: ['id', 'userId'],
            },
          ],
        },
        SubmitKycRequest: {
          type: 'object',
          description:
            'Mobile/Aadhaar/PAN must already be verified via /api/kyc/verify-mobile/*, /verify-aadhaar, and /verify-pan.',
          properties: {
            address: { type: 'string', minLength: 1 },
          },
          required: ['address'],
        },
        RequestMobileVerificationRequest: {
          type: 'object',
          properties: {
            mobileNumber: { type: 'string', pattern: '^[6-9]\\d{9}$', example: '9876543210' },
          },
          required: ['mobileNumber'],
        },
        RequestMobileVerificationResult: {
          type: 'object',
          properties: {
            devOtp: {
              type: 'string',
              pattern: '^\\d{6}$',
              description: 'Only present outside production — a local-testing convenience.',
            },
          },
        },
        ConfirmOtpRequest: {
          type: 'object',
          properties: {
            otp: { type: 'string', pattern: '^\\d{6}$', example: '042317' },
          },
          required: ['otp'],
        },
        VerifyAadhaarRequest: {
          type: 'object',
          description:
            'Compared against the mobile-to-pan lookup for the already-verified mobile number (last 4 digits only — the lookup never discloses the full Aadhaar number).',
          properties: {
            aadharNumber: { type: 'string', pattern: '^\\d{12}$', example: '123456789012' },
          },
          required: ['aadharNumber'],
        },
        VerifyPanRequest: {
          type: 'object',
          description:
            'Compared against the mobile-to-pan lookup for the already-verified mobile number.',
          properties: {
            panNumber: { type: 'string', pattern: '^[A-Z]{5}\\d{4}[A-Z]$', example: 'ABCDE1234F' },
          },
          required: ['panNumber'],
        },
        RejectKycRequest: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              minLength: 1,
              example: 'Aadhar photo is blurry and unreadable',
            },
          },
          required: ['reason'],
        },
        CriminalRecordCheck: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'clear', 'flagged'] },
            checkedAt: { type: 'string', format: 'date-time' },
          },
          required: ['status'],
        },
        SetCriminalRecordStatusRequest: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'clear', 'flagged'] },
          },
          required: ['status'],
        },
        OnboardingFee: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['unpaid', 'paid'] },
            amountInRupees: { type: 'number', example: 10 },
            paidAt: { type: 'string', format: 'date-time' },
          },
          required: ['status', 'amountInRupees'],
        },
        OnboardingFeeCheckoutRequest: {
          type: 'object',
          properties: {
            redirectUrl: {
              type: 'string',
              format: 'uri',
              description:
                'Where the client wants to land after paying — the callback route redirects here once confirmed.',
              example: 'https://app.example.com/onboarding-fee',
            },
          },
          required: ['redirectUrl'],
        },
        OnboardingFeeCheckoutResult: {
          type: 'object',
          properties: {
            shortUrl: { type: 'string', example: 'https://rzp.io/i/PWtAiEo' },
          },
          required: ['shortUrl'],
        },
        DashboardSummary: {
          type: 'object',
          description:
            'kyc/criminalRecord/onboardingFee are only present for a service_provider — a customer only books services and never goes through that onboarding.',
          properties: {
            user: {
              type: 'object',
              properties: {
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                email: { type: 'string', format: 'email' },
                role: { type: 'string', enum: ['admin', 'service_provider', 'customer'] },
              },
              required: ['firstName', 'lastName', 'email', 'role'],
            },
            kyc: { $ref: '#/components/schemas/KycRecord' },
            criminalRecord: { $ref: '#/components/schemas/CriminalRecordCheck' },
            onboardingFee: { $ref: '#/components/schemas/OnboardingFee' },
          },
          required: ['user'],
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
          description:
            'Every self-registered account becomes a service_provider — there is no account-type choice at signup.',
          properties: {
            firstName: { type: 'string', minLength: 1, maxLength: 120 },
            lastName: { type: 'string', minLength: 1, maxLength: 120 },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8, maxLength: 128 },
          },
          required: ['firstName', 'lastName', 'email', 'password'],
        },
        SetServiceCategoryRequest: {
          type: 'object',
          properties: {
            serviceCategory: {
              type: 'string',
              enum: ['electrician', 'plumber', 'cleaner', 'carpenter', 'painter', 'other'],
            },
          },
          required: ['serviceCategory'],
        },
        ServiceProfile: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['electrician', 'plumber', 'cleaner', 'carpenter', 'painter', 'other'],
            },
            description: { type: 'string', nullable: true, maxLength: 1000 },
            yearsOfExperience: { type: 'integer', nullable: true, minimum: 0, maximum: 80 },
          },
          required: ['category', 'description', 'yearsOfExperience'],
        },
        UpsertServiceProfileRequest: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['electrician', 'plumber', 'cleaner', 'carpenter', 'painter', 'other'],
            },
            description: { type: 'string', maxLength: 1000 },
            yearsOfExperience: { type: 'integer', minimum: 0, maximum: 80 },
          },
          required: ['category'],
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
          description:
            'Optional when the `refreshToken` cookie is present (set by login/refresh) — required otherwise.',
          properties: {
            refreshToken: {
              type: 'string',
              minLength: 1,
              example: 'f3a9c1d7e5b8a2f6c4d9e1b7a5f8c2d6',
            },
          },
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
          description:
            'One-shot — the OTP is both the proof of mailbox ownership and the authorization to set the new password.',
          properties: {
            email: { type: 'string', format: 'email', example: 'jane.doe@example.com' },
            otp: { type: 'string', pattern: '^\\d{6}$', example: '042317' },
            password: {
              type: 'string',
              minLength: 8,
              maxLength: 128,
              example: 'new-supersecret-456',
            },
          },
          required: ['email', 'otp', 'password'],
        },
        ChangePasswordRequest: {
          type: 'object',
          properties: {
            currentPassword: { type: 'string', minLength: 1, example: 'supersecret-123' },
            newPassword: {
              type: 'string',
              minLength: 8,
              maxLength: 128,
              example: 'new-supersecret-456',
            },
          },
          required: ['currentPassword', 'newPassword'],
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
