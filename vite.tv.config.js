import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/tv-bundle.js'),
      name: 'KimerawareTV',
      fileName: (format) => `tv-bundle.${format}.js`,
      formats: ['umd']
    },
    rollupOptions: {
      external: ['three', 'three/examples/jsm/loaders/GLTFLoader.js'],
      output: {
        globals: {
          three: 'THREE',
          'three/examples/jsm/loaders/GLTFLoader.js': 'THREE'
        }
      }
    },
    emptyOutDir: false
  }
});
