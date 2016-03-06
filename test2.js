var test = require('tape')
var P = require('./index')

var string = P.string
var regex = P.regex
var all = P.all
var eof = P.eof
var succeed = P.succeed
var fail = P.fail
var index = P.index

// var seq = P.seq
// var alt = P.alt
// var times = P.times
// var desc = P.desc
// var mark = P.mark

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

test('primitives work', function (t) {
  t.plan(7)
  parseOk(t, string('a'), 'a', 'a')
  parseOk(t, regex(/a+/), 'aa', 'aa')
  parseOk(t, all, 'aaa', 'aaa')
  parseOk(t, eof, '', null)
  parseOk(t, succeed('what'), '', 'what')
  parseFail(t, fail('what'), 'a', 0, ['what'])
  parseOk(t, index, '', 0)
})
