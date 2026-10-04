import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'SmartFill',
    description: 'Fill web forms from your verified profile. Local-first; never submits; leaves unknown fields blank.',
    // activeTab + scripting: the page is only touched when the user clicks SmartFill.
    permissions: ['storage', 'activeTab', 'scripting'],
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+F' }, description: 'Open SmartFill' },
    },
  },
});
