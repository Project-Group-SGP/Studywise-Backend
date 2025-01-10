export interface GoogleUserPayload {
  email: string;
  email_verified: boolean;
  name: string;
  picture: string;
  given_name: string;
  family_name: string;
  locale: string;
}

declare module "express-session" {
  interface Session {
    user?: GoogleUserPayload;
  }
}

// types.ts
declare global {
  namespace Express {
    interface Request {
      user?: GoogleUserPayload;
    }
  }
}
