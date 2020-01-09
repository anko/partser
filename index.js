'use strict'
const Partser = {}

// For ensuring we have the right argument types
const assert = (name, check) => {
  return (input) => {
    if (!check(input)) throw new Error(`Not a ${name}: ${input.toString()}`)
  }
}
const assertParser = assert('parser', (x) => x._ && typeof x._ === 'function')
const assertNumber = assert('number', (x) => typeof x === 'number')
const assertRegexp = assert('regex', (x) => x instanceof RegExp)
const assertFunction = assert('function', (x) => typeof x === 'function')
const assertString = assert('string', (x) => typeof x === 'string')

const skip = (parser, next) => {
  return Partser.map(Partser.seq(parser, next), ([x, _]) => x)
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
  const instance = (stream, env, index = 0) =>
    skip(instance, Partser.eof)._(stream, index, env)
  instance._ = behaviour
  return instance
}

const makeSuccess = (index, value) =>
  ({ status: true, index, value })

const makeFailure = (index, expected) =>
  ({ status: false, index, value: [expected] })

const mergeReplies = (() => {
  const furthest = (result) => result.status ? -1 : result.index
  const expected = (result) => result.status ? [] : result.value

  return (prev, next) => {
    if (!next || prev.status || furthest(prev) > furthest(next)) return prev
    else {
      // The `next` result is never a success, so we must be merging failures
      return {
        status: false,
        index: prev.index,
        value: (furthest(prev) === furthest(next))
          ? expected(prev).concat(expected(next))
          : expected(next)
      }
    }
  }
})()

const formatExpected = (expected) => {
  if (expected.length === 1) return expected[0]
  else return 'one of ' + expected.join(', ')
}

const formatGot = (stream, error) => {
  const i = error.index

  if (i === stream.length) return ', got the end of the stream'

  const prefix = (i > 0 ? "'..." : "'")
  const suffix = (stream.length - i > 12 ? "...'" : "'")

  return ' at character ' + i + ', got ' + prefix + stream.slice(i, i + 12) + suffix
}

Partser.formatError = (stream, error) =>
  'expected ' + formatExpected(error.value) + formatGot(stream, error)

