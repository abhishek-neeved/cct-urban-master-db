export interface SuccessResponse<T> {
  success: true;
  data: T;
  requestId?: string;
}

export interface ErrorResponse {
  success: false;
  error: {
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

export const success = <T>(data: T, requestId?: string): SuccessResponse<T> => ({
  success: true,
  data,
  requestId,
});

export const failure = (message: string, requestId?: string, details?: unknown): ErrorResponse => ({
  success: false,
  error: { message, details },
  requestId,
});
