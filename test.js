'use strict'

const p = require('./index')
const tape = require('tape')
const { spawnSync } = require('child_process')
const colour = require('ansi-colors')

// Helpers for checking whether a parse succeeded as expected.  Nice as
// adapters, in case the output format changes.
const parseOk = (t, parser, input, expectedValue) => {
  t.deepEquals(parser(input), {
    status: true,
    value: expectedValue,
    index: input.length
  })
}
const parseFail = (t, parser, input, index, expected) => {
  t.deepEquals(parser(input), {
    status: false,
    value: expected,
    index: index
  })
}

//
// Basics
//

tape('isParser', (t) => {
  t.ok(p.isParser(p.string('a')))
  t.end()
})
tape('Object.keys is unpolluted', (t) => {
  t.deepEquals(Object.keys(p.string('a')), ['behaviour', 'displayName', '_'])
  t.end()
})

tape('string', (t) => {
  parseOk(t, p.string('a'), 'a', 'a')
  t.end()
})
tape('regex', (t) => {
  parseOk(t, p.regex(/a+/), 'aa', 'aa')
  parseOk(t, p.regex(/(a+)b/, 1), 'aab', 'aa')
  t.end()
})
tape('all', (t) => {
  parseOk(t, p.all, 'aaa', 'aaa')
  t.end()
})
tape('any', (t) => {
  parseOk(t, p.any, 'a', 'a')
  parseOk(t, p.any, 'b', 'b')
  t.end()
})
tape('test', (t) => {
  parseOk(t, p.test((x) => x === 'a'), 'a', 'a')
  parseFail(t, p.test((x) => x === 'a'), 'b', 0,
    ['a character matching (x) => x === \'a\''])

  const usesEnv = p.test((x, { whatCharacter }) => x === whatCharacter)
  t.deepEquals(
    usesEnv('x', { whatCharacter: 'x' }),
    {
      status: true,
      value: 'x',
      index: 1
    }, 'also passes environment to test function')
  t.end()
})
tape('eof', (t) => {
  parseOk(t, p.eof, '', null)
  t.end()
})
tape('succeed', (t) => {
  parseOk(t, p.succeed('what'), '', 'what')
  t.end()
})
tape('fail', (t) => {
  parseFail(t, p.fail('what'), 'a', 0, ['what'])
  t.end()
})
tape('index', (t) => {
  parseOk(t, p.index, '', 0)
  t.end()
})
tape('lcIndex', (t) => {
  parseOk(t, p.lcIndex, '', { line: 1, column: 1, offset: 0 })
  t.end()
})
tape('custom `p.any` parser', (t) => {
  const customAny = p.custom((stream, i) => {
    const remainingStream = stream.slice(i)
    if (remainingStream.length) {
      return { status: true, index: i + 1, value: stream.charAt(i) }
    } else {
      return { status: false, index: i, value: ['any character'] }
    }
  })
  parseOk(t, customAny, 'a', 'a')
  parseOk(t, customAny, 'b', 'b')
  parseOk(t, p.seq(p.string('x'), customAny), 'xa', ['x', 'a'])
  parseFail(t, p.seq(p.string('x'), customAny), 'x', 1, ['any character'])
  parseFail(t, customAny, '', 0, ['any character'])
  parseOk(t, p.map(customAny, x => x.toUpperCase()),
    'a', 'A')
  t.end()
})

tape('custom parser that just calls `p.any`', (t) => {
  const customAny = p.custom((...args) => p.any._(...args))
  parseOk(t, customAny, 'a', 'a')
  parseOk(t, customAny, 'b', 'b')
  parseFail(t, p.seq(p.string('x'), customAny), 'x', 1, ['any character'])
  parseFail(t, customAny, '', 0, ['any character'])
  parseOk(t, p.map(customAny, x => x.toUpperCase()),
    'a', 'A')
  t.end()
})

