/**
 * @tronbrowser/plugins
 * Plugin SDK and lifecycle host (PRD §Plugin SDK).
 */

export const PACKAGE_NAME = '@tronbrowser/plugins' as const;

/** Plugin lifecycle phases. */
export const PLUGIN_LIFECYCLE = [
  'install',
  'enable',
  'disable',
  'update',
  'uninstall',
] as const;
export type PluginLifecyclePhase = (typeof PLUGIN_LIFECYCLE)[number];

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** Capabilities the plugin requests; host enforces least privilege. */
  permissions: string[];
}

/** Host-provided API surface; intentionally narrow at M0. */
export interface PluginContext {
  readonly manifest: PluginManifest;
  log(message: string): void;
}

/** A plugin implements any subset of lifecycle hooks. */
export interface Plugin {
  readonly manifest: PluginManifest;
  onInstall?(ctx: PluginContext): Promise<void> | void;
  onEnable?(ctx: PluginContext): Promise<void> | void;
  onDisable?(ctx: PluginContext): Promise<void> | void;
  onUpdate?(ctx: PluginContext, previousVersion: string): Promise<void> | void;
  onUninstall?(ctx: PluginContext): Promise<void> | void;
}

/** Manages installed plugins and dispatches lifecycle events. */
export interface PluginHost {
  install(plugin: Plugin): Promise<void>;
  enable(id: string): Promise<void>;
  disable(id: string): Promise<void>;
  update(plugin: Plugin): Promise<void>;
  uninstall(id: string): Promise<void>;
  list(): PluginManifest[];
}
