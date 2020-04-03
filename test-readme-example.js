const fs = require('fs')
const console = require('console')

const standard = require('standard')

// Load code from stdin.
let code
while (code === undefined) {
  try {
    code = fs.readFileSync(0, 'utf-8')
    break
  } catch (e) {
    if (e.code === 'EAGAIN') continue
    else throw e
  }
}

// Check it through standardjs
const lint = standard.lintTextSync(code, { globals: ['p'] })
if (lint.errorCount > 0 || lint.warningCount > 0) {
  for (const result of lint.results) {
    for (const m of result.messages) {
      console.error(`standard.js complaint at line ${m.line}, column ${m.column}:`)
      console.error(`  ${m.message}`)
      console.error(`  (rule '${m.ruleId}')`)
    }
  }
  process.exit(0xBAD)
}

// Replace requires for the npm-published name with local file
code = code
  .replace(/require\(("partser"|'partser')\)/g, 'require(\'./index.js\')')

// If the first line doesn't call require, add it.
if (!code.match(/^.*require\(.*\n/)) {
  code = 'const p = require(\'./index.js\')\n' + code
}

// Make console.log etc log full depth of every object (instead of their
// default depth 2).
Object.assign(console, new console.Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: { depth: Infinity }
}))

// Need to eval rather than new Function() because the code needs access to
// current scope, to use require etc.
eval(code) // eslint-disable-line no-eval
