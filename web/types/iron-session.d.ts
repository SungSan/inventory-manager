import 'iron-session';

declare module 'iron-session' {
  interface IronSessionData {
    userId?: string;
    role?: 'admin' | 'operator' | 'viewer';
  }
}
