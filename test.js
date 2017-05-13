var tape = require('tape')
var P = require('./index')

var string = P.string
var regex = P.regex
var all = P.all
var any = P.any
var test = P.test
var eof = P.eof
var succeed = P.succeed
var fail = P.fail
var index = P.index
var lcIndex = P.lcIndex
var custom = P.custom

var except = P.except
var seq = P.seq
var alt = P.alt
var times = P.times
var desc = P.desc
var mark = P.mark
var lcMark = P.lcMark
var map = P.map
var chain = P.chain

var replace = P.replace
var clone = P.clone

var formatError = P.formatError

var parseOk = function (t, parser, input, expectedValue) {
  t.deepEquals(parser(input), {
    status: true,
    value: expectedValue
  })
}
var parseFail = function (t, parser, input, index, expected) {
  t.deepEquals(parser(input), {
    status: false,
    index: index,
    expected: expected
  })
}

tape('string', function (t) {
  parseOk(t, string('a'), 'a', 'a')
  t.end()
})
tape('regex', function (t) {
  parseOk(t, regex(/a+/), 'aa', 'aa')
  parseOk(t, regex(/(a+)b/, 1), 'aab', 'aa')
  t.end()
})
tape('all', function (t) {
  parseOk(t, all, 'aaa', 'aaa')
  t.end()
})
tape('any', function (t) {
  parseOk(t, any, 'a', 'a')
  parseOk(t, any, 'b', 'b')
  t.end()
})
tape('test', function (t) {
  parseOk(t, test(function (x) { return x === 'a' }), 'a', 'a')
  t.end()
})
tape('eof', function (t) {
  parseOk(t, eof, '', null)
  t.end()
})
tape('succeed', function (t) {
  parseOk(t, succeed('what'), '', 'what')
  t.end()
})
tape('fail', function (t) {
  parseFail(t, fail('what'), 'a', 0, ['what'])
  t.end()
})
tape('index', function (t) {
  parseOk(t, index, '', 0)
  t.end()
})
tape('lcIndex', function (t) {
  parseOk(t, lcIndex, '', { line: 1, column: 1, offset: 0 })
  t.end()
})

tape('custom', function (t) {
  var customAny = custom(function (success, failure) {
    return function (stream, i) {
      if (stream.length) {
        return success(i + 1, stream.charAt(i))
      } else {
        return failure(i, 'any character')
      }
    }
  })
  parseOk(t, customAny, 'a', 'a')
  parseOk(t, customAny, 'b', 'b')
  parseFail(t, customAny, '', 0, ['any character'])
  parseOk(t, map(customAny, function (x) { return x.toUpperCase() }),
      'a', 'A')
  t.end()
})

tape('except', function (t) {
  var forbidden = regex(/[abc]/)
  var okChars = except(any, forbidden)
  parseFail(t, okChars, 'b', 0, ["something that is not 'b'"])
  parseFail(t, okChars, '', 0, ['any character (except /[abc]/)'])
  parseOk(t, okChars, 'x', 'x')
  t.end()
})
tape('seq', function (t) {
  var s = string
  var abc = seq(s('a'), s('b'), s('c'))
  parseOk(t, abc, 'abc', ['a', 'b', 'c'])
  parseFail(t, abc, 'cba', 0, ["'a'"])
  t.end()
})

tape('alt', function (t) {
  var s = string
  var abc = alt(s('a'), s('b'), s('c'))
  parseOk(t, abc, 'a', 'a')
  parseOk(t, abc, 'b', 'b')
  parseOk(t, abc, 'c', 'c')
  parseFail(t, abc, 'd', 0, ["'c'", "'b'", "'a'"])
  t.end()
})

tape('times', function (t) {
  var notAtAll = times(string('a'), 0)
  var once = times(string('a'), 1)
  var maybeOnce = times(string('a'), 0, 1)
  var twice = times(string('a'), 2)
  var onceToThrice = times(string('a'), 1, 3)
  var asManyAsYouLike = times(string('a'), 0, Infinity)

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
  t.end()
})

tape('desc', function (t) {
  var a = desc(string('a'), 'first letter of the alphabet')
  parseOk(t, a, 'a', 'a')
  parseFail(t, a, 'b', 0, ['first letter of the alphabet'])
  t.end()
})

tape('mark', function (t) {
  var aMark = mark(regex(/a*/))
  parseOk(t, aMark, '', { value: '', start: 0, end: 0 })
  parseOk(t, aMark, 'a', { value: 'a', start: 0, end: 1 })
  parseOk(t, aMark, 'aa', { value: 'aa', start: 0, end: 2 })
  parseFail(t, aMark, 'b', 0, ['EOF'])
  t.end()
})

tape('lcMark', function (t) {
  var aMark = lcMark(regex(/[a\n]*/))
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
  t.end()
})

tape('map', function (t) {
  var abc = map(regex(/[abc]/), function (x) { return x.toUpperCase() })
  parseOk(t, abc, 'a', 'A')
  parseOk(t, abc, 'b', 'B')
  parseOk(t, abc, 'c', 'C')
  parseFail(t, abc, 'd', 0, ['/[abc]/'])
  t.end()
})

