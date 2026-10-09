declare module 'gaga' {
  const moduleNamespace: Record<string, unknown>;
  export = moduleNamespace;
}

interface ImportMetaEnv {
  readonly PUBLIC_SIGNALING_URL?: string;
  readonly PUBLIC_DEFAULT_ROOM?: string;
  readonly PUBLIC_MAX_PARTICIPANTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
