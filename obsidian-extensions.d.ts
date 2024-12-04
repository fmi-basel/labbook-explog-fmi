import { App } from "obsidian";

declare module "obsidian" {
  interface App {
    plugins: {
      manifests: Record<string, PluginManifest>;
      plugins: Record<string, any>;
      enabledPlugins: Set<string>;
      requestSaveConfig: () => void;
    };
    commands: {
      listCommands: () => Array<{ id: string; name: string }>;
      executeCommandById: (id: string) => void;
    };
  }
}