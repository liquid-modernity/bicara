import * as GagaEngine from '@gaga/engine';

export const GAGA_ENGINE_VERSION = '0.1.6' as const;

export interface GagaRuntimeBoundary {
  readonly version: typeof GAGA_ENGINE_VERSION;
  readonly exports: readonly string[];
  readonly module: Readonly<Record<string, unknown>>;
}

let runtime: GagaRuntimeBoundary | undefined;

export function initializeGagaBoundary(): GagaRuntimeBoundary {
  if (runtime) return runtime;

  const moduleNamespace = GagaEngine as unknown as Record<string, unknown>;
  runtime = Object.freeze({
    version: GAGA_ENGINE_VERSION,
    exports: Object.freeze(Object.keys(moduleNamespace).sort()),
    module: moduleNamespace
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('gaga:engine-ready', {
        detail: {
          version: runtime.version,
          exports: runtime.exports
        }
      })
    );
  }

  return runtime;
}

export function emitGagaEvent<T>(name: `gaga:${string}`, detail: T): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
