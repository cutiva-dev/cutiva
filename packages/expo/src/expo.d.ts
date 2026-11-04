// The one function this package uses from `expo` (a peer dependency), typed here so the package
// builds without installing Expo in the monorepo.
declare module "expo" {
  export function requireNativeModule<T>(name: string): T;
}