tape('from: can be used to implement a recursive parser', (t) => {
  const list = p.from(() =>
    p.map(
      p.seq(
        p.string('('),
        p.times(p.alt(list, p.string('x')), 0, Infinity),
        p.string(')')),
      ([before, mid, after]) => mid
    )
  )

  parseOk(t, list, '(x(x))', ['x', ['x']])
  t.end()
})

tape('p.from gives useful error if resolved value is not function', (t) => {
  t.throws(() => {
    p.from(() => { return null })('asd')
  }, /Partser.from\(\(\) => \{ return null \}\): Not a parser: \[object Null\]/)

  t.throws(() => {
    const lookupFunction = () => { return null }
    lookupFunction.toString = () => 'custom toString'
    p.from(lookupFunction)('asd')
  }, /Partser.from\(custom toString\): Not a parser: \[object Null\]/)
  t.end()
})

tape('custom parsers can take whatever instead of strings', (t) => {
  // if you want them to!  You obviously can't expect this to work with the
  // built-in combinators though.

  const compiler = p.custom((environment, i) => {
    const input = environment.sourceCode
    const reducer = environment.reducer

    const whitespace = p.regex(/\s*/)
    const lexeme = (parser) => {
      return p.map(p.seq(parser, whitespace), ([x, _]) => x)
    }

    const numbers = p.map(
      p.times(lexeme(p.regex(/\d+/)), 0, Infinity),
      nums => nums.map(Number))

    const result = numbers(input)
    return {
      status: result.status,
      index: result.index,
      value: result.value.reduce(reducer, 0)
    }
  })

  const input = {
    sourceCode: '1 2 3',
    reducer: (a, b) => a + b
  }
  t.deepEquals(compiler(input), {
    status: true,
    value: 6,
    index: 5
  })
  t.end()
})

//
// Combinators
//

tape('except', (t) => {
  const forbidden = p.regex(/[abc]/)
  const okChars = p.except(p.any, forbidden)
  parseFail(t, okChars, 'b', 0, ["something that is not 'b'"])
  parseFail(t, okChars, '', 0, ['any character (except /[abc]/)'])
  parseOk(t, okChars, 'x', 'x')

  const needsEnv = p.map(p.string('a'), (x, f) => f(x))

  // As success case
  ;(() => {
    const withEnv = p.except(needsEnv, p.string('b'))
    t.deepEquals(withEnv('a', x => x.toUpperCase()), {
      status: true,
      value: 'A',
      index: 1
    }, 'passes env for success case')
  })()

  // As failure case
  ;(() => {
    const withEnv = p.except(p.any, needsEnv)
    t.deepEquals(withEnv('a', x => x.toUpperCase()), {
      status: false,
      value: ['something that is not \'A\''],
      index: 0
    }, 'passes env for failure case')
  })()
  t.end()
})

tape('seq', (t) => {
  const needsEnv = p.map(p.string('a'), (x, f) => f(x))
  const withEnv = p.seq(p.any, needsEnv)
  t.deepEquals(withEnv('xa', x => x.toUpperCase()), {
    status: true,
    value: ['x', 'A'],
    index: 2
  }, 'passes env')
  t.end()
})

tape('seq with multiple empty parsers', (t) => {
  const parser = p.seq(p.succeed('a'), p.succeed('b'))
  t.deepEquals(parser(''), {
    status: true,
    value: ['a', 'b'],
    index: 0
  })
  t.end()
})

tape('subEnv can be modification of existing env', (t) => {
  const needsEnv = p.map(p.string('a'), (x, env) => env)
  const withEnv = p.subEnv(needsEnv, x => x + 'world')
  t.deepEquals(withEnv('a', 'Hello, '), {
    status: true,
    value: 'Hello, world',
    index: 1
  }, 'passes env')
  t.end()
})

