const fs = require('fs')
const console = require('console')

// Load code from stdin.
let code = fs.readFileSync(0, 'utf-8')
  // Replace requires for the npm-published name with local file
  .replace(/require\(("partser"|'partser')\)/g, 'require("./index.js")')

// If the first line doesn't call require, add it.
if (!code.match(/^.*require\(.*\n/)) {
  code = 'const p = require("./index.js")\n' + code
}

// Make console.log etc log full depth of every object (instead of their
// default depth 2).
const newConsole = new console.Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: { depth: Infinity }
})
Object.assign(console, newConsole)

// Need to eval rather than new Function() because the code needs access to
// current scope, to use require etc.
eval(code) // eslint-disable-line no-eval
