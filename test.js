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

tape('basic primitives work', function (t) {
  t.plan(12)
  parseOk(t, string('a'), 'a', 'a')
  parseOk(t, regex(/a+/), 'aa', 'aa')
  parseOk(t, regex(/(a+)b/, 1), 'aab', 'aa')
  parseOk(t, all, 'aaa', 'aaa')
  parseOk(t, any, 'a', 'a')
  parseOk(t, any, 'b', 'b')
  parseOk(t, test(function (x) { return x === 'a' }), 'a', 'a')
  parseOk(t, eof, '', null)
  parseOk(t, succeed('what'), '', 'what')
  parseFail(t, fail('what'), 'a', 0, ['what'])
  parseOk(t, index, '', 0)
  parseOk(t, lcIndex, '', { line: 1, column: 1, offset: 0 })
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
  t.plan(4)
  parseOk(t, customAny, 'a', 'a')
  parseOk(t, customAny, 'b', 'b')
  parseFail(t, customAny, '', 0, ['any character'])
  parseOk(t, map(customAny, function (x) { return x.toUpperCase() }),
      'a', 'A')
})

tape('except', function (t) {
  t.plan(3)
  var forbidden = regex(/[abc]/)
  var okChars = except(any, forbidden)
  parseFail(t, okChars, 'b', 0, ["something that is not 'b'"])
  parseFail(t, okChars, '', 0, ['any character (except /[abc]/)'])
  parseOk(t, okChars, 'x', 'x')
})
tape('seq', function (t) {
  var s = string
  var abc = seq(s('a'), s('b'), s('c'))
  t.plan(2)
  parseOk(t, abc, 'abc', ['a', 'b', 'c'])
  parseFail(t, abc, 'cba', 0, ["'a'"])
})

tape('alt', function (t) {
  var s = string
  var abc = alt(s('a'), s('b'), s('c'))
  t.plan(4)
  parseOk(t, abc, 'a', 'a')
  parseOk(t, abc, 'b', 'b')
  parseOk(t, abc, 'c', 'c')
  parseFail(t, abc, 'd', 0, ["'c'", "'b'", "'a'"])
})

tape('times', function (t) {
  var notAtAll = times(string('a'), 0)
  var once = times(string('a'), 1)
  var maybeOnce = times(string('a'), 0, 1)
  var twice = times(string('a'), 2)
  var onceToThrice = times(string('a'), 1, 3)
  var asManyAsYouLike = times(string('a'), 0, Infinity)
  t.plan(17)

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
})

tape('desc', function (t) {
  var a = desc(string('a'), 'first letter of the alphabet')
  t.plan(2)
  parseOk(t, a, 'a', 'a')
  parseFail(t, a, 'b', 0, ['first letter of the alphabet'])
})

tape('mark', function (t) {
  var aMark = mark(regex(/a*/))
  t.plan(4)
  parseOk(t, aMark, '', { value: '', start: 0, end: 0 })
  parseOk(t, aMark, 'a', { value: 'a', start: 0, end: 1 })
  parseOk(t, aMark, 'aa', { value: 'aa', start: 0, end: 2 })
  parseFail(t, aMark, 'b', 0, ['EOF'])
})

tape('map', function (t) {
  var abc = map(regex(/[abc]/), function (x) { return x.toUpperCase() })
  t.plan(4)
  parseOk(t, abc, 'a', 'A')
  parseOk(t, abc, 'b', 'B')
  parseOk(t, abc, 'c', 'C')
  parseFail(t, abc, 'd', 0, ['/[abc]/'])
})

tape('replace', function (t) {
  t.plan(7)
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
})

tape('replace with except', function (t) {
  t.plan(2)
  var a = string('a')
  var anyButA = except(any, a)
  replace(a, string('b'))
  parseOk(t, anyButA, 'a', 'a')
  parseFail(t, anyButA, 'b', 0, ["something that is not 'b'"])
})

tape('replace with alt', function (t) {
  t.plan(3)
  var a = fail('defined later')
  var b = string('b')
  var aOrB = alt(a, b)
  replace(a, map(string('c'), function () { return 'hi' }))
  parseOk(t, aOrB, 'b', 'b')
  parseOk(t, aOrB, 'c', 'hi')
  parseFail(t, aOrB, 'a', 0, ["'b'", "'c'"])
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

  t.plan(2)
  parseOk(t, expression, 'a', 'a')
  parseOk(t, expression, '()', [])
})

tape('clone', function (t) {
  var a = string('a')
  t.plan(9)

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

  t.plan(3)

  parseOk(t, list, '()', [ {v: []} ])
  parseOk(t, list, '()()', [ {v: []}, {v: []} ])
  parseOk(t, list, '(())', [ {v: [ {v: []} ]} ])
})

tape('formatError', function (t) {
  var a = string('a')
  var source = 'not a'
  var error = a(source)
  t.plan(1)
  t.equals(formatError(source, error),
      "expected 'a' at character 0, got 'not a'")
})
