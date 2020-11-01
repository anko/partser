# partser [![](https://img.shields.io/npm/v/partser.svg?style=flat-square)](https://www.npmjs.com/package/partser) [![](https://img.shields.io/travis/anko/partser.svg?style=flat-square)](https://travis-ci.org/anko/partser) [![](https://img.shields.io/david/anko/partser.svg?style=flat-square)](https://david-dm.org/anko/partser) [![](https://img.shields.io/coveralls/github/anko/partser?style=flat-square)](https://coveralls.io/github/anko/partser)

A combinatory parsing library for JS, for writing LL(∞) parsers made of other
parsers.

It is *ridiculously flexible*: Your parsers can modify their parsing logic even
during parsing, by introducing, redefining, or modifying sub-parsers inside
nested scoped environments, even based on partial parse results.

## Example

Here's a demonstration of a string literal parser that reads the quote symbol
that it should use from the environment object passed by the caller:

<!-- !test program node test-readme-example.js -->

<!-- !test in motivating example -->

``` js
const p = require('partser')

// Let's parse a string!

// For fun, let's load the quote character from the parse environment.
const quote = p.from((env) => env.quoteParser)

// The string can contain any characters that aren't quotes.
const stringChar = p.except(p.any, quote)

// The contents of a string (the stuff between quotes) shall be many
// stringChars, joined together.
const stringContents = p.map(
  p.times(stringChar, 0, Infinity),
  (chars) => chars.join(''))

// A string is a quote, string contents, then another quote.
// We'll pick out just the content part, and return that.
const stringParser = p.map(
  p.seq([quote, stringContents, quote]),
  ([openingQuote, contents, closingQuote]) => contents)

// Now we can pass an environment object when calling the parser, to specify
// what quote character should be used.
console.log(stringParser('"hi"', { quoteParser: p.string('"') }))
console.log(stringParser('$hi$', { quoteParser: p.string('$') }))
console.log(stringParser('ohio', { quoteParser: p.string('o') }))
```

Output:

<!-- !test out motivating example -->

> ```
> { status: true, index: 4, value: 'hi' }
> { status: true, index: 4, value: 'hi' }
> { status: true, index: 4, value: 'hi' }
> ```

