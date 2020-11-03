'use strict'

// Colour handling used by `.debug`
const supportsColour = require('supports-color')
const colour = require('ansi-colors')
const sliceWithContext = require('slice-with-context')
colour.enabled = supportsColour.stdout.hasBasic === true

const Partser = {}
module.exports = Partser

//
// This WeakMap stores a `x -> Bool` mapping of whether the value `x` is a
// parser or not.  As it holds weak references, its entries are
// garbage-collected with its keys, so we don't leak memory even if we never
// remove entries.
//
// Q:  Why not make `Parser` a class and use `instanceof`?
//
// A:  Because parsers should be callable, and instances of a class aren't.
// Except if your class extends the Function built-in, but last I read about
// that sorcery, I almost opened a portal to hell.  (It's far more complicated
// than this solution.)
//
const parsersMap = new WeakMap()
const isParser = p => parsersMap.has(p)
Partser.isParser = isParser

const toString = x => Object.prototype.toString.call(x)

// Helpers for checking argument types
const assert = (typeName, check) => {
  return (functionName, value) => {
    if (!check(value)) {
      throw new TypeError(
        `Partser.${functionName}: Not a ${typeName}: ${toString(value)}`)
    }
  }
}
const assertParser = assert('parser', isParser)
const assertNumber = assert('number', (x) => typeof x === 'number')
const assertRegexp = assert('regex', (x) => x instanceof RegExp)
const assertFunction = assert('function', (x) => typeof x === 'function')
const assertString = assert('string', (x) => typeof x === 'string')

const skip = (...parsers) => {
  return Partser.map(Partser.seq(parsers), ([x]) => x) // first only
}

// Base parser constructor
const Parser = Partser.Parser = (name, behaviour) => {
  //
  // A parser can be called in 3 different ways:
  //
  // The `parser` function returned here is the user-facing API.  When it is
  // called, it is expected to parse its target text, then parse `Partser.eof`
  // to match the end of input.  This is what users would expect a parser to
  // do; to fail if there is still input remaining.  However, this is
  // unsuitable for being called by other parsers, because we just want to know
  // if this parser matched, and possibly backtrack or continue parsing from
  // where it stopped.
  //
  // The `_` property (a function) is what's used internally instead.  It is
  // expected to parse the target text and succeed if so, regardless of whether
  // that's the end of the input or not.  This way, it's easy to have other
  // parsers continue from there.  The `_` function also calls debug handler
  // functions if defined, for descriptive debugging output.
  //
  // The `behaviour` property is the basic behaviour of the function i.e. the
  // same as `_` but without calling debug handlers.
  //
  const parser = (input, env, index = 0) =>
    skip(parser, Partser.eof)._(input, index, env)
  parser.behaviour = behaviour
  parser.displayName = name
  parser._ = (input, index, env, debugHandler) => {
    if (debugHandler) { debugHandler.enter(parser, input, index, env) }
    const result = parser.behaviour(input, index, env, debugHandler)
    if (debugHandler) { debugHandler.exit(parser, input, index, env, result) }
    return result
  }
  parsersMap.set(parser, true)
  return parser
}

const makeSuccess = (index, value) =>
  ({ status: true, index, value })

const makeFailure = (index, expected) =>
  ({ status: false, index, value: [expected] })

const mergeOver = (() => {
  const furthest = (result) => result.status ? -1 : result.index
  const expected = (result) => result.value

  // Given a parse result and a previously existing failure, return whichever
  // is "better" (either because it succeeded, or because it matched more of
  // the input before before failing).  If they are equal failures, combine
  // their 'expected' values.
  return (next, previous) => {
    if (!previous || next.status || furthest(next) > furthest(previous)) {
      return next
    } else {
      return {
        status: false,
        index: next.index,
        value: expected(next).concat(expected(previous))
      }
    }
  }
})()

const formatExpected = (expected) => {
  if (expected.length === 1) return expected[0]
  else return `one of ${expected.join(', ')}`
}

const formatGot = (input, error) => {
  const i = error.index
  const where = `at character ${i}`

  if (i === input.length) return `${where}, got end of input`
  else {
    const amountOfContext = 10
    const remainingCharsInInput = input.length - i
    let actualValue = input.slice(i, i + amountOfContext)
    if (remainingCharsInInput > i + amountOfContext) actualValue += '...'
    return `${where}, got '${actualValue}'`
  }
}

Partser.formatError = (input, error) =>
  `expected ${formatExpected(error.value)} ${formatGot(input, error)}`

