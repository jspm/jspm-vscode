import jspmRollup from '@jspm/plugin-rollup';

export default {
  input: './src/extension.mjs',
  output: {
    file: 'dist/extension.js',
    inlineDynamicImports: true
  },
  onwarn () {},
  plugins: [jspmRollup({
    defaultProvider: 'jspm.io',
    env: ['module', 'production', 'browser', 'vscode'],
  })]
}
