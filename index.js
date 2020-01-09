'use strict'
const Partser = {}

// For ensuring we have the right argument types
const assert = function (name, check) {
  return function (input) {
    if (!check(input)) throw new Error('Not a ' + name + ': ' + input)
  }
}
const assertParser = assert('parser', (x) => x._ && typeof x._ === 'function')
const assertNumber = assert('number', (x) => typeof x === 'number')
const assertRegexp = assert('regex', (x) => x instanceof RegExp)
const assertFunction = assert('function', (x) => typeof x === 'function')
const assertString = assert('string', (x) => typeof x === 'string')

const skip = function (parser, next) {
  return Partser.map(Partser.seq(parser, next), function (r) { return r[0] })
}

Partser.Parser = (function () {
  //
  // Base parser constructor
  //
  // The `_` property contains the actual implementation of the parser's
  // behaviour.  It can be changed with the `replace` combinator, to change
  // behaviour while keeping this parser's identity the same.
  //
  // Internally, we want the parser to succeed even if it didn't parse the full
  // input string, so we can continue with the next parser.  This is what the
  // base behaviour in `_` does.
  //
  // However, users would find this confusing; the expectation is for parsers
  // to fail unless they can match the whole input string!  Therefore, the
  // parser function itself actually parses for the base behaviour `_` followed
  // by `eof` (end of input).  Internally, we never use this surface API.
  //
  function Parser (behaviour) {
    // This is the external interface to any parser.
    const instance = function (stream, index, env) {
      index = index || 0

      return skip(instance, Partser.eof)._(stream, index, env)
    }
    instance._ = behaviour
    return instance
  }

  function makeSuccess (index, value) {
    return {
      status: true,
      index: index,
      value: value
    }
  }

  function makeFailure (index, expected) {
    return {
      status: false,
      index: index,
      value: [expected]
    }
  }

  const mergeReplies = (function () {
    function furthest (result) { return result.status ? -1 : result.index }
    function expected (result) { return result.status ? [] : result.value }

    return function (prev, next) {
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

  function formatExpected (expected) {
    if (expected.length === 1) return expected[0]

    return 'one of ' + expected.join(', ')
  }

  function formatGot (stream, error) {
    const i = error.index

    if (i === stream.length) return ', got the end of the stream'

    const prefix = (i > 0 ? "'..." : "'")
    const suffix = (stream.length - i > 12 ? "...'" : "'")

    return ' at character ' + i + ', got ' + prefix + stream.slice(i, i + 12) + suffix
  }

  Partser.formatError = function (stream, error) {
    return 'expected ' + formatExpected(error.value) + formatGot(stream, error)
  }

  Partser.except = function (allowed, forbidden) {
    assertParser(allowed)
    assertParser(forbidden)
    return Parser(function (stream, i, env) {
      const forbiddenResult = forbidden._(stream, i, env)
      if (forbiddenResult.status) {
        return makeFailure(i, "something that is not '" +
            forbiddenResult.value + "'")
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
        if (allowedResult.status) {
          return allowedResult
        } else {
          return makeFailure(i, formatExpected(allowedResult.value) +
              ' (except ' + formatExpected(forbiddenResult.value) + ')')
        }
      }
    })
  }

  // deriveEnv is a user-provided function that creates a new environment based
  // on the existing one.
  Partser.subEnv = function (baseParser, deriveEnv) {
    assertFunction(deriveEnv)
    return Parser(function (stream, i, env) {
      const newEnv = deriveEnv(env)
      return baseParser._(stream, i, newEnv)
    })
  }

  Partser.fromEnv = function (lookup) {
    assertFunction(lookup)
    return Parser(function (stream, i, env) {
      const foundParser = lookup(env)
      return foundParser._(stream, i, env)
    })
  }

  const seq = Partser.seq = function () {
    const parsers = [].slice.call(arguments)
    const numParsers = parsers.length

    parsers.forEach(assertParser)

    return Parser(function (stream, i, env) {
      let result
      const accum = new Array(numParsers)

      for (let j = 0; j < numParsers; j += 1) {
        result = mergeReplies(parsers[j]._(stream, i, env), result)
        if (!result.status) return result
        accum[j] = result.value
        i = result.index
      }

      return mergeReplies(makeSuccess(i, accum), result)
    })
  }

  const seqMap = function () {
    const args = [].slice.call(arguments)
    const mapper = args.pop()
    return Partser.map(seq.apply(null, args), function (results) {
      return mapper.apply(null, results)
    })
  }

  Partser.custom = function (parsingFunction) {
    return Parser(parsingFunction)
  }

  Partser.alt = function () {
    const parsers = [].slice.call(arguments)
    const numParsers = parsers.length
    if (numParsers === 0) return fail('zero alternates')

    parsers.forEach(assertParser)

    return Parser(function (stream, i, env) {
      let result
      for (let j = 0; j < parsers.length; j += 1) {
        result = mergeReplies(parsers[j]._(stream, i, env), result)
        if (result.status) return result
      }
      return result
    })
  }

  Partser.times = function (parser, min, max) {
    if (max === undefined) max = min

    assertParser(parser)
    assertNumber(min)
    assertNumber(max)

    return Parser(function (stream, i, env) {
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

  Partser.map = function (parser, fn) {
    assertFunction(fn)

    return Parser(function (stream, i, env) {
      const result = parser._(stream, i, env)
      if (!result.status) return result
      return mergeReplies(makeSuccess(result.index, fn(result.value, env)), result)
    })
  }

  Partser.mark = function (parser) {
    return seqMap(index, parser, index, function (start, value, end) {
      return { start: start, value: value, end: end }
    })
  }

  Partser.lcMark = function (parser) {
    return seqMap(lcIndex, parser, lcIndex, function (start, value, end) {
      return { start: start, value: value, end: end }
    })
  }

  Partser.desc = function (parser, expected) {
    return Parser(function (stream, i, env) {
      const reply = parser._(stream, i, env)
      if (!reply.status) reply.value = [expected]
      return reply
    })
  }

  //
  // Primitives
  //

  Partser.string = function (str) {
    const len = str.length
    const expected = "'" + str + "'"

    assertString(str)

    return Parser(function (stream, i) {
      const head = stream.slice(i, i + len)

      if (head === str) {
        return makeSuccess(i + len, head)
      } else {
        return makeFailure(i, expected)
      }
    })
  }

  Partser.regex = function (re, group) {
    assertRegexp(re)
    if (group) assertNumber(group)

    const anchored = RegExp('^(?:' + re.source + ')', ('' + re).slice(('' + re).lastIndexOf('/') + 1))
    const expected = '' + re
    if (group == null) group = 0

    return Parser(function (stream, i) {
      const match = anchored.exec(stream.slice(i))

      if (match) {
        const fullMatch = match[0]
        const groupMatch = match[group]
        if (groupMatch != null) return makeSuccess(i + fullMatch.length, groupMatch)
      }

      return makeFailure(i, expected)
    })
  }

  Partser.succeed = function (value) {
    return Parser(function (stream, i) {
      return makeSuccess(i, value)
    })
  }

  const fail = Partser.fail = function (expected) {
    return Parser(function (stream, i) { return makeFailure(i, expected) })
  }

  Partser.any = Parser(function (stream, i) {
    if (i >= stream.length) return makeFailure(i, 'any character')

    return makeSuccess(i + 1, stream.charAt(i))
  })

  Partser.all = Parser(function (stream, i) {
    return makeSuccess(stream.length, stream.slice(i))
  })

  Partser.eof = Parser(function (stream, i) {
    if (i < stream.length) return makeFailure(i, 'EOF')

    return makeSuccess(i, null)
  })

  Partser.test = function (predicate) {
    assertFunction(predicate)

    return Parser(function (stream, i) {
      const char = stream.charAt(i)
      if (i < stream.length && predicate(char)) {
        return makeSuccess(i + 1, char)
      } else {
        return makeFailure(i, 'a character matching ' + predicate)
      }
    })
  }

  Partser.lazy = function (desc, f) {
    if (arguments.length < 2) {
      f = desc
      desc = undefined
    }

    let parser = Parser(function (stream, i) {
      parser._ = f()._
      return parser._(stream, i)
    })

    if (desc) parser = parser.desc(desc)

    return parser
  }

  const index = Partser.index = Parser(function (stream, i) {
    return makeSuccess(i, i)
  })

  const lcIndex = Partser.lcIndex = Parser(function (stream, i) {
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

  Partser.clone = function (parser) {
    return Partser.custom(parser._)
  }

  Partser.replace = function (original, replacement) {
    assertParser(original)
    assertParser(replacement)
    original._ = replacement._
  }

  Partser.chain = function (parser, f) {
    assertParser(parser)
    return Parser(function (stream, i, env) {
      const result = parser._(stream, i, env)
      if (!result.status) return result
      const nextParser = f(result.value, env)
      return mergeReplies(nextParser._(stream, result.index, env), result)
    })
  }

  return Parser
})()
module.exports = Partser
