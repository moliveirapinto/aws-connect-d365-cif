/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_D365_ORG_URL: string;
  readonly VITE_CONNECT_CCP_URL: string;
  readonly VITE_CONNECT_REGION: string;
  readonly VITE_TRANSCRIPT_WS_URL: string;
  readonly VITE_SCREENPOP_ENTITY: string;
  readonly VITE_SCREENPOP_PHONE_COLUMN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