Partser.except = (allowed, forbidden) => {
  assertParser(allowed)
  assertParser(forbidden)
  return Parser((stream, i, env) => {
    const forbiddenResult = forbidden._(stream, i, env)
    if (forbiddenResult.status) {
      return makeFailure(i, `something that is not '${forbiddenResult.value}'`)
      // This error text is relatively unhelpful, as it only says what was
      // *not* expected, but this is all we can do.  Parsers only return an
      // "expected" value when they fail, and this fail branch is only
      // triggered when the forbidden parser succeeds.  Moreover, a parser's
      // expected value is not constant: it changes as it consumes more
      // characters.
      //
      // Ensure that it's clear to users that they really should use `desc`
      // to give instances of this parser a clearer name.
    } else {
      const allowedResult = allowed._(stream, i, env)
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
  assertFunction(deriveEnv)
  return Parser((stream, i, env) => {
    const newEnv = deriveEnv(env)
    return baseParser._(stream, i, newEnv)
  })
}

Partser.from = (lookup) => {
  assertFunction(lookup)
  return Parser((stream, i, env) => {
    const foundParser = lookup(env)
    assertParser(foundParser)
    return foundParser._(stream, i, env)
  })
}

Partser.seq = (...parsers) => {
  parsers.forEach(assertParser)
  return Parser((stream, i, env) => {
    let result
    const accum = new Array(parsers.length)

    for (let j = 0; j < parsers.length; j += 1) {
      result = mergeReplies(parsers[j]._(stream, i, env), result)
      if (!result.status) return result
      accum[j] = result.value
      i = result.index
    }

    return mergeReplies(makeSuccess(i, accum), result)
  })
}

const seqMap = (...args) => {
  const mapper = args.pop()
  return Partser.map(
    Partser.seq(...args),
    (results) => mapper(...results))
}

Partser.custom = (parsingFunction) => {
  assertFunction(parsingFunction)
  return Parser(parsingFunction)
}

Partser.alt = (...parsers) => {
  if (parsers.length === 0) return Partser.fail('zero alternates')
  parsers.forEach(assertParser)

  return Parser((stream, i, env) => {
    let result
    for (let j = 0; j < parsers.length; j += 1) {
      result = mergeReplies(parsers[j]._(stream, i, env), result)
      if (result.status) return result
    }
    return result
  })
}

Partser.times = (parser, min, max) => {
  if (max === undefined) max = min

  assertParser(parser)
  assertNumber(min)
  assertNumber(max)

  return Parser((stream, i, env) => {
    const successes = []
    let times = 0
    let index = i
    let previousResult

    // First require successes until `min`.  In other words, return failure
    // if we mismatch before reaching `min` times.
    for (; times < min; ++times) {
      const result = parser._(stream, index, env)
      const mergedResult = mergeReplies(result, previousResult)
      if (result.status) {
        previousResult = mergedResult
        index = result.index
        successes.push(result.value)
      } else return mergedResult
    }

    // Then allow successes up until `max`.  In other words, just stop on
    // mismatch, and return a success with whatever we've got by then.
    for (; times < max; ++times) {
      const result = parser._(stream, index, env)
      const mergedResult = mergeReplies(result, previousResult)
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
  assertFunction(fn)

  return Parser((stream, i, env) => {
    const result = parser._(stream, i, env)
    if (!result.status) return result
    return mergeReplies(makeSuccess(result.index, fn(result.value, env)), result)
  })
}

Partser.mark = (parser) => {
  assertParser(parser)

  return seqMap(
    Partser.index, parser, Partser.index,
    (start, value, end) => ({ start, value, end }))
}

Partser.lcMark = (parser) => {
  assertParser(parser)

  return seqMap(
    Partser.lcIndex, parser, Partser.lcIndex,
    (start, value, end) => ({ start, value, end }))
}

Partser.desc = (parser, expected) => {
  assertParser(parser)
  assertString(expected)

  return Parser((stream, i, env) => {
    const reply = parser._(stream, i, env)
    if (!reply.status) reply.value = [expected]
    return reply
  })
}

Partser.string = (str) => {
  assertString(str)

  const len = str.length
  const expected = `'${str}'`

  return Parser((stream, i) => {
    const head = stream.slice(i, i + len)

    if (head === str) return makeSuccess(i + len, head)
    else return makeFailure(i, expected)
  })
}

Partser.regex = (re, group = 0) => {
  assertRegexp(re)
  assertNumber(group)

  const anchored = RegExp(
    `^(?:${re.source})`,
    `${re}`.slice(`${re}`.lastIndexOf('/') + 1))
  const expected = `${re}`

  return Parser((stream, i) => {
    const match = anchored.exec(stream.slice(i))

    if (match) {
      const fullMatch = match[0]
      const groupMatch = match[group]
      if (groupMatch != null) return makeSuccess(i + fullMatch.length, groupMatch)
    }

    return makeFailure(i, expected)
  })
}

Partser.succeed = (value) =>
  Parser((stream, i) => makeSuccess(i, value))

Partser.fail = (expected) => {
  assertString(expected)
  return Parser((stream, i) => makeFailure(i, expected))
}

Partser.any = Parser((stream, i) => {
  if (i >= stream.length) return makeFailure(i, 'any character')
  return makeSuccess(i + 1, stream.charAt(i))
})

Partser.all = Parser((stream, i) =>
  makeSuccess(stream.length, stream.slice(i)))

Partser.eof = Parser((stream, i) => {
  if (i < stream.length) return makeFailure(i, 'EOF')
  return makeSuccess(i, null)
})

Partser.test = (predicate) => {
  assertFunction(predicate)

  return Parser((stream, i, env) => {
    const char = stream.charAt(i)
    if (i < stream.length && predicate(char, env)) {
      return makeSuccess(i + 1, char)
    } else {
      return makeFailure(i, 'a character matching ' + predicate)
    }
  })
}

Partser.index = Parser((stream, i) => makeSuccess(i, i))

Partser.lcIndex = Parser((stream, i) => {
  // Like the usual `index` function, but emitting an object that contains
  // line and column indices in addition to the character-based one.

  const lines = stream.slice(0, i).split('\n')

  // Unlike the character offset, lines and columns are 1-based.
  const lineWeAreUpTo = lines.length
  const columnWeAreUpTo = lines[lines.length - 1].length + 1

  return makeSuccess(i, {
    offset: i,
    line: lineWeAreUpTo,
    column: columnWeAreUpTo
  })
})

//
// Specials
//

Partser.clone = (parser) => {
  assertParser(parser)
  return Partser.custom(parser._)
}

Partser.replace = (original, replacement) => {
  assertParser(original)
  assertParser(replacement)
  original._ = replacement._
}

Partser.chain = (parser, f) => {
  assertParser(parser)
  assertFunction(f)
  return Parser((stream, i, env) => {
    const result = parser._(stream, i, env)
    if (!result.status) return result
    const nextParser = f(result.value, env)
    return mergeReplies(nextParser._(stream, result.index, env), result)
  })
}

module.exports = Partser