Partser.except = (allowed, forbidden) => {
  assertParser('except', allowed)
  assertParser('except', forbidden)
  return Parser('except', (input, i, env, debugHandler) => {
    const forbiddenResult = forbidden._(input, i, env, debugHandler)
    if (forbiddenResult.status) {
      return makeFailure(i, `something that is not '${forbiddenResult.value}'`)
      // This expected-value text's vagueness is unfortunate.  It would be more
      // helpful if it said what *was* expected rather than what *was not*.
      // It's due to an architectural limitation with this library:  Parsers
      // only generate an expected-value dynamically when they fail.  This
      // means we can't just ask a parser what its expected value is.
      //
      // A more informative error could be enabled in the future by extending
      // the parser API with a method of asking the parser what it would
      // hypothetically expect to read next, if called at a given offset `i`.
    } else {
      const allowedResult = allowed._(input, i, env, debugHandler)
      if (allowedResult.status) return allowedResult
      else {
        return makeFailure(i, formatExpected(allowedResult.value) +
        ` (except ${formatExpected(forbiddenResult.value)})`)
      }
    }
  })
}

// deriveEnv is a user-provided function that creates a new environment based
// on the existing one.
Partser.subEnv = (baseParser, deriveEnv) => {
  assertParser('subEnv', baseParser)
  assertFunction('subEnv', deriveEnv)
  return Parser('subEnv', (input, i, env, debugHandler) => {
    const newEnv = deriveEnv(env)
    return baseParser._(input, i, newEnv, debugHandler)
  })
}

Partser.from = (lookup) => {
  assertFunction('from', lookup)
  return Parser('from', (input, i, env, debugHandler) => {
    const foundParser = lookup(env)
    // To aid in debugging, if this isn't a parser, then also mention the
    // lookup function in the assert message.
    assert('parser', isParser)(`from(${lookup})`, foundParser)
    return foundParser._(input, i, env, debugHandler)
  })
}

Partser.seq = (parsers, chainEnv = undefined) => {
  parsers.forEach((x) => assertParser('seq', x))
  return Parser(`seq(*${parsers.length})`, (input, i, env, debugHandler) => {
    let result
    const accum = new Array(parsers.length)

    for (let j = 0; j < parsers.length; j += 1) {
      const nextResult = parsers[j]._(input, i, env, debugHandler)
      result = mergeOver(nextResult, result)
      if (!result.status) return result
      else {
        if (chainEnv) {
          env = chainEnv(result.value, env)
        }
        accum[j] = result.value
        i = result.index
      }
    }

    return mergeOver(makeSuccess(i, accum), result)
  })
}

Partser.custom = (parsingFunction) => {
  assertFunction('custom', parsingFunction)
  return Parser('custom', parsingFunction)
}

Partser.alt = (parsers) => {
  if (parsers.length === 0) throw TypeError('Partser.alt: Zero alternates')
  parsers.forEach((x) => assertParser('alt', x))

  return Parser(`alt(*${parsers.length})`, (input, i, env, debugHandler) => {
    let result
    for (let j = 0; j < parsers.length; j += 1) {
      result = mergeOver(parsers[j]._(input, i, env, debugHandler), result)
      if (result.status) return result
    }
    return result
  })
}

Partser.times = (parser, min, max, chainEnv = undefined) => {
  if (max === undefined) max = min

  assertParser('times', parser)
  assertNumber('times', min)
  assertNumber('times', max)

  return Parser(`times(${min},${max})`, (input, i, env, debugHandler) => {
    const successes = []
    let times = 0
    let index = i
    let previousResult

    // First require successes until `min`.  In other words, return failure
    // if we mismatch before reaching `min` times.
    for (; times < min; ++times) {
      const result = parser._(input, index, env, debugHandler)
      const mergedResult = mergeOver(result, previousResult)
      if (result.status) {
        previousResult = mergedResult
        index = result.index
        successes.push(result.value)
        if (chainEnv) {
          env = chainEnv(result.value, env)
        }
      } else return mergedResult
    }

    // Then allow successes up until `max`.  In other words, just stop on
    // mismatch, and return a success with whatever we've got by then.
    for (; times < max; ++times) {
      const result = parser._(input, index, env, debugHandler)
      const mergedResult = mergeOver(result, previousResult)
      if (result.status) {
        previousResult = mergedResult
        index = result.index
        successes.push(result.value)
        if (chainEnv) {
          env = chainEnv(result.value, env)
        }
      } else break
    }

    return makeSuccess(index, successes)
  })
}

Partser.map = (parser, fn) => {
  assertParser('map', parser)
  assertFunction('map', fn)

  return Parser('map', (input, i, env, debugHandler) => {
    const result = parser._(input, i, env, debugHandler)
    if (!result.status) return result
    return makeSuccess(result.index, fn(result.value, env))
  })
}