tape('subEnv goes out of scope after', (t) => {
  const needsEnv = p.map(p.string('a'), (x, env) => env)
  const withEnv = p.subEnv(needsEnv, (x) => { return x + 'world' })
  const sequence = p.seq(withEnv, p.map(p.string('x'), (x, env) => env))
  t.deepEquals(sequence('ax', 'Hello, '), {
    status: true,
    value: ['Hello, world', 'Hello, '],
    index: 2
  }, 'passes env')
  t.end()
})

tape('subEnv environments can be modified by map', (t) => {
  const needsEnv = p.map(p.string('a'), (x, env) => {
    env.ADDITION = true
    env.previous.ADDITION = true
    return env
  })
  const withEnv = p.subEnv(needsEnv, (x) => { return { previous: x } })
  const sequence = p.seq(withEnv, p.map(p.string('x'), (x, env) => { return env }))
  t.deepEquals(sequence('ax', {}), {
    status: true,
    value: [
      {
        previous: { ADDITION: true },
        ADDITION: true
      },
      {
        ADDITION: true
      }
    ],
    index: 2
  }, 'passes env')
  t.end()
})

tape('from: can get parser from environment', (t) => {
  const lookup = (name) => {
    return (env) => {
      if (!env) return null
      if (env[name]) return env[name]
      else {
        if (env.previous) return lookup(env.previous, name)
        else return null
      }
    }
  }

  // Sequence of 2 parsers that load what parser to use from the whatLetter
  // property of the environment.  The first one is wrapped in a subEnv that
  // overrides the whatLetter parser to something else.  The override is only
  // in effect for the first one.
  const sequence = p.seq(
    p.subEnv(
      p.from(lookup('whatLetter')),
      (env) => ({ previous: env, whatLetter: p.string('!') })),
    p.from(lookup('whatLetter')))

  t.deepEquals(sequence('a', { whatLetter: p.string('a') }), {
    status: false,
    value: ["'!'"],
    index: 0
  }, 'the originally specified parser has been overridden')

  t.deepEquals(sequence('!a', { whatLetter: p.string('a') }), {
    status: true,
    value: ['!', 'a'],
    index: 2
  }, 'reads using whatever parser the env contained')
  t.end()
})

tape('alt', (t) => {
  const s = p.string
  const abc = p.alt(s('a'), s('b'), s('c'))
  parseOk(t, abc, 'a', 'a')
  parseOk(t, abc, 'b', 'b')
  parseOk(t, abc, 'c', 'c')
  parseFail(t, abc, 'd', 0, ["'c'", "'b'", "'a'"])

  const needsEnv1 = p.map(p.string('a'), (x, f) => f(x))
  const needsEnv2 = p.map(p.string('b'), (x, f) => f(x))

  const withEnv = p.alt(needsEnv1, needsEnv2)
  t.deepEquals(withEnv('a', x => x.toUpperCase()), {
    status: true,
    value: 'A',
    index: 1
  }, 'passes env to first')
  t.deepEquals(withEnv('b', x => x.toUpperCase()), {
    status: true,
    value: 'B',
    index: 1
  }, 'passes env to subsequent')

  t.throws(() => { p.alt() }, TypeError)
  t.end()
})

tape('times', (t) => {
  const notAtAll = p.times(p.string('a'), 0)
  const once = p.times(p.string('a'), 1)
  const maybeOnce = p.times(p.string('a'), 0, 1)
  const twice = p.times(p.string('a'), 2)
  const onceToThrice = p.times(p.string('a'), 1, 3)
  const asManyAsYouLike = p.times(p.string('a'), 0, Infinity)

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

  const needsEnv = p.map(p.string('a'), (x, f) => f(x))
  const withEnv = p.times(needsEnv, 0, Infinity)
  t.deepEquals(withEnv('aaaaa', x => x.toUpperCase()), {
    status: true,
    value: ['A', 'A', 'A', 'A', 'A'],
    index: 5
  }, 'passes env to all')
  t.end()
})

