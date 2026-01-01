import "iron-session";
type Role = "admin" | "operator" | "viewer";
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
