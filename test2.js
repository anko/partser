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
// var desc = P.desc
// var mark = P.mark
var map = P.map

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

test('map', function (t) {
  var abc = map(regex(/[abc]/), function (x) { return x.toUpperCase() })
  t.plan(4)
  parseOk(t, abc, 'a', 'A')
  parseOk(t, abc, 'b', 'B')
  parseOk(t, abc, 'c', 'C')
  parseFail(t, abc, 'd', 0, ['/[abc]/'])
})
