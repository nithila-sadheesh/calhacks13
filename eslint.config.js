// ESLint config. Besides the usual rules it enforces AGENTS.md section 3:
// no cross-module imports, no Date.now() trip logic, no bare console.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const modules = ['map', 'vision', 'voice', 'arbiter'];

// A module folder may not import any other module folder.
const noCrossImports = modules.map((name) => ({
  files: [`app/src/${name}/**`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: modules
          .filter((other) => other !== name)
          .map((other) => ({
            group: [`**/${other}`, `**/${other}/*`],
            message: 'Modules talk only through the bus (AGENTS.md rule 3).',
          })),
      },
    ],
  },
}));

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.vercel'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-console': 'error',
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Use ctx.clock.nowMs() (AGENTS.md rule 5).' },
      ],
    },
  },
  ...noCrossImports,
  // Scripts and the logger legitimately print and may use wall-clock time.
  {
    files: ['scripts/**', 'server/**', 'shared/log.ts', 'tests/**'],
    rules: { 'no-console': 'off', 'no-restricted-properties': 'off' },
  },
);
