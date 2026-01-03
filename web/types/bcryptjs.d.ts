declare module "bcryptjs" {
  export function hash(data: string, salt: string | number): Promise<string>;
  export function hashSync(data: string, salt: string | number): string;
  export function compare(data: string, encrypted: string): Promise<boolean>;
  export function compareSync(data: string, encrypted: string): boolean;
  export function genSaltSync(rounds?: number): string;
  const _default: {
    hash: typeof hash;
    hashSync: typeof hashSync;
    compare: typeof compare;
    compareSync: typeof compareSync;
    genSaltSync: typeof genSaltSync;
  };
  export default _default;
}