const seqMap = (...args) => {
  const mapper = args.pop()
  return Partser.map(
    Partser.seq(args),
    (results) => mapper(...results))
}

Partser.mark = (parser) => {
  assertParser('mark', parser)

  return seqMap(
    Partser.index, parser, Partser.index,
    (start, value, end) => ({ start, value, end }))
}

Partser.lcMark = (parser) => {
  assertParser('lcMark', parser)

  return seqMap(
    Partser.lcIndex, parser, Partser.lcIndex,
    (start, value, end) => ({ start, value, end }))
}

Partser.desc = (parser, expected) => {
  assertParser('desc', parser)
  assertString('desc', expected)

  return Parser(`desc(${JSON.stringify(expected)}, ${parser.name})`, (input, i, env, debugHandler) => {
    let result = parser.behaviour(input, i, env, debugHandler)
    if (!result.status) {
      // Defensive programming:  Make a copy of the result object before
      // changing it.  Simply changing it might cause subtle bugs if a user's
      // custom parser stored the result object somewhere before returning it,
      // and something else is reading its contents later.
      result = Object.assign({}, result)
      result.value = [expected]
    }
    return result
  })
}

Partser.string = (str) => {
  assertString('string', str)

  const len = str.length
  const expected = `'${str}'`

  return Parser(`string(${JSON.stringify(str)})`, (input, i) => {
    const head = input.slice(i, i + len)

    if (head === str) return makeSuccess(i + len, head)
    else return makeFailure(i, expected)
  })
}

Partser.regex = (re, group = 0) => {
  assertRegexp('regex', re)
  assertNumber('regex', group)

  const anchored = RegExp(
    `^(?:${re.source})`,
    `${re}`.slice(`${re}`.lastIndexOf('/') + 1))
  const expected = `${re}`

  return Parser(`regex(${re.toString()}, ${group})`, (input, i) => {
    const match = anchored.exec(input.slice(i))

    if (match) {
      const fullMatch = match[0]
      const groupMatch = match[group]
      return makeSuccess(i + fullMatch.length, groupMatch)
    }

    return makeFailure(i, expected)
  })
}

Partser.succeed = (value) =>
  Parser('succeed', (input, i) => makeSuccess(i, value))

Partser.fail = (expected) => {
  assertString('fail', expected)
  return Parser('fail', (input, i) => makeFailure(i, expected))
}

Partser.any = Parser('any', (input, i) => {
  if (i >= input.length) return makeFailure(i, 'any character')
  return makeSuccess(i + 1, input.charAt(i))
})

Partser.all = Parser('all', (input, i) =>
  makeSuccess(input.length, input.slice(i)))

Partser.eof = Parser('eof', (input, i) => {
  if (i < input.length) return makeFailure(i, 'EOF')
  return makeSuccess(i, null)
})

Partser.test = (predicate) => {
  assertFunction('test', predicate)

  return Parser('test', (input, i, env) => {
    const char = input.charAt(i)
    if (i < input.length && predicate(char, env)) {
      return makeSuccess(i + 1, char)
    } else {
      return makeFailure(i, `a character matching ${predicate}`)
    }
  })
}

Partser.index = Parser('index', (input, i) => makeSuccess(i, i))

const lineAndColumnOfOffset = (input, i) => {
  const lines = input.slice(0, i).split('\n')

  // Note:  The character offset is 0-based; lines and columns are 1-based.
  const line = lines.length
  const column = lines[lines.length - 1].length + 1
  return { line, column }
}

Partser.lcIndex = Parser('lcIndex', (input, i) => {
  // Like the usual `index` function, but emitting an object that contains line
  // and column indices in addition to the character-based one.  Less
  // performant, but often convenient.

  const { line, column } = lineAndColumnOfOffset(input, i)
  return makeSuccess(i, { offset: i, line, column })
})

//
// Specials
//

Partser.clone = (parser) => {
  assertParser('clone', parser)
  const newParser = Partser.custom(parser.behaviour)
  newParser.displayName = parser.displayName
  return newParser
}

Partser.replace = (original, replacement) => {
  assertParser('replace', original)
  assertParser('replace', replacement)
  original.behaviour = replacement.behaviour
}

Partser.chain = (parser, lookup) => {
  assertParser('chain', parser)
  assertFunction('chain', lookup)
  return Parser('chain', (input, i, env, debugHandler) => {
    const result = parser._(input, i, env)
    if (!result.status) return result
    const nextParser = lookup(result.value, env)
    return nextParser._(input, result.index, env, debugHandler)
  })
}

//
// Debug stuff
//

