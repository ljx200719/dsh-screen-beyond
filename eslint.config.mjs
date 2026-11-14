// 基础 ESLint 配置（flat config）。安装 eslint 后：npm run lint
export default [
  {
    // lib/client.js 是 src/client/** 构建出来的产物，不重复 lint（要改就改源码）
    ignores: ['lib/client.js'],
  },
  {
    files: ['runtime/**/*.mjs', 'lib/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 运行时/浏览器脚本混在同一批文件里，Node 全局（process/console/AbortSignal…）与浏览器全局（window/document…）未逐个声明，先从规则里关掉
      'no-undef': 'off',
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
  {
    // src/client/** 是"多文件源码、单文件产物"：每个模块用到的 const 定义在别的文件里，
    // 单文件 lint 看不到跨文件引用，所以这里关掉未使用变量检查（真正的未使用由构建后的
    // lib/client.js 语法检查 + 人工 review 覆盖）。
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-fallthrough': 'error',
      'no-redeclare': 'error',
      'no-self-assign': 'error',
      'no-async-promise-executor': 'error',
      'no-promise-executor-return': 'warn',
    },
  },
]
