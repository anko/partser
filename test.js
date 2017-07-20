var p = require('./index')
var immutable = require('immutable')

// Wrap tape to automatically t.end(), since our tests are all synchronous.
var tape = function (name, testFunc) {
  var tapeModule = require('tape')
  tapeModule(name, function (t) {
    testFunc(t)
    t.end()
  })
}

// Helpers for checking whether a parse succeeded as expected.  Nice as
// adapters, in case the output format changes.
var parseOk = function (t, parser, input, expectedValue) {
  t.deepEquals(parser(input), {
    status: true,
    value: expectedValue,
    index: input.length
  })
}
var parseFail = function (t, parser, input, index, expected) {
  t.deepEquals(parser(input), {
    status: false,
    value: expected,
    index: index
  })
}

//
// Basics
//

tape('string', function (t) {
  parseOk(t, p.string('a'), 'a', 'a')
})
tape('regex', function (t) {
  parseOk(t, p.regex(/a+/), 'aa', 'aa')
  parseOk(t, p.regex(/(a+)b/, 1), 'aab', 'aa')
})
tape('all', function (t) {
  parseOk(t, p.all, 'aaa', 'aaa')
})
tape('any', function (t) {
  parseOk(t, p.any, 'a', 'a')
  parseOk(t, p.any, 'b', 'b')
})
tape('test', function (t) {
  parseOk(t, p.test(function (x) { return x === 'a' }), 'a', 'a')
})
tape('eof', function (t) {
  parseOk(t, p.eof, '', null)
})
tape('succeed', function (t) {
  parseOk(t, p.succeed('what'), '', 'what')
})
tape('fail', function (t) {
  parseFail(t, p.fail('what'), 'a', 0, ['what'])
})
tape('index', function (t) {
  parseOk(t, p.index, '', 0)
})
tape('lcIndex', function (t) {
  parseOk(t, p.lcIndex, '', { line: 1, column: 1, offset: 0 })
})
tape('custom `p.any` parser', function (t) {
  var customAny = p.custom(function (stream, i) {
    var remainingStream = stream.slice(i)
    if (remainingStream.length) {
      return { status: true, index: i + 1, value: stream.charAt(i) }
    } else {
      return { status: false, index: i, value: [ 'any character' ] }
    }
  })
  parseOk(t, customAny, 'a', 'a')
  parseOk(t, customAny, 'b', 'b')
  parseOk(t, p.seq(p.string('x'), customAny), 'xa', ['x', 'a'])
  parseFail(t, p.seq(p.string('x'), customAny), 'x', 1, ['any character'])
  parseFail(t, customAny, '', 0, ['any character'])
  parseOk(t, p.map(customAny, function (x) { return x.toUpperCase() }),
      'a', 'A')
})

tape('custom parser that just calls `p.any`', function (t) {
  var customAny = p.custom(function (stream, i) { return p.any(stream, i) })
  parseOk(t, customAny, 'a', 'a')
  parseOk(t, customAny, 'b', 'b')
  parseFail(t, p.seq(p.string('x'), customAny), 'x', 1, ['any character'])
  parseFail(t, customAny, '', 0, ['any character'])
  parseOk(t, p.map(customAny, function (x) { return x.toUpperCase() }),
      'a', 'A')
})

tape('custom-wrapping a recursive parser', function (t) {
  var listLater = p.fail('defined later')
  var list = p.map(
    p.seq(p.string('('),
      p.times(p.alt(listLater, p.string('x')), 0, Infinity),
      p.string(')')),
    function ([before, mid, after]) {
      return mid
    })

  var customWrappedList = p.custom(function (stream, i, env) {
    return list._(stream, i, env)
  })
  p.replace(listLater, customWrappedList)

  parseOk(t, list, '(x(x))', [ 'x', [ 'x' ] ])
})

tape('custom parsers can take whatever instead of strings', function (t) {
  // if you want them to!  You obviously can't expect this to work with the
  // built-in combinators though.

  var compiler = p.custom(function (environment, i) {
    var input = environment.sourceCode
    var reducer = environment.reducer

    var whitespace = p.regex(/\s*/)
    var lexeme = function (parser) {
      return p.map(p.seq(parser, whitespace), function (result) {
        return result[0]
      })
    }

    var numbers = p.map(
        p.times(lexeme(p.regex(/\d+/)), 0, Infinity),
        function (nums) { return nums.map(Number) })

    var result = numbers(input)
    return {
      status: result.status,
      index: result.index,
      value: result.value.reduce(reducer, 0)
    }
  })

  var input = {
    sourceCode: '1 2 3',
    reducer: function (a, b) { return a + b }
  }
  t.deepEquals(compiler(input), {
    status: true,
    value: 6,
    index: 5
  })
})

