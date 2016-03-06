var test = require('tape')
var P = require('./index')

var string = P.string
var regex = P.regex
var all = P.all
var any = P.any
var eof = P.eof
var succeed = P.succeed
var fail = P.fail
var index = P.index
var custom = P.custom

var seq = P.seq
var alt = P.alt
var times = P.times
var desc = P.desc
var mark = P.mark
var map = P.map
var chain = P.chain

var replace = P.replace
var clone = P.clone

var parse = P.parse

var parseOk = function (t, parser, input, expectedValue) {
  t.deepEquals(parse(parser, input), {
    status: true,
    value: expectedValue
  })
}
var parseFail = function (t, parser, input, index, expected) {
  t.deepEquals(parse(parser, input), {
    status: false,
    index: index,
    expected: expected
  })
}

test('basic primitives work', function (t) {
  t.plan(9)
  parseOk(t, string('a'), 'a', 'a')
  parseOk(t, regex(/a+/), 'aa', 'aa')
  parseOk(t, all, 'aaa', 'aaa')
  parseOk(t, any, 'a', 'a')
  parseOk(t, any, 'b', 'b')
  parseOk(t, eof, '', null)
  parseOk(t, succeed('what'), '', 'what')
  parseFail(t, fail('what'), 'a', 0, ['what'])
  parseOk(t, index, '', 0)
})

test('custom', function (t) {
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

test('seq', function (t) {
  var s = string
  var abc = seq(s('a'), s('b'), s('c'))
  t.plan(2)
  parseOk(t, abc, 'abc', ['a', 'b', 'c'])
  parseFail(t, abc, 'cba', 0, ["'a'"])
})

test('alt', function (t) {
  var s = string
  var abc = alt(s('a'), s('b'), s('c'))
  t.plan(4)
  parseOk(t, abc, 'a', 'a')
  parseOk(t, abc, 'b', 'b')
  parseOk(t, abc, 'c', 'c')
  parseFail(t, abc, 'd', 0, ["'c'", "'b'", "'a'"])
})

test('times', function (t) {
  var notAtAll = times(string('a'), 0)
  var once = times(string('a'), 1)
  var maybeOnce = times(string('a'), 0, 1)
  var twice = times(string('a'), 2)
  var onceToThrice = times(string('a'), 1, 3)
  t.plan(15)

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
})

test('desc', function (t) {
  var a = desc(string('a'), 'first letter of the alphabet')
  t.plan(2)
  parseOk(t, a, 'a', 'a')
  parseFail(t, a, 'b', 0, ['first letter of the alphabet'])
})

test('mark', function (t) {
  var aMark = mark(regex(/a*/))
  t.plan(4)
  parseOk(t, aMark, '', { value: '', start: 0, end: 0 })
  parseOk(t, aMark, 'a', { value: 'a', start: 0, end: 1 })
  parseOk(t, aMark, 'aa', { value: 'aa', start: 0, end: 2 })
  parseFail(t, aMark, 'b', 0, ['EOF'])
})

test('map', function (t) {
  var abc = map(regex(/[abc]/), function (x) { return x.toUpperCase() })
  t.plan(4)
  parseOk(t, abc, 'a', 'A')
  parseOk(t, abc, 'b', 'B')
  parseOk(t, abc, 'c', 'C')
  parseFail(t, abc, 'd', 0, ['/[abc]/'])
})

test('replace', function (t) {
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
test('clone', function (t) {
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
