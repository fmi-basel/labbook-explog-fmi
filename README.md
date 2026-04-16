# LabBook ExpLog Plugin

## Version 2.1.3 – Security Update and Build Stability

### Summary
Version **2.1.3** includes a **security update** and retains the required build fix for compatibility with newer **Obsidian / Electron** runtimes.

Without the build fix, the plugin may fail to load at runtime with errors such as:

    Cannot find module 'string_decoder/'

Additionally, this release resolves a **transitive dependency vulnerability (CVE-2026-4800)** in Lodash.

---

## Security Fix – CVE-2026-4800 (Lodash)

### Issue
A vulnerability was identified in **Lodash (`_.template`)**, allowing potential code injection via crafted `imports` key names.

The plugin itself does **not directly use Lodash**, but a vulnerable version was included via:

    archiver → archiver-utils → lodash@4.17.21

### Fix Applied in 2.1.3

The dependency is now forced to a patched version:

    lodash@4.18.1

This is enforced via `package.json`:

```json
"overrides": {
  "lodash": "^4.18.1"
}
```

---

## Version 2.1.2 – Build and Compatibility Update

### Summary
Version **2.1.2** introduces a required build fix to ensure compatibility with newer **Obsidian / Electron** runtimes.

Without this fix, the plugin may fail to load at runtime with errors such as:

    Cannot find module 'string_decoder/'

---

## Build Environment

### Requirements
- **Node.js**: ≥ 18 (tested with current LTS)
- **npm**: ≥ 9

After moving the repository to a new machine or changing Node versions, dependencies must be reinstalled:

    rmdir /s /q node_modules
    npm install

---

## Electron Compatibility Fix (Post-Build Rewrite)

Obsidian plugins run inside **Electron**, not plain Node.js.  
Electron does not resolve Node core modules when they are referenced with a trailing slash.

Some bundlers (including esbuild) may emit requires such as:

    require("process/")
    require("string_decoder/")

These paths are invalid at runtime in Electron.

### Fix Applied in 2.1.2

A post-build step rewrites invalid requires in the generated `main.js`:

- `require("process/")` → `require("process")`
- `require("string_decoder/")` → `require("string_decoder")`

The rewrite:
- runs after bundling
- is applied once per build
- operates in-memory and writes the file only if changes are detected
- runs automatically in watch/dev mode after rebuilds

---

## Native Dependency Note (`keytar`)

The plugin includes a native module (`keytar.node`).

On Windows, native `.node` files are locked while in use.  
When creating a new `dist` build, ensure the plugin is **not loaded** in Obsidian, otherwise the build may fail with:

    EBUSY: resource busy or locked

---

## Plugin Versioning

The plugin version used by Obsidian is defined in **`manifest.json`**.

For this release:

    "version": "2.1.3"

The version in `package.json` is not used by Obsidian at runtime.

---

## Outcome

With these changes:
- The plugin loads correctly in newer Obsidian / Electron versions
- Runtime module resolution errors are eliminated
- The build process is deterministic across environments