//
// Combinators
//

tape('except', function (t) {
  var forbidden = p.regex(/[abc]/)
  var okChars = p.except(p.any, forbidden)
  parseFail(t, okChars, 'b', 0, ["something that is not 'b'"])
  parseFail(t, okChars, '', 0, ['any character (except /[abc]/)'])
  parseOk(t, okChars, 'x', 'x')

  var needsEnv = p.map(p.string('a'), function (x, f) { return f(x) })

  // As success case
  ;(function () {
    var withEnv = p.except(needsEnv, p.string('b'))
    t.deepEquals(withEnv('a', 0, function (x) { return x.toUpperCase() }), {
      status: true,
      value: 'A',
      index: 1
    }, 'passes env for success case')
  })()

  // As failure case
  ;(function () {
    var withEnv = p.except(p.any, needsEnv)
    t.deepEquals(withEnv('a', 0, function (x) { return x.toUpperCase() }), {
      status: false,
      value: [ 'something that is not \'A\'' ],
      index: 0
    }, 'passes env for failure case')
  })()
})

tape('seq', function (t) {
  var s = p.string
  var abc = p.seq(s('a'), s('b'), s('c'))
  parseOk(t, abc, 'abc', ['a', 'b', 'c'])
  parseFail(t, abc, 'cba', 0, ["'a'"])

  var needsEnv = p.map(p.string('a'), function (x, f) { return f(x) })

  var withEnv = p.seq(p.any, needsEnv)
  t.deepEquals(withEnv('xa', 0, function (x) { return x.toUpperCase() }), {
    status: true,
    value: [ 'x', 'A' ],
    index: 2
  }, 'passes env')
})

tape('alt', function (t) {
  var s = p.string
  var abc = p.alt(s('a'), s('b'), s('c'))
  parseOk(t, abc, 'a', 'a')
  parseOk(t, abc, 'b', 'b')
  parseOk(t, abc, 'c', 'c')
  parseFail(t, abc, 'd', 0, ["'c'", "'b'", "'a'"])

  var needsEnv1 = p.map(p.string('a'), function (x, f) { return f(x) })
  var needsEnv2 = p.map(p.string('b'), function (x, f) { return f(x) })

  var withEnv = p.alt(needsEnv1, needsEnv2)
  t.deepEquals(withEnv('a', 0, function (x) { return x.toUpperCase() }), {
    status: true,
    value: 'A',
    index: 1
  }, 'passes env to first')
  t.deepEquals(withEnv('b', 0, function (x) { return x.toUpperCase() }), {
    status: true,
    value: 'B',
    index: 1
  }, 'passes env to subsequent')
})

tape('times', function (t) {
  var notAtAll = p.times(p.string('a'), 0)
  var once = p.times(p.string('a'), 1)
  var maybeOnce = p.times(p.string('a'), 0, 1)
  var twice = p.times(p.string('a'), 2)
  var onceToThrice = p.times(p.string('a'), 1, 3)
  var asManyAsYouLike = p.times(p.string('a'), 0, Infinity)

  parseOk(t, notAtAll, '', [])
  parseFail(t, notAtAll, 'a', 0, ['EOF'])

  parseOk(t, once, 'a', ['a'])
  parseFail(t, once, 'aa', 1, ['EOF'])

  parseOk(t, maybeOnce, '', [])
  parseOk(t, maybeOnce, 'a', ['a'])
  parseFail(t, maybeOnce, 'aa', 1, ['EOF'])

  parseOk(t, twice, 'aa', ['a', 'a'])
  parseFail(t, twice, 'a', 1, ["'a'"])
  parseFail(t, twice, 'aaa', 2, ['EOF'])

  parseFail(t, onceToThrice, '', 0, ["'a'"])
  parseOk(t, onceToThrice, 'a', ['a'])
  parseOk(t, onceToThrice, 'aa', ['a', 'a'])
  parseOk(t, onceToThrice, 'aaa', ['a', 'a', 'a'])
  parseFail(t, onceToThrice, 'aaaa', 3, ['EOF'])

  parseOk(t, asManyAsYouLike, '', [])
  parseOk(t, asManyAsYouLike, 'aaa', ['a', 'a', 'a'])

  var needsEnv = p.map(p.string('a'), function (x, f) { return f(x) })
  var withEnv = p.times(needsEnv, 0, Infinity)
  t.deepEquals(withEnv('aaaaa', 0, function (x) { return x.toUpperCase() }), {
    status: true,
    value: [ 'A', 'A', 'A', 'A', 'A' ],
    index: 5
  }, 'passes env to all')
})

