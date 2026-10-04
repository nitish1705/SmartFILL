import { defineConfig } from 'wxt';

// E2E builds (Playwright cannot click the toolbar button, so activeTab is replaced by a
// localhost host permission) and expose the overlay's shadow root for assertions.
const e2e = !!process.env.SMARTFILL_E2E;

export default defineConfig({
  outDir: e2e ? '.output-e2e' : '.output',
  vite: () => ({ define: { __E2E__: JSON.stringify(e2e) } }),
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'SmartFill',
    description: 'Fill web forms from your verified profile. Local-first; never submits; leaves unknown fields blank.',
    // activeTab + scripting: the page is only touched when the user clicks SmartFill.
    permissions: ['storage', 'activeTab', 'scripting', 'offscreen'],
    ...(e2e ? { host_permissions: ['http://localhost/*'] } : {}),
    // ONNX Runtime needs WebAssembly; no remote code is allowed.
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+F' }, description: 'Open SmartFill' },
    },
  },
});