tape('desc', (t) => {
  const a = p.desc(p.string('a'), 'first letter of the alphabet')
  parseOk(t, a, 'a', 'a')
  parseFail(t, a, 'b', 0, ['first letter of the alphabet'])

  const needsEnv = p.map(p.string('a'), (x, f) => f(x))
  const withEnv = p.desc(needsEnv, 'the letter "a"')
  t.deepEquals(withEnv('a', x => x.toUpperCase()), {
    status: true,
    value: 'A',
    index: 1
  }, 'passes env')

  // Presumably rare edge case, but real subtle if it happens: If a custom
  // parser uses its result value in some way, we want to ensure that `desc`
  // doesn't modify it.
  let returnedResult
  const customParser = p.custom((input, index, env) => {
    const result = {
      status: false,
      index,
      value: ['ORIGINAL']
    }
    // Save a reference to the result
    returnedResult = result
    return result
  })
  const wrappedCustom = p.desc(customParser, 'REPLACED')
  const replacedReturnedResult = wrappedCustom()
  t.deepEquals(replacedReturnedResult, {
    status: false,
    index: 0,
    value: ['REPLACED']
  })
  // Check that the original returned result object wasn't modified; the
  // replacement should be a copy.
  t.deepEquals(returnedResult, {
    status: false,
    index: 0,
    value: ['ORIGINAL']
  })
  t.end()
})

tape('mark', (t) => {
  const aMark = p.mark(p.regex(/a*/))
  parseOk(t, aMark, '', { value: '', start: 0, end: 0 })
  parseOk(t, aMark, 'a', { value: 'a', start: 0, end: 1 })
  parseOk(t, aMark, 'aa', { value: 'aa', start: 0, end: 2 })
  parseFail(t, aMark, 'b', 0, ['EOF'])
  t.end()
})

