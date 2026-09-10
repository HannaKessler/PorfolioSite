/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SECRET_NOTES_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
