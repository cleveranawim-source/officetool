import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 공개 저장소에는 익명화된 샘플 시간표만 둔다.
// SISU_PRIVATE=1 이면 gitignore된 data-private/timetable.json(실명)을 사용한다.
const privateTT = resolve(__dirname, 'data-private/timetable.json');
const usePrivate = process.env.SISU_PRIVATE === '1' && existsSync(privateTT);

export default defineConfig({
  plugins: [viteSingleFile()],
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  resolve: {
    alias: {
      '@timetable': usePrivate ? privateTT : resolve(__dirname, 'src/data/sample-timetable.json'),
    },
  },
  build: { target: 'es2020' },
});
