/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/* AVIF asset imports resolve to a URL string. */
declare module "*.avif" {
  const src: string;
  export default src;
}
