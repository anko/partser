'use strict'

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
  return Partser.map(Partser.seq(...parsers), ([x]) => x) // first only
}

// Base parser constructor
const Parser = Partser.Parser = (behaviour) => {
  //
  // The `_` property contains the actual implementation of the parser's
  // behaviour.  It can be changed with the `replace` combinator, to change
  // behaviour while keeping this parser's identity the same.
  //
  // Internally, we want the parser to succeed if it matches even if it didn't
  // parse the full input string, so we can continue with the next parser.
  // This is what the base behaviour in `_` does.
  //
  // However, users would find this confusing; the expectation is for parsers
  // to fail unless they can match the whole input string!  Therefore, the
  // parser function itself actually parses for the base behaviour `_` followed
  // by `eof` (end of input).  Internally, we never use this surface API.
  //
  const parser = (input, env, index = 0) =>
    skip(parser, Partser.eof)._(input, index, env)
  parser._ = behaviour
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
  return Parser((input, i, env) => {
    const forbiddenResult = forbidden._(input, i, env)
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
      const allowedResult = allowed._(input, i, env)
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
  return Parser((input, i, env) => {
    const newEnv = deriveEnv(env)
    return baseParser._(input, i, newEnv)
  })
}

Partser.from = (lookup) => {
  assertFunction('from', lookup)
  return Parser((input, i, env) => {
    const foundParser = lookup(env)
    // To aid in debugging, if this isn't a parser, then also mention the
    // lookup function in the assert message.
    assert('parser', isParser)(`from(${lookup})`, foundParser)
    return foundParser._(input, i, env)
  })
}

Partser.seq = (...parsers) => {
  parsers.forEach((x) => assertParser('seq', x))
  return Parser((input, i, env) => {
    let result
    const accum = new Array(parsers.length)

    for (let j = 0; j < parsers.length; j += 1) {
      result = mergeOver(parsers[j]._(input, i, env), result)
      if (!result.status) return result
      accum[j] = result.value
      i = result.index
    }

    return mergeOver(makeSuccess(i, accum), result)
  })
}

Partser.custom = (parsingFunction) => {
  assertFunction('custom', parsingFunction)
  return Parser(parsingFunction)
}

Partser.alt = (...parsers) => {
  if (parsers.length === 0) throw TypeError('Partser.alt: Zero alternates')
  parsers.forEach((x) => assertParser('alt', x))

  return Parser((input, i, env) => {
    let result
    for (let j = 0; j < parsers.length; j += 1) {
      result = mergeOver(parsers[j]._(input, i, env), result)
      if (result.status) return result
    }
    return result
  })
}

Partser.times = (parser, min, max) => {
  if (max === undefined) max = min

  assertParser('times', parser)
  assertNumber('times', min)
  assertNumber('times', max)

  return Parser((input, i, env) => {
    const successes = []
    let times = 0
    let index = i
    let previousResult

    // First require successes until `min`.  In other words, return failure
    // if we mismatch before reaching `min` times.
    for (; times < min; ++times) {
      const result = parser._(input, index, env)
      const mergedResult = mergeOver(result, previousResult)
      if (result.status) {
        previousResult = mergedResult
        index = result.index
        successes.push(result.value)
      } else return mergedResult
    }

    // Then allow successes up until `max`.  In other words, just stop on
    // mismatch, and return a success with whatever we've got by then.
    for (; times < max; ++times) {
      const result = parser._(input, index, env)
      const mergedResult = mergeOver(result, previousResult)
      if (result.status) {
        previousResult = mergedResult
        index = result.index
        successes.push(result.value)
      } else break
    }

    return makeSuccess(index, successes)
  })
}

Partser.map = (parser, fn) => {
  assertParser('map', parser)
  assertFunction('map', fn)

  return Parser((input, i, env) => {
    const result = parser._(input, i, env)
    if (!result.status) return result
    return makeSuccess(result.index, fn(result.value, env))
  })
}

const seqMap = (...args) => {
  const mapper = args.pop()
  return Partser.map(
    Partser.seq(...args),
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

  return Parser((input, i, env) => {
    let result = parser._(input, i, env)
    if (!result.status) {
      // Make a copy.  Simply assigning a new value might cause subtle bugs if
      // a user's custom parser saves their result value somewhere before
      // returning it.
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

  return Parser((input, i) => {
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

  return Parser((input, i) => {
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
  Parser((input, i) => makeSuccess(i, value))

Partser.fail = (expected) => {
  assertString('fail', expected)
  return Parser((input, i) => makeFailure(i, expected))
}

Partser.any = Parser((input, i) => {
  if (i >= input.length) return makeFailure(i, 'any character')
  return makeSuccess(i + 1, input.charAt(i))
})

Partser.all = Parser((input, i) =>
  makeSuccess(input.length, input.slice(i)))

Partser.eof = Parser((input, i) => {
  if (i < input.length) return makeFailure(i, 'EOF')
  return makeSuccess(i, null)
})

Partser.test = (predicate) => {
  assertFunction('test', predicate)

  return Parser((input, i, env) => {
    const char = input.charAt(i)
    if (i < input.length && predicate(char, env)) {
      return makeSuccess(i + 1, char)
    } else {
      return makeFailure(i, `a character matching ${predicate}`)
    }
  })
}

Partser.index = Parser((input, i) => makeSuccess(i, i))

Partser.lcIndex = Parser((input, i) => {
  // Like the usual `index` function, but emitting an object that contains line
  // and column indices in addition to the character-based one.  Less
  // performant, but often convenient.

  const lines = input.slice(0, i).split('\n')

  // Note:  The character offset is 0-based; lines and columns are 1-based.
  const currentLine = lines.length
  const currentColumn = lines[lines.length - 1].length + 1

  return makeSuccess(i, {
    offset: i,
    line: currentLine,
    column: currentColumn
  })
})

//
// Specials
//

Partser.clone = (parser) => {
  assertParser('clone', parser)
  return Partser.custom(parser._)
}

Partser.replace = (original, replacement) => {
  assertParser('replace', original)
  assertParser('replace', replacement)
  original._ = replacement._
}

Partser.chain = (parser, lookup) => {
  assertParser('chain', parser)
  assertFunction('chain', lookup)
  return Parser((input, i, env) => {
    const result = parser._(input, i, env)
    if (!result.status) return result
    const nextParser = lookup(result.value, env)
    return nextParser._(input, result.index, env)
  })
}
