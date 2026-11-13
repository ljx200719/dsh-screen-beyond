// 基础 ESLint 配置（flat config）。安装 eslint 后：npm run lint
export default [
  {
    files: ['runtime/**/*.mjs', 'lib/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 运行时/浏览器脚本混在同一批文件里，Node 全局（process/console/AbortSignal…）与浏览器全局（window/document…）未逐个声明，先从规则里关掉\n      'no-undef': 'off',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-fallthrough': 'error',
      'no-redeclare': 'error',
      'no-self-assign': 'error',
      'no-unused-private-class-members': 'warn',
      'no-useless-escape': 'warn',
      'no-async-promise-executor': 'error',
      'no-promise-executor-return': 'warn',
    },
  },
]