tape('lcMark', (t) => {
  const aMark = p.lcMark(p.regex(/[a\n]*/))
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

tape('map', (t) => {
  const abc = p.map(p.regex(/[abc]/), x => x.toUpperCase())
  parseOk(t, abc, 'a', 'A')
  parseOk(t, abc, 'b', 'B')
  parseOk(t, abc, 'c', 'C')
  parseFail(t, abc, 'd', 0, ['/[abc]/'])
  const withEnv = p.map(p.string('a'), (x, f) => f(x))
  t.deepEquals(withEnv('a', x => x.toUpperCase()), {
    status: true,
    value: 'A',
    index: 1
  }, 'passes env')
  t.end()
})

tape('recursive parser with env stack corresponding to list nesting', (t) => {
  const between = (parser, before, after) =>
    p.map(p.seq(before, parser, after), ([_, x]) => x)

  const atom = p.map(
    p.string('a'),
    (result, env) => env.value)

  const expression = p.from(() => p.alt(list, atom))

  const listContent = p.times(expression, 0, Infinity)
  const list = p.from(() =>
    p.subEnv(
      between(listContent, p.string('('), p.string(')')),
      (env) => ({ value: env.value + 1 }))
  )

  t.deepEquals(expression('a', { value: 0 }), {
    status: true,
    value: 0,
    index: 1
  }, 'env stack 0')
  t.deepEquals(expression('(a)', { value: 0 }), {
    status: true,
    value: [1],
    index: 3
  }, 'env stack 1')

  t.deepEquals(expression('(a(a))', { value: 0 }), {
    status: true,
    value: [1, [2]],
    index: 6
  }, 'env stack 2')
  t.end()
})

tape('chain', (t) => {
  const a = p.regex(/[as]/)
  const weapon = p.chain(a, (result) => {
    switch (result) {
      case 'a' : return p.map(p.string('xe'), x => result + x)
      case 's' : return p.map(p.string('pear'), x => result + x)
    }
  })
  parseOk(t, weapon, 'axe', 'axe')
  parseOk(t, weapon, 'spear', 'spear')
  parseFail(t, weapon, 'a', 1, ['\'xe\''])
  parseFail(t, weapon, '', 0, ['/[as]/'])
  const withEnv = p.map(
    p.chain(p.string('a'), (result, env) => env.chain()),
    (x, env) => env.after(x))
  t.deepEquals(withEnv('ab', {
    chain: () => p.string('b'),
    after: (x) => x.toUpperCase()
  }), {
    status: true,
    value: 'B',
    index: 2
  }, 'passes env')
  t.end()
})

//
// p.replace & co
//

tape('replace', (t) => {
  // Replacement changes the logic of one parser to the that of another.
  let a = p.string('a')
  let b = p.string('b')
  p.replace(a, b)
  parseOk(t, a, 'b', 'b')

  // This doesn't change the replaced parser's identity, so its behaviour just
  // changes in-place wherever it's been used otherwise.
  a = p.string('a')
  b = p.string('b')
  const many = p.times(a, 1, Infinity)
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
  const acbd = p.chain(p.alt(a, b), (result) => {
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
  t.end()
})

tape('replace with except', (t) => {
  const a = p.string('a')
  const anyButA = p.except(p.any, a)
  p.replace(a, p.string('b'))
  parseOk(t, anyButA, 'a', 'a')
  parseFail(t, anyButA, 'b', 0, ["something that is not 'b'"])
  t.end()
})

tape('replace with p.alt', (t) => {
  const a = p.fail('defined later')
  const b = p.string('b')
  const aOrB = p.alt(a, b)
  p.replace(a, p.map(p.string('c'), () => 'hi'))
  parseOk(t, aOrB, 'b', 'b')
  parseOk(t, aOrB, 'c', 'hi')
  parseFail(t, aOrB, 'a', 0, ["'b'", "'c'"])
  t.end()
})

tape('replace with p.alt', (t) => {
  const listParserLater = p.fail('implemented later')
  const expression = p.alt(
    listParserLater,
    p.string('a'))

  const between = (parser, before, after) =>
    p.map(p.seq(before, parser, after), ([_, x]) => x)

  const listOpener = p.string('(')
  const listTerminator = p.string(')')

  const listContent = p.desc(p.times(expression, 0, Infinity), 'list content')
  const list = between(listContent, listOpener, listTerminator)
  p.replace(listParserLater, list)

  parseOk(t, expression, 'a', 'a')
  parseOk(t, expression, '()', [])
  t.end()
})

tape('clone', (t) => {
  let a = p.string('a')

  // Cloning an object creates a parser which has a separate identity but the
  // same parsing behaviour and display name.
  t.equal(a, a)
  t.notEqual(a, p.clone(a))
  t.equal(a.displayName, p.clone(a).displayName)
  parseOk(t, a, 'a', 'a')
  parseOk(t, p.clone(a), 'a', 'a')
  // This means you can modify the p.clone, e.g. by replacing it's logic, without
  // affecting the original.
  const b = p.clone(a)
  p.replace(b, p.string('b'))
  parseOk(t, b, 'b', 'b') // p.clone logic altered
  parseOk(t, a, 'a', 'a') // original still the same

  // Cloning does not preserve object properties.
  a = p.string('a')
  a.hi = 'hello'
  t.throws(() => p.clone('a'))

  // Without cloning the `a` here, one of the branches of the p.alt would refer
  // to the p.alt itself (since that's what `a` is replaced with and cause an
  // infinite loop when called.
  a = p.string('a')
  p.replace(a, p.alt(p.clone(a), p.string('b')))
  parseOk(t, a, 'a', 'a')
  parseOk(t, a, 'b', 'b')
  t.end()
})

tape('self-reference', (t) => {
  const parenOpen = p.string('(')
  const parenClose = p.string(')')
  const list = p.fail('defined later')
  p.replace(list,
    p.times(p.map(
      p.seq(parenOpen, list, parenClose),
      ([_, x]) => ({ v: x })),
    0, Infinity))

  parseOk(t, list, '()', [{ v: [] }])
  parseOk(t, list, '()()', [{ v: [] }, { v: [] }])
  parseOk(t, list, '(())', [{ v: [{ v: [] }] }])
  t.end()
})

tape('formatError', (t) => {
  {
    const ab = p.alt(p.string('a'), p.string('b'))
    const source = 'x'
    const error = ab(source)
    t.equals(p.formatError(source, error),
      "expected one of 'b', 'a' at character 0, got 'x'")
  }
  {
    const ab = p.string('a')
    const source = ''
    const error = ab(source)
    t.equals(p.formatError(source, error),
      "expected 'a' at character 0, got end of input")
  }
  {
    const ab = p.string('!')
    const source = 'abcdefghijklmnopqrstuvwxyz'
    const error = ab(source)
    t.equals(p.formatError(source, error),
      "expected '!' at character 0, got 'abcdefghij...'")
  }
  t.end()
})

// To test debug functionality, we have to capture what's logged to the
// console.  For this, we have to spawn separate processes to run each test,
// and capture its stdout.

const run = (script, env) => {
  const scriptWithImport = `const p = require('.');\n${script}`
  return spawnSync('node',
    { input: scriptWithImport, encoding: 'utf-8', env })
}

tape('debug', (t) => {
  // First a basic test with colour
  {
    const { stdout } = run('p.debug(p.string(\'a\'))(\'a\')', { FORCE_COLOR: 1 })
    t.equals(stdout, [
      `${colour.inverse('a')} 1,1 ${colour.blue('string("a")')} ?`,
      `${colour.bgGreen('a')} 1,1 ${colour.blue('string("a")')} ${colour.green('OKAY')} ${colour.yellow('"a"')} (len 1)`,
      ''
    ].join('\n'))
  }
  // Testing highlighting of EOF (appears as highlighted blank space after the input
  {
    const { stdout, stderr } = run('p.debug(p.times(p.string(\'a\'), 0, Infinity))(\'a\')', { FORCE_COLOR: 1 })
    t.equals(stderr, '')
    t.equals(stdout, [
      `${colour.inverse('a')} 1,1 ${colour.blue('times(0,Infinity)')} ?`,
      `${colour.inverse('a')} ${colour.dim('· ')}1,1 ${colour.blue('string("a")')} ?`,
      `${colour.bgGreen('a')} ${colour.dim('· ')}1,1 ${colour.blue('string("a")')} ${colour.green('OKAY')} ${colour.yellow('"a"')} (len 1)`,
      `${colour.dim('a')}${colour.inverse(' ')}${colour.dim('· ')}1,2 ${colour.blue('string("a")')} ?`,
      `${colour.dim('a')}${colour.bgRed(' ')}${colour.dim('· ')}1,2 ${colour.blue('string("a")')} FAIL ["'a'"]`,
      `${colour.bgGreen('a')} 1,1 ${colour.blue('times(0,Infinity)')} ${colour.green('OKAY')} ${colour.yellow('"a"')} (len 1)`,
      ''
    ].join('\n'))
  }
  // Ideally we could somehow test with all the colour codes every time, but
  // it's really tedious to write down and maintain, and obscures the intended
  // format otherwise.
  {
    const { stdout, stderr } = run('p.debug(p.times(p.alt(p.string(\'a\'), p.string(\'b\')), 3))(\'abc\')')
    t.equals(stderr, '')
    t.equals(stdout, [
      'abc 1,1 times(3,3) ?',
      'abc · 1,1 alt(*2) ?',
      'abc · · 1,1 string("a") ?',
      'abc · · 1,1 string("a") OKAY "a" (len 1)',
      'abc · 1,1 alt(*2) OKAY "a" (len 1)',
      'abc · 1,2 alt(*2) ?',
      'abc · · 1,2 string("a") ?',
      'abc · · 1,2 string("a") FAIL ["\'a\'"]',
      'abc · · 1,2 string("b") ?',
      'abc · · 1,2 string("b") OKAY "b" (len 1)',
      'abc · 1,2 alt(*2) OKAY "b" (len 1)',
      'abc · 1,3 alt(*2) ?',
      'abc · · 1,3 string("a") ?',
      'abc · · 1,3 string("a") FAIL ["\'a\'"]',
      'abc · · 1,3 string("b") ?',
      'abc · · 1,3 string("b") FAIL ["\'b\'"]',
      'abc · 1,3 alt(*2) FAIL ["\'b\'","\'a\'"]',
      'abc 1,1 times(3,3) FAIL ["\'b\'","\'a\'"]',
      ''
    ].join('\n'))
  }
  // Test appropriate context trimming for long inputs
  {
    const { stdout } = run('p.debug(p.seq(p.regex(/\\w+/), p.string(\'!\')))(\'abcdefghijklmnop!\')')
    t.equals(stdout, [
      'abcdefghij 1,1 seq(*2) ?',
      'abcdefghij · 1,1 regex(/\\w+/, 0) ?',
      'abcdefghij · 1,1 regex(/\\w+/, 0) OKAY "abcdefghijklmnop" (len 16)',
      'hijklmnop! · 1,17 string("!") ?',
      'hijklmnop! · 1,17 string("!") OKAY "!" (len 1)',
      'abcdefghij 1,1 seq(*2) OKAY "abcdefghijklmnop!" (len 17)',
      ''
    ].join('\n'))
  }
  // Test clarifying replacements of control codes and whitespace characters
  {
    const { stdout, stderr } = run('p.debug(p.string("a"))(" \\n\\t\\0")')
    t.equals(stderr, '')
    t.equals(stdout, [
      '␣⏎↹␀ 1,1 string("a") ?',
      '␣⏎↹␀ 1,1 string("a") FAIL ["\'a\'"]',
      ''
    ].join('\n'))
  }
  t.end()
})

tape('debug handler', (t) => {
  const argsToArray = (x) => Array.prototype.slice.call(x)

  // Test custom debug handler arguments
  let enterArgs, exitArgs
  const handler = {
    enter: function () { enterArgs = argsToArray(arguments) },
    exit: function () { exitArgs = argsToArray(arguments) }
  }
  const parser = p.string('a')
  p.debug(parser, handler)('a', { envValue: 42 })
  t.deepEquals(enterArgs,
    [parser, 'a', 0, { envValue: 42 }])
  t.deepEquals(exitArgs,
    [parser, 'a', 0, { envValue: 42 },
      { status: true, index: 1, value: 'a' }])
  t.end()
})

tape('debug.makeHandler', (t) => {
  // Test that custom handlers can skip log entries and add extra info.  In
  // this case, we skip logs for the string parser, and print 2 lines of extra
  // data.
  //
  // Also, force 5 characters of context, padded with whitespace because the
  // input is shorter than 5.
  const { stdout, stderr } = run(`
    p.debug(
      p.times(p.string('a'), 0, Infinity),
      p.debug.makeHandler({
        context: 5,
        padIfShort: true,
        enter: (parser, input, offset, env) => {
          if (parser.displayName.startsWith('string')) { return false }
          return 'extra\\ndata'
        },
        exit: (parser, input, offset, env, result) => {
          if (parser.displayName.startsWith('string')) { return false }
          return 'extra\\ndata'
        }
      })
    )('aa')
  `)
  t.equals(stderr, '')
  t.equals(stdout, [
    'aa    1,1 times(0,Infinity) ?',
    'aa    extra',
    'aa    data',
    'aa    1,1 times(0,Infinity) OKAY "aa" (len 2)',
    'aa    extra',
    'aa    data',
    ''
  ].join('\n'))
  t.end()
})
