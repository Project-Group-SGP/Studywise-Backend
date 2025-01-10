export interface GoogleUserPayload {
  email: string;
  name: string;
  picture: string;
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
