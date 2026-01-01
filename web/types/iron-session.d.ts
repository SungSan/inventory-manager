import "iron-session";
import type { Role } from "../lib/session";
declare module "iron-session" {
  interface IronSessionData {
    userId?: string;
    role?: Role;
  }
  interface IronSession {
    userId?: string;
    role?: Role;
  }
}