For sub-environments, see the [`p.subEnv` example
below](#psubenvparser-derivefunction).

## Usage

Partser gives you functions of a few different types:

 - [*primitive parsers*](#primitive-parsers) that consume strings and return
   tokens (e.g. `all` or `any`),
 - [*parser constructors*](#parser-constructors) that create new parsers based
   on arguments (e.g.  `string` or `regex`),
 - [*parser combinators*](#parser-combinators) that take parsers and produce
   new parsers that use them (e.g.  `seq`, `alt`, or `map`),
 - [*helper functions*](#helper-functions), for debugging, error-formatting,
   and other miscellaneous related tasks.

Together these can be used to express how to turn text into a data structure.

### Calling a parser

    parser(input [, environment [, offset]])

 - `input` (`String`): the string to parse from
 - `environment` (`(any type)`; *optional*): environment object passed to other
   parsers, and to user-defined functions such as in the `map` parser (default:
   `undefined`)
 - `offset` (`Number`; *optional*): integer character offset for where in
   `input` to start parsing (default: 0)

Returns:

—on success:

 - `status` (`Boolean`): `true`
 - `value`: the return value of the parse
 - `index` (`Number`): how many characters were consumed

 —on failure:

 - `status` (`Boolean`): `false`
 - `value` (`Array`): human-readable strings representing what input would have
   been acceptable instead
 - `index` (`Number`): the offset at which the parse encountered a dead end

### Primitive parsers

These parsers are already pre-defined for you:

#### `p.all`

Always succeeds, consuming all input and returning it.

<!-- !test in all -->

    const parser = p.all
    console.log(parser('ashldflasdhfl'))

<!-- !test out all -->

> ```
> { status: true, index: 13, value: 'ashldflasdhfl' }
> ```

#### `p.any`

Matches any 1 character and returns it.

<!-- !test in any -->

    const parser = p.any
    console.log(parser('a'))
    console.log(parser('b'))

<!-- !test out any -->

> ```
> { status: true, index: 1, value: 'a' }
> { status: true, index: 1, value: 'b' }
> ```

#### `p.eof`

Matches the end of input (only matches if no more characters are remaining) and
returns null.

<!-- !test in eof -->

    const parser = p.eof
    console.log(parser(''))

<!-- !test out eof -->

> ```
> { status: true, index: 0, value: null }
> ```

#### `p.index`

Always succeeds, without consuming any input.  Returns a 0-based integer
representing the offset into the input that has been consumed so far.

<!-- !test in index -->

    const parser = p.seq([
      p.string('hi'),
      p.index
    ])
    console.log(parser('hi'))

<!-- !test out index -->

> ```
> { status: true, index: 2, value: [ 'hi', 2 ] }
> ```

#### `p.lcIndex`

Always succeeds, without consuming any input.  Returns an object with integer
fields `line` (1-based), `column` (1-based) and character `offset` (0-based),
which represents how much input has been consumed so far.

This is a more verbose version of [`p.index`](#pindex).  For performance, use
that if you only need the character offset.

<!-- !test in lcIndex -->

    const parser = p.seq([
      p.string('hi'),
      p.lcIndex
    ])
    console.log(parser('hi'))

<!-- !test out lcIndex -->

> ```
> {
>   status: true,
>   index: 2,
>   value: [ 'hi', { offset: 2, line: 1, column: 3 } ]
> }
> ```

### Parser constructors

These functions let you construct your own parsers that match various things:

#### `p.succeed([value])`

Return:  Parser that always succeeds with `value` or undefined, without
consuming any input.

<!-- !test in succeed -->

    const parser = p.succeed('success!')
    console.log(parser(''))

<!-- !test out succeed -->

> ```
> { status: true, index: 0, value: 'success!' }
> ```

#### `p.fail([value])`

Return:  Parser that always fails with `value` or undefined, without consuming
any input.

<!-- !test in fail -->

    const parser = p.fail('failure!')
    console.log(parser(''))

<!-- !test out fail -->

> ```
> { status: false, index: 0, value: [ 'failure!' ] }
> ```

#### `p.string(value:String)`

Return:  Parser that matches that string and returns it.

<!-- !test in string -->

    const parser = p.string('Hello!')
    console.log(parser('Hello!'))

<!-- !test out string -->

> ```
> { status: true, index: 6, value: 'Hello!' }
> ```

#### `p.regex(regex:RegExp [, group:Number])`

Return:  Parser that matches the given `regex` and returns the given capturing `group` (default: 0).

<!-- !test in regex -->

    const parser = p.regex(/ok(ay)?/)
    console.log(parser('okay'))

<!-- !test out regex -->

> ```
> { status: true, index: 4, value: 'okay' }
> ```

#### `p.test(predicate:Function)`

Return:  Parser that consumes 1 `character`, calls `predicate(character, env)`.
Succeeds and returns `character` if `predicate` returns true.  Otherwise fails.

Nice for when you need to do math on character values, like checking Unicode
character ranges.

<!-- !test in text -->

    const parser = p.test((x) => x.charCodeAt(0) < 100)
    console.log(parser('0')) // character code 48
    console.log(parser('x')) // character code 120

<!-- !test out text -->

> ```
> { status: true, index: 1, value: '0' }
> {
>   status: false,
>   index: 0,
>   value: [ 'a character matching (x) => x.charCodeAt(0) < 100' ]
> }
> ```

#### `p.custom(implementation:Function)`

Return:  Parser that works according to the logic specified in the given
`implementation`.  The `implementation` should have the API demonstrated in the
below example.

This function wraps your custom parser functionality such that it works with
all other parsers and combinator functions.

<!-- !test in custom -->

    const otherParser = p.string('x')

    const parser = p.custom((input, index, env, debugHandler) => {
      // Put whatever logic you want here.

      // You don't have to call any methods in `debugHandler`.  It's done
      // automatically for you.  You should however pass it on when calling
      // other parsers, if you want `p.debug` to be able to display them.

      if (input[index] === 'a') {
        // If you want to call another parser, call its `_` property.  This
        // makes the parser succeed if it matches, even if it didn't consume
        // all of the input.
        const xResult = otherParser._(input, index + 1, env, debugHandler)
        if (xResult.status === false) return xResult

        return {
          status: true,
          index: xResult.index,
          value: { word: 'a' + xResult.value, greeting: env.hello }
        }
      } else {
        return {
          status: false,
          index,
          value: ['the letter a']
        }
      }
    })

    console.log(parser('b'))
    console.log(parser('a'))
    console.log(parser('ax', { hello: 'hi' }))

<!-- !test out custom -->

> ```
> { status: false, index: 0, value: [ 'the letter a' ] }
> { status: false, index: 1, value: [ "'x'" ] }
> { status: true, index: 2, value: { word: 'ax', greeting: 'hi' } }
> ```

### Parser combinators

These functions operate on parsers, acting as "wrappers" around them to modify
how they work.

#### `p.seq(parsers [, chainEnv])`

Return:  Parser that matches all of the given `parser`s in order, and returns
an Array of their results.

<!-- !test in seq -->

    const parser = p.seq([
      p.string('a'),
      p.regex(/[xyz]/)
    ])

    console.log(parser('ax'))

<!-- !test out seq -->

> ```
> { status: true, index: 2, value: [ 'a', 'x' ] }
> ```


The `chainEnv` argument can be passed a function to define how environments are
passed forward through a sequence of parsers.  [See guidance
below](#using-an-immutable-environment-object).

#### `p.alt(parsers)`

Returns a parser that matches any of the given `parsers`, and returns the
result of the first one that matched.

<!-- !test in alt -->

    const parser = p.alt([
      p.string('a'),
      p.string('b')])

    console.log(parser('b'))

<!-- !test out alt -->

> ```
> { status: true, index: 1, value: 'b' }
> ```

#### `p.times(parser, min:Number [, max:Number] [, chainEnv:Function])`

Returns a parser that matches the given `parser` at least `min`, and at most
`max` times, and returns an Array of the results.

If `max` is not given, `max = min`.

<!-- !test in times -->

    const parser = p.times(p.string('A'), 2, Infinity)

    console.log(parser('A'))
    console.log(parser('AA'))
    console.log(parser('AAAAA'))

<!-- !test out times -->

> ```
> { status: false, index: 1, value: [ "'A'" ] }
> { status: true, index: 2, value: [ 'A', 'A' ] }
> { status: true, index: 5, value: [ 'A', 'A', 'A', 'A', 'A' ] }
> ```

The `chainEnv` argument can be passed a function to define how environments are
passed forward through a sequence of parsers.  [See guidance
below](#using-an-immutable-environment-object).

#### `p.except(allowedParser, forbiddenParser)`

Returns a parser that matches what `allowedParser` matches, except if what it
matched would also match `forbiddenParser`.

<!-- !test in except -->

    const parser = p.except(p.regex(/[a-z]/), p.string('b'))

    console.log(parser('a'))
    console.log(parser('b'))
    console.log(parser('c'))

<!-- !test out except -->

> ```
> { status: true, index: 1, value: 'a' }
> { status: false, index: 0, value: [ "something that is not 'b'" ] }
> { status: true, index: 1, value: 'c' }
> ```

#### `p.desc(parser, description:String)`

Returns a parser that works exactly the same as `parser`, but always fails with
the `description` as its expected value.

Useful for making complex parsers show clearer error messages.

<!-- !test in desc -->

    const floatParser = p.map(
      p.seq([p.regex(/[0-9]+/), p.string('.'), p.regex(/[0-9]+/)]),
      ([left, dot, right]) => {
        return { left: Number(left), right: Number(right) }
      })
    const parser = p.desc(floatParser, 'a float constant')

    console.log(parser('3.2'))
    console.log(parser('1'))

<!-- !test out desc -->

> ```
> { status: true, index: 3, value: { left: 3, right: 2 } }
> { status: false, index: 1, value: [ 'a float constant' ] }
> ```

#### `p.mark(parser)`

Returns a parser that works exactly like `parser`, but when it succeeds, it
annotates the return `value` with the `start` and `end` offsets of where that
value was found.  The `value` becomes an Object with `{ value, start, end }`
instead.

Useful when you need to know not only that something matched, but *where* it
was matched, such as for generating a [source
map](https://github.com/mozilla/source-map).

<!-- !test in mark -->

    const parser = p.mark(p.string('abc'))

    console.log(parser('abc'))

<!-- !test out mark -->

> ```
> { status: true, index: 3, value: { start: 0, value: 'abc', end: 3 } }
> ```

#### `p.lcMark(parser)`

Like [`p.mark`](#pmarkparser), but also annotates the value with 1-based `line` and
`column` locations.

<!-- !test in lcMark -->

    const parser = p.lcMark(p.string('abc'))

    console.log(parser('abc'))

<!-- !test out lcMark -->

> ```
> {
>   status: true,
>   index: 3,
>   value: {
>     start: { offset: 0, line: 1, column: 1 },
>     value: 'abc',
>     end: { offset: 3, line: 1, column: 4 }
>   }
> }
> ```

#### `p.map(parser, transformer:Function)`

Returns a parser that works exactly like `parser`, but when it succeeds with a
`value`, it instead returns `transformer(value, env)`.

Analogous to
[`Array.prototype.map`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map).

<!-- !test in map -->

    const parser = p.map(p.regex(/[0-9]+/), (x) => 2 * Number(x))

    console.log(parser('21'))

<!-- !test out map -->

> ```
> { status: true, index: 2, value: 42 }
> ```

#### `p.chain(parser, decider:Function)`

Returns a parser that matches the given `parser` to get a `value`, then calls
`decider(value, env)` expecting it to return a parser.  Then matches and
returns *that parser* returned by `decider`.

:warning: *You almost certainly want [`p.from`](#pfromdecideparserfunction) instead.*  This is a classic
combinator possibly familiar to users of other parsing libraries.  I've
implemented it here mainly to reduce the cognitive load of porting parsers
between libraries.

<!-- !test in chain -->

    const parser = p.chain(p.regex(/[ax]/), (x) => {
      if (x === 'a') return p.string('bc')
      else return p.string('yz')
    })

    console.log(parser('abc'))
    console.log(parser('xyz'))
    console.log(parser('ayz'))

<!-- !test out chain -->

> ```
> { status: true, index: 3, value: 'bc' }
> { status: true, index: 3, value: 'yz' }
> { status: false, index: 1, value: [ "'bc'" ] }
> ```

#### `p.subEnv(parser, derive:Function)`

Returns a parser that works exactly like the given `parser`, but with a
different environment object passed to its parsers.  The new environment object
is created by calling `derive(env)` where `env` is the current environment.

<!-- !test in subEnv -->

    const env = { level: 0 }

    const expression = p.from(() => p.alt([listParser, dotParser]))
    const dotParser = p.map(p.string('.'), (value, env) => env)
    const listParser = p.subEnv(
      p.map(
        p.seq([
          p.string('('),
          p.times(expression, 0, Infinity),
          p.string(')')
        ]),
        ([leftParen, value, rightParen]) => value),
      (env) => ({ level: env.level + 1 }))

    console.log(expression('.', env))
    console.log(expression('(.)', env))
    console.log(expression('((.).)', env))

<!-- !test out subEnv -->

> ```
> { status: true, index: 1, value: { level: 0 } }
> { status: true, index: 3, value: [ { level: 1 } ] }
> { status: true, index: 6, value: [ [ { level: 2 } ], { level: 1 } ] }
> ```

#### `p.from(decideParser:Function)`

Delegates to the parser returned by `decideParser(environment)`.

This lets you decide dynamically in the middle of parsing what you want this
parser to be, based on the `environment`, or otherwise.

<!-- !test in from -->

    const parser = p.from((env) => env.myParser)

    console.log(parser('abc', { myParser: p.string('abc') }))
    console.log(parser('something else', { myParser: p.all }))

<!-- !test out from -->

> ```
> { status: true, index: 3, value: 'abc' }
> { status: true, index: 14, value: 'something else' }
> ```

#### `p.clone(parser)`

Returns a parser that works exactly like the given `parser`, but has a distinct
object identity.

It may be useful if you're intending to
[`p.replace`](#preplacetargetparser-sourceparser) the original and want a copy
that doesn't change to point to its new `p.replace`d implementation.

:warning: This is a hack that may be useful for debugging, but which you
probably shouldn't use in actual code.  It is almost certainly better
architecture to simply create a function that can construct copies of the
identical parser you need, or just pass the same parser to multiple places.
See the warning on [`p.replace`](#preplacetargetparser-sourceparser) for more
about this.

<!-- !test in clone -->

    const parser = p.string('a')
    const clonedParser = p.clone(parser)
    p.replace(parser, p.string('b'))

    console.log(parser('b'))
    console.log(clonedParser('a'))
    console.log(clonedParser('b'))

<!-- !test out clone -->

> ```
> { status: true, index: 1, value: 'b' }
> { status: true, index: 1, value: 'a' }
> { status: false, index: 0, value: [ "'a'" ] }
> ```

### Helper functions

#### `p.debug(parser [, debugHandler:Object])`

Returns a parser that works identically to the given `parser`, but with debug
instrumentation.

If a `debugHandler` is passed, its properties are called as functions during
parsing:

 - `debugHandler.enter` is called before a parser executes with arguments
   `parser:Parser`, `input:String`, `index:Number`, `env: Any`.
 - `debugHandler.exit` is called once a parser returns, with the same arguments
   plus `result:Object` in [the same format as
   normally](https://github.com/anko/partser#calling-a-parser).

Without a custom debug handler given, the default is used, which prints a
coloured visualisation of the parse:

<!-- !test in debug -->

```
const parser = p.times(
  p.alt([p.string('ba'), p.string('na')]),
  0, 3)
const parserWithDebug = p.debug(parser)
const result = parserWithDebug('banana')
console.log(result)
```

With colour support:

> ![debug output with colours](https://user-images.githubusercontent.com/5231746/94251806-5ef0d080-ff23-11ea-8e3f-f59aa74dc51c.png)

Without colour:

<!-- !test out debug -->

> ```
> banana 1,1 times(0,3) ?
> banana · 1,1 alt(*2) ?
> banana · · 1,1 string("ba") ?
> banana · · 1,1 string("ba") OKAY "ba" (len 2)
> banana · 1,1 alt(*2) OKAY "ba" (len 2)
> banana · 1,3 alt(*2) ?
> banana · · 1,3 string("ba") ?
> banana · · 1,3 string("ba") FAIL ["'ba'"]
> banana · · 1,3 string("na") ?
> banana · · 1,3 string("na") OKAY "na" (len 2)
> banana · 1,3 alt(*2) OKAY "na" (len 2)
> banana · 1,5 alt(*2) ?
> banana · · 1,5 string("ba") ?
> banana · · 1,5 string("ba") FAIL ["'ba'"]
> banana · · 1,5 string("na") ?
> banana · · 1,5 string("na") OKAY "na" (len 2)
> banana · 1,5 alt(*2) OKAY "na" (len 2)
> banana 1,1 times(0,3) OKAY "banana" (len 6)
> { status: true, index: 6, value: [ 'ba', 'na', 'na' ] }
> ```

:warning: The output of the default debug handler is intended for human
interpretation.  It may change in the future.  If you want to consume debug
information programmatically, create your own debug handler.

#### `p.debug.makeHandler([options:Object])`

Creates a debug handler similar to the default, but with configurable
`options`:

 - `context:Number`: Number of chars of input to show at the left for context
   (default: `10`)

 - `padIfShort:Boolean`: Set this to `true` to pad the context strip to the
   same length if the input string doesn't fill it completely (default:
   `false`)

 - `enter:Function`: Is passed the same parameters as the `enter` property of
   the debug handler.

   If it returns `false`, this log entry is skipped.

   If it returns some truthy value, that value is appended to the regular log
   entry as extra data.  Any extra data will be indented appropriately and
   placed after the usual debug print.

   (default: `undefined`; no extra data shown)

 - `exit:Function`: As above, but for `exit`.  (default: `undefined`; no extra
   data shown)

Use-cases for this function include displaying the parse environment in a
domain-appropriate way, and filtering which log entries are shown.

<!-- !test in debug with extra info -->

```js
const env = { wasCalled: false }
const parser = p.from((env) => {
  env.wasCalled = true
  return p.string('a')
})

const debugHandler = p.debug.makeHandler({
  context: 10,
  enter: (name, input, index, env) => `→ ${env.wasCalled}`,
  exit: (name, input, index, env, result) => `← ${env.wasCalled}`,
  padIfShort: true
})
const debugParser = p.debug(parser, debugHandler)
console.log(debugParser('a', env))
```

<!-- !test out debug with extra info -->

```
a          1,1 from ?
a          → false
a          · 1,1 string("a") ?
a          · → true
a          · 1,1 string("a") OKAY "a" (len 1)
a          · ← true
a          1,1 from OKAY "a" (len 1)
a          ← true
{ status: true, index: 1, value: 'a' }
```

If you want a completely different format, you can also create a custom handler
(an object with `enter` and `exit` functions).  See `p.debug` for a description
of the API.

#### `p.replace(targetParser, sourceParser)`

Switches the `targetParser`'s parsing logic for the parsing logic of
`sourceParser`, without affecting either's object identity.

Returns `undefined`.

:warning:  *This is a hack that you almost certainly shouldn't use.*  I keep it
around because it's useful for debugging and unsafe duct-tape creativity.  If
you need to change parsers, you should probably implement them as
[`p.from`](#pfromdecideparserfunction)s instead, and dynamically load the
desired implementation from your environment object.  That way you can use
[`p.subEnv`](#psubenvparser-derivefunction)s too, to keep your parsing
environments scoped and clean.  But the dirty large hammer is here if you need
it for some reason.

<!-- !test in replace -->

    const parser = p.string('a')
    p.replace(parser, p.string('b'))

    console.log(parser('b'))

<!-- !test out replace -->

> ```
> { status: true, index: 1, value: 'b' }
> ```

#### `p.isParser(value)`

Returns `true` if `value` is a Partser parser, and `false` otherwise.

<!-- !test in isParser -->

    const parser = p.string('a')
    const someFunction = () => {}

    console.log(p.isParser(parser))
    console.log(p.isParser(someFunction))

<!-- !test out isParser -->

> ```
> true
> false
> ```

#### `p.formatError(input:String, result:Object)`

Takes an `input` that you parsed, and the `result` of a failed parse of that
input.  Produces a human-readable error string stating what went wrong, where
it went wrong, and what was expected instead.

Outputs a basic human-readable error message which exact format is not
guaranteed.  For production use, you should probably write your own error
formatter, so you can have nice things like coloured output, and more context.

<!-- !test in formatError -->

    const parser = p.alt([p.string('a'), p.string('b')])

    const input = 'c'
    const result = parser(input)

    console.log(p.formatError(input, result))

<!-- !test out formatError -->

> ```
> expected one of 'b', 'a' at character 0, got 'c'
> ```

## Tips and patterns

### Recursive parsers

Trying to make a recursive parser, or want to pass a not-yet-defined parser
to a combinator, and getting a `ReferenceError`?  You can use
[`p.from`](#pfromdecideparserfunction) to load it during parsing instead.

<!-- !test in using from to load later -->

```js
// If we tried to pass `word` directly, we'd get an error like
//
//     ReferenceError: Cannot access 'word' before initialization
//
const exclamation = p.seq([p.from(() => word), p.string('!')])

const word = p.regex(/\w+/)

console.log(exclamation('Hi!'))
```

<!-- !test out using from to load later -->

> ```
> { status: true, index: 3, value: [ 'Hi', '!' ] }
> ```

### Make your own helper functions

It is frequently useful to create your own helper functions, to make your
implementation neater.

<!-- !test in helpers -->

```js
const node = (name, parser) => {
  return p.map(
    p.lcMark(parser),
    (result) => Object.assign({ name }, result))
}

const word = node('word', p.regex(/\w+/))
const number = node('number', p.regex(/\d+/))

console.log(word('Hi').value)
console.log(number('42').value)
```

<!-- !test out helpers -->

> ```
> {
>   name: 'word',
>   start: { offset: 0, line: 1, column: 1 },
>   value: 'Hi',
>   end: { offset: 2, line: 1, column: 3 }
> }
> {
>   name: 'number',
>   start: { offset: 0, line: 1, column: 1 },
>   value: '42',
>   end: { offset: 2, line: 1, column: 3 }
> }
> ```

### Using an immutable environment object

Instead of directly assigning to your parse environment object, you may be able
to avoid bugs in complex implementations by treating your parse environment as
_immutable_.  When parsers want to change the environment, they would create a
new environment in which to make changes using `p.subEnv`.

However, `p.subEnv` is not enough in situations where you want to pass an
extended environment object forward through a sequence of parsers in `p.seq` or
`p.times`.

If you want to do this, just have your parser pass back the new environment
object as part of the parse result, and pass the `chainEnv` argument to `p.seq`
or `p.times`, to define how to extract from the previous parser's result the
environment object to use for the next parser.

The `chainEnv` argument should be a function.  It is called with 2 parameters:

 - `value`; a successful result of the sequenced parser, and
 - `env`; the environment object as it is currently.

Your `chainEnv` function should return whatever should be passed as the
environment object to the next parser in the sequence.

Here's an example, for parsing a sequence of comma-separated consecutive
integers:

<!-- !test in chainEnv -->

```js
const nextNumberParser = p.from(env => {
  const parser = p.map(
    p.seq([
      p.string(env.nextNumber.toString()),
      p.alt([p.string(','), p.eof])
    ]),
    ([number, _]) => number)

  return p.map(
    parser,
    (result, env) => {
      // Construct new env, rather than mutating the existing one.
      return { result, nextEnv: { nextNumber: env.nextNumber + 1 } }
    })
})

const manyNumbers = p.times(
  nextNumberParser, 0, Infinity,
  // This is the chainEnv argument
  (numberResult, previousEnv) => {
    if (numberResult.nextEnv) return numberResult.nextEnv
    else return previousEnv
  })

const env = { nextNumber: 0 }
console.log(manyNumbers('0,1,2', env))
```

<!-- !test out chainEnv -->

> ```
> {
>   status: true,
>   index: 5,
>   value: [
>     { result: '0', nextEnv: { nextNumber: 1 } },
>     { result: '1', nextEnv: { nextNumber: 2 } },
>     { result: '2', nextEnv: { nextNumber: 3 } }
>   ]
> }
> ```

## Limitations

[LL](https://en.wikipedia.org/wiki/LL_parser)(∞) parsers (like this library
creates) have these limitations:

 - No [left recursion](https://en.wikipedia.org/wiki/Left_recursion).  Grammars
   that contain left recursion will recurse infinitely and overflow the stack.
 - No [ambiguity](https://en.wikipedia.org/wiki/Ambiguous_grammar).  Ambiguous
   grammars are allowed and will parse, but will only return the first success
   or the last failure, not all possible interpretations.

## Related libraries

 - [Parsimmon](https://github.com/jneen/parsimmon) is where this library was
   forked from.  It can recognise the same category of grammars, but can
   additionally handle binary data.  It has a more abstract API, with a
   language construction DSL and a call-chaining syntax that some prefer.  It
   doesn't support user-defined nested environments, and has relatively limited
   features for modifying parsing logic during parsing.
 - [Nearley](https://github.com/kach/nearley) is much more performant, can
   parse left-recursive grammars, and even handles ambiguity!  However, it is
   much more rigid in design: it does not have parse environments, and cannot
   modify the parser during parsing.

## License

[ISC](LICENSE)