tape('desc', function (t) {
  var a = p.desc(p.string('a'), 'first letter of the alphabet')
  parseOk(t, a, 'a', 'a')
  parseFail(t, a, 'b', 0, ['first letter of the alphabet'])

  var needsEnv = p.map(p.string('a'), function (x, f) { return f(x) })
  var withEnv = p.desc(needsEnv, 'the letter "a"')
  t.deepEquals(withEnv('a', 0, function (x) { return x.toUpperCase() }), {
    status: true,
    value: 'A',
    index: 1
  }, 'passes env')
})

tape('mark', function (t) {
  var aMark = p.mark(p.regex(/a*/))
  parseOk(t, aMark, '', { value: '', start: 0, end: 0 })
  parseOk(t, aMark, 'a', { value: 'a', start: 0, end: 1 })
  parseOk(t, aMark, 'aa', { value: 'aa', start: 0, end: 2 })
  parseFail(t, aMark, 'b', 0, ['EOF'])
})

tape('lcMark', function (t) {
  var aMark = p.lcMark(p.regex(/[a\n]*/))
  parseOk(t, aMark, '', {
    value: '',
    start: { offset: 0, line: 1, column: 1 },
    end: { offset: 0, line: 1, column: 1 }
  })
  parseOk(t, aMark, 'a', {
    value: 'a',
    start: { offset: 0, line: 1, column: 1 },
    end: { offset: 1, line: 1, column: 2 }
  })
  parseOk(t, aMark, 'a\na', {
    value: 'a\na',
    start: { offset: 0, line: 1, column: 1 },
    end: { offset: 3, line: 2, column: 2 }
  })
  parseFail(t, aMark, 'b', 0, ['EOF'])
})

tape('map', function (t) {
  var abc = p.map(p.regex(/[abc]/), function (x) { return x.toUpperCase() })
  parseOk(t, abc, 'a', 'A')
  parseOk(t, abc, 'b', 'B')
  parseOk(t, abc, 'c', 'C')
  parseFail(t, abc, 'd', 0, ['/[abc]/'])
  var withEnv = p.map(p.string('a'), function (x, f) { return f(x) })
  t.deepEquals(withEnv('a', 0, function (x) { return x.toUpperCase() }), {
    status: true,
    value: 'A',
    index: 1
  }, 'passes env')
})

tape('recursive parser with env stack corresponding to list nesting', function (t) {
  var between = function (parser, before, after) {
    return p.map(p.seq(before, parser, after), function (r) { return r[1] })
  }

  var changeEnv = function (parser, change) {
    return p.custom(function (stream, index, env) {
      return parser._(stream, index, change(env))
    })
  }

  var atom = p.map(
    p.string('a'),
    function (result, env) {
      return env.get('value')
    })

  var listLater = p.fail('implemented later')
  var expression = p.alt(
    listLater,
    atom)

  var listContent = p.times(expression, 0, Infinity)
  var list = changeEnv(
    between(listContent, p.string('('), p.string(')')),
    function (env) {
      return env.set('value', env.get('value') + 1)
    })
  p.replace(listLater, list)

  t.deepEquals(expression('a', 0, immutable.Map({ value: 0 })), {
    status: true,
    value: 0,
    index: 1
  }, 'env stack 0')
  t.deepEquals(expression('(a)', 0, immutable.Map({ value: 0 })), {
    status: true,
    value: [ 1 ],
    index: 3
  }, 'env stack 1')

  t.deepEquals(expression('(a(a))', 0, immutable.Map({ value: 0 })), {
    status: true,
    value: [ 1, [ 2 ] ],
    index: 6
  }, 'env stack 2')
})

tape('chain', function (t) {
  var a = p.regex(/[as]/)
  var weapon = p.chain(a, function (result) {
    switch (result) {
      case 'a' : return p.map(p.string('xe'), function (x) { return result + x })
      case 's' : return p.map(p.string('pear'), function (x) { return result + x })
    }
  })
  parseOk(t, weapon, 'axe', 'axe')
  parseOk(t, weapon, 'spear', 'spear')
  var withEnv = p.map(
      p.chain(p.string('a'), function (result, env) { return env.chain() }),
        function (x, env) { return env.after(x) })
  t.deepEquals(withEnv('ab', 0, {
    chain: function () { return p.string('b') },
    after: function (x) { return x.toUpperCase() }
  }), {
    status: true,
    value: 'B',
    index: 2
  }, 'passes env')
})

//
// p.replace & co
//

