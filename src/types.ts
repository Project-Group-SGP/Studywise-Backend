export interface GoogleUserPayload {
  email: string;
  name: string;
  picture: string;
}

export interface TokenPayload extends GoogleUserPayload {
  id: string;
}

declare module "express-session" {
  interface Session {
    user?: GoogleUserPayload;
  }
}

export interface PushSubscriptionKeys {
  auth: string;
  p256dh: string;
}

export interface WebPushSubscription {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

// types.ts
declare global {
  namespace Express {
    interface Request {
      user?: GoogleUserPayload;
    }
  }
}