tape('chain', function (t) {
  var a = regex(/[as]/)
  var weapon = chain(a, function (result) {
    switch (result) {
      case 'a' : return map(string('xe'), function (x) { return result + x })
      case 's' : return map(string('pear'), function (x) { return result + x })
    }
  })
  parseOk(t, weapon, 'axe', 'axe')
  parseOk(t, weapon, 'spear', 'spear')
  t.end()
})

tape('replace', function (t) {
  // Replacement changes the logic of one parser to the that of another.
  var a = string('a')
  var b = string('b')
  replace(a, b)
  parseOk(t, a, 'b', 'b')

  // This doesn't change the replaced parser's identity, so its behaviour just
  // changes in-place wherever it's been used otherwise.
  a = string('a')
  b = string('b')
  var many = times(a, 1, Infinity)
  replace(a, b)
  parseOk(t, many, 'bb', ['b', 'b'])

  // A `replace` is one-off: the replacement is by value, not reference.  This
  // means replacing A with B and later replacing B with C, means A's logic is
  // still from what B was then, not what it changed to become.
  a = string('a')
  b = string('b')
  replace(a, b)
  replace(b, string('c'))
  parseOk(t, a, 'b', 'b')

  // This also works with `chain`, which dynamically chooses which parser to go
  // with next, based on the result of the previous.
  a = string('a')
  b = string('b')
  var acbd = chain(alt(a, b), function (result) {
    if (result.match(/a+/)) {
      return string('c')
    } else {
      return string('d')
    }
  })
  parseOk(t, acbd, 'ac', 'c')
  parseOk(t, acbd, 'bd', 'd')
  replace(a, regex(/a+/))
  parseOk(t, acbd, 'aaac', 'c')
  parseFail(t, acbd, 'aaad', 3, ["'c'"])
  t.end()
})

tape('replace with except', function (t) {
  var a = string('a')
  var anyButA = except(any, a)
  replace(a, string('b'))
  parseOk(t, anyButA, 'a', 'a')
  parseFail(t, anyButA, 'b', 0, ["something that is not 'b'"])
  t.end()
})

tape('replace with alt', function (t) {
  var a = fail('defined later')
  var b = string('b')
  var aOrB = alt(a, b)
  replace(a, map(string('c'), function () { return 'hi' }))
  parseOk(t, aOrB, 'b', 'b')
  parseOk(t, aOrB, 'c', 'hi')
  parseFail(t, aOrB, 'a', 0, ["'b'", "'c'"])
  t.end()
})

tape('replace with alt', function (t) {
  var listParserLater = fail('implemented later')
  var expression = alt(
    listParserLater,
    string('a'))

  var between = function (p, before, after) {
    return map(seq(before, p, after), function (r) { return r[1] })
  }

  var listOpener = string('(')
  var listTerminator = string(')')

  var listContent = desc(times(expression, 0, Infinity), 'list content')
  var list = between(listContent, listOpener, listTerminator)
  replace(listParserLater, list)

  parseOk(t, expression, 'a', 'a')
  parseOk(t, expression, '()', [])
  t.end()
})

tape('clone', function (t) {
  var a = string('a')

  // Cloning an object creates a parser which has a separate identity but the
  // same parsing behaviour.
  t.equal(a, a)
  t.notEqual(a, clone(a))
  parseOk(t, a, 'a', 'a')
  parseOk(t, clone(a), 'a', 'a')
  // This means you can modify the clone, e.g. by replacing it's logic, without
  // affecting the original.
  var b = clone(a)
  replace(b, string('b'))
  parseOk(t, b, 'b', 'b') // clone logic altered
  parseOk(t, a, 'a', 'a') // original still the same

  // Cloning does not preserve object properties.
  a = string('a')
  a.hi = 'hello'
  t.notOk(clone('a').hi)

  // Without cloning the `a` here, one of the branches of the alt would refer
  // to the alt itself (since that's what `a` is replaced with and cause an
  // infinite loop when called.
  a = string('a')
  replace(a, alt(clone(a), string('b')))
  parseOk(t, a, 'a', 'a')
  parseOk(t, a, 'b', 'b')
  t.end()
})

tape('self-reference', function (t) {
  var parenOpen = string('(')
  var parenClose = string(')')
  var list = fail('defined later')
  replace(list,
      times(map(
          seq(parenOpen, list, parenClose),
          function (x) { return { v: x[1] } }),
        0, Infinity))

  parseOk(t, list, '()', [ {v: []} ])
  parseOk(t, list, '()()', [ {v: []}, {v: []} ])
  parseOk(t, list, '(())', [ {v: [ {v: []} ]} ])
  t.end()
})

tape('formatError', function (t) {
  var a = string('a')
  var source = 'not a'
  var error = a(source)
  t.equals(formatError(source, error),
      "expected 'a' at character 0, got 'not a'")
  t.end()
})