tape('replace', function (t) {
  // Replacement changes the logic of one parser to the that of another.
  var a = p.string('a')
  var b = p.string('b')
  p.replace(a, b)
  parseOk(t, a, 'b', 'b')

  // This doesn't change the replaced parser's identity, so its behaviour just
  // changes in-place wherever it's been used otherwise.
  a = p.string('a')
  b = p.string('b')
  var many = p.times(a, 1, Infinity)
  p.replace(a, b)
  parseOk(t, many, 'bb', ['b', 'b'])

  // A `p.replace` is one-off: the replacement is by value, not reference.  This
  // means replacing A with B and later replacing B with C, means A's logic is
  // still from what B was then, not what it changed to become.
  a = p.string('a')
  b = p.string('b')
  p.replace(a, b)
  p.replace(b, p.string('c'))
  parseOk(t, a, 'b', 'b')

  // This also works with `p.chain`, which dynamically chooses which parser to go
  // with next, based on the result of the previous.
  a = p.string('a')
  b = p.string('b')
  var acbd = p.chain(p.alt(a, b), function (result) {
    if (result.match(/a+/)) {
      return p.string('c')
    } else {
      return p.string('d')
    }
  })
  parseOk(t, acbd, 'ac', 'c')
  parseOk(t, acbd, 'bd', 'd')
  p.replace(a, p.regex(/a+/))
  parseOk(t, acbd, 'aaac', 'c')
  parseFail(t, acbd, 'aaad', 3, ["'c'"])
})

tape('replace with except', function (t) {
  var a = p.string('a')
  var anyButA = p.except(p.any, a)
  p.replace(a, p.string('b'))
  parseOk(t, anyButA, 'a', 'a')
  parseFail(t, anyButA, 'b', 0, ["something that is not 'b'"])
})

tape('replace with p.alt', function (t) {
  var a = p.fail('defined later')
  var b = p.string('b')
  var aOrB = p.alt(a, b)
  p.replace(a, p.map(p.string('c'), function () { return 'hi' }))
  parseOk(t, aOrB, 'b', 'b')
  parseOk(t, aOrB, 'c', 'hi')
  parseFail(t, aOrB, 'a', 0, ["'b'", "'c'"])
})

tape('replace with p.alt', function (t) {
  var listParserLater = p.fail('implemented later')
  var expression = p.alt(
    listParserLater,
    p.string('a'))

  var between = function (parser, before, after) {
    return p.map(p.seq(before, parser, after), function (r) { return r[1] })
  }

  var listOpener = p.string('(')
  var listTerminator = p.string(')')

  var listContent = p.desc(p.times(expression, 0, Infinity), 'list content')
  var list = between(listContent, listOpener, listTerminator)
  p.replace(listParserLater, list)

  parseOk(t, expression, 'a', 'a')
  parseOk(t, expression, '()', [])
})

tape('clone', function (t) {
  var a = p.string('a')

  // Cloning an object creates a parser which has a separate identity but the
  // same parsing behaviour.
  t.equal(a, a)
  t.notEqual(a, p.clone(a))
  parseOk(t, a, 'a', 'a')
  parseOk(t, p.clone(a), 'a', 'a')
  // This means you can modify the p.clone, e.g. by replacing it's logic, without
  // affecting the original.
  var b = p.clone(a)
  p.replace(b, p.string('b'))
  parseOk(t, b, 'b', 'b') // p.clone logic altered
  parseOk(t, a, 'a', 'a') // original still the same

  // Cloning does not preserve object properties.
  a = p.string('a')
  a.hi = 'hello'
  t.notOk(p.clone('a').hi)

  // Without cloning the `a` here, one of the branches of the p.alt would refer
  // to the p.alt itself (since that's what `a` is replaced with and cause an
  // infinite loop when called.
  a = p.string('a')
  p.replace(a, p.alt(p.clone(a), p.string('b')))
  parseOk(t, a, 'a', 'a')
  parseOk(t, a, 'b', 'b')
})

tape('self-reference', function (t) {
  var parenOpen = p.string('(')
  var parenClose = p.string(')')
  var list = p.fail('defined later')
  p.replace(list,
      p.times(p.map(
          p.seq(parenOpen, list, parenClose),
          function (x) { return { v: x[1] } }),
        0, Infinity))

  parseOk(t, list, '()', [ {v: []} ])
  parseOk(t, list, '()()', [ {v: []}, {v: []} ])
  parseOk(t, list, '(())', [ {v: [ {v: []} ]} ])
})

tape('formatError', function (t) {
  var a = p.string('a')
  var source = 'not a'
  var error = a(source)
  t.equals(p.formatError(source, error),
      "expected 'a' at character 0, got 'not a'")
})
