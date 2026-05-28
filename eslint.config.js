import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'

export default [
  js.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**', '.turbo/**', 'coverage/**'],
  },
]