const replaceUnprintables = (str) => {
  return str.split('').map((c) => {
    // Display newlines and tabs using arrows
    if (c === '\n') { return '⏎' }
    if (c === '\t') { return '↹' }

    // Display spaces using a space marker
    if (c === ' ') { return '␣' }

    // Display control characters from the C0 control code block (ASCII 0–31)
    // using the Unicode Control Pictures block.  The Control Pictures are in
    // the same order, just offset.
    const charCode = c.charCodeAt()
    if (charCode <= 31) { return String.fromCharCode(0x2400 + charCode) }

    // Display anything else normally.
    return c
  }).join('')
}

const summarisePosition = (input, index, options) => {
  let { nCharsHighlight, paint, context } = options
  nCharsHighlight = nCharsHighlight > context ? context : nCharsHighlight

  // If we are looking to highlight an offset after the end of the input i.e.
  // at EOF, we can just output an appropriate slice.
  if (index === input.length) {
    const endSlice = input.slice(-context, input.length)
    return colour.dim(endSlice) +
      paint(' ') +
      ' '.repeat(context - endSlice.length)
  }

  // Replace control codes and some whitespace characters with clearer
  // stand-ins for single-line display.
  input = replaceUnprintables(input)

  const output = sliceWithContext(
    input,
    context, // windowSize
    index, // offset
    nCharsHighlight, // length
    0.75, // windowLeftBias
    1 // overflowLeftBias
  )
  // console.log(output)
  const before = output.withContext.slice(0, output.position.offset)
  const highlighted = output.withContext.slice(
    output.position.offset,
    output.position.offset + output.position.length)
  const after = output.withContext.slice(
    output.position.offset + output.position.length,
    output.withContext.length)
  const padding = ' '.repeat(context - output.withContext.length)

  return colour.dim(before) + paint(highlighted) + after + padding + ' '
}

const indent = (level, str) => {
  return str.split('\n').map((line) => {
    return colour.dim('· ').repeat(level) + line
  }).join('\n')
}

const indentWithPrefix = (prefix, level, str) => {
  return str.split('\n').map((line) => {
    return prefix + colour.dim('· ').repeat(level) + line
  }).join('\n')
}

Partser.debug = (parser, handler) => {
  if (!handler) { handler = Partser.debug.makeHandler() }
  return Parser('debug', (input, i, env) => parser._(input, i, env, handler))
}

Partser.debug.makeHandler = (options = {}) => {
  const padIfShort = options.padIfShort || false
  const context = options.context !== undefined ? options.context : 10
  const userDefinedEnter = options.enter
  const userDefinedExit = options.exit

  let nestingLevel = 0
  return {
    enter: (parser, input, index, env) => {
      const name = parser.displayName
      const actualContext =
        !padIfShort && context > input.length ? input.length : context

      const userData = userDefinedEnter
        ? userDefinedEnter(parser, input, index, env)
        : undefined

      if (userData !== false) {
        const { line, column } = lineAndColumnOfOffset(input, index)
        const positionSummary = summarisePosition(input, index,
          { nCharsHighlight: 1, paint: colour.inverse, context: actualContext })

        console.log(
          positionSummary + indent(nestingLevel,
            `${line},${column} ${colour.blue(name)} ?`))
        if (userData) {
          console.log(indentWithPrefix(positionSummary, nestingLevel, userData))
        }
      }

      nestingLevel++
    },
    exit: (parser, input, index, env, result) => {
      nestingLevel--
      const name = parser.displayName
      const actualContext =
        !padIfShort && context > input.length ? input.length : context

      const userData = userDefinedExit
        ? userDefinedExit(parser, input, index, env, result)
        : undefined

      if (userData === false) { return }

      const { line, column } = lineAndColumnOfOffset(input, index)
      if (result.status) {
        // Success
        const numCharsEaten = result.index - index
        const eatenPart = input.slice(index, result.index)
        const positionSummary = summarisePosition(input, index, {
          nCharsHighlight: numCharsEaten,
          paint: colour.bgGreen,
          context: actualContext
        })
        console.log(positionSummary + indent(nestingLevel, [
          `${line},${column}`,
          `${colour.blue(name)}`,
          `${colour.green('OKAY')}`,
          `${colour.yellow(JSON.stringify(eatenPart))}`,
          `(len ${numCharsEaten})`].join(' ')))

        if (userData) {
          console.log(indentWithPrefix(positionSummary, nestingLevel, userData))
        }
      } else {
        // Failure
        const positionSummary = summarisePosition(input, index,
          { nCharsHighlight: 1, paint: colour.bgRed, context: actualContext })
        console.log(positionSummary + indent(nestingLevel, [
          `${line},${column}`,
          `${colour.blue(name)}`,
          `FAIL ${JSON.stringify(result.value)}`].join(' ')))
      }
    }
  }
}
