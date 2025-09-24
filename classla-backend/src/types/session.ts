import 'express-session';
import { UserSessionData } from '../services/session';

declare module 'express-session' {
  interface SessionData {
    user?: UserSessionData;
    authState?: string;
  }
}

export {};