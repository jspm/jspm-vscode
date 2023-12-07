export default {
  input: './src/extension.mjs',
  output: {
    file: 'dist/extension.js',
    format: 'es',
    inlineDynamicImports: true,
    sourcemap: 'inline'
  },
  onwarn () {},
  plugins: []
}
