# partser [![](https://img.shields.io/npm/v/partser.svg?style=flat-square)](https://www.npmjs.com/package/partser) [![](https://img.shields.io/travis/anko/partser.svg?style=flat-square)](https://travis-ci.org/anko/partser) [![](https://img.shields.io/david/anko/partser.svg?style=flat-square)](https://david-dm.org/anko/partser)

Partser is a combinatory parsing library for JS, for writing LL(∞) parsers made
of other parsers.  It is *ridiculously flexible*: Your parsers can modify their
parsing logic even during parsing, by introducing, redefining, or modifying
sub-parsers inside nested scoped environments, even based on partial parse
results.

If you'd prefer a more abstract API and don't need advanced features like
environments, try [Parsimmon](https://github.com/jneen/parsimmon), which this
project was forked from.

## Motivating example

Here's a demonstration of a string literal parser that reads the quote symbol
that it should use from the environment object passed by the caller:

<!-- !test program node test-readme-example.js -->

<!-- !test in motivating example -->

``` js
var p = require('partser')

// Let's parse a string!

// For fun, let's load the quote character from the parse environment.
var quote = p.from((env) => env.quoteParser)

// The string can contain any characters that aren't quotes.
var stringChar = p.except(p.any, quote)

// The contents of a string (the stuff between quotes) shall be many
// stringChars, joined together.
var stringContents = p.map(
  p.times(stringChar, 0, Infinity),
  (chars) => chars.join(''))

// A string is a quote, string contents, then another quote.
// We'll pick out just the content part, and return that.
var stringParser = p.map(
  p.seq(quote, stringContents, quote),
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

    const parser = p.seq(
      p.string('hi'),
      p.index)
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

    const parser = p.seq(
      p.string('hi'),
      p.lcIndex)
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
`implementation`.  The `implementation` should have the [the same API as the
built-in parsers do](#calling-a-parser).

<!-- !test in custom -->

    const parser = p.custom((input, index, env) => {
      // Put whatever logic you want here
      return { status: true, index, value: 42 }
    })
    console.log(parser(''))

<!-- !test out custom -->

> ```
> { status: true, index: 0, value: 42 }
> ```

### Parser combinators

These functions operate on parsers, acting as "wrappers" around them to modify
how they work.

#### `p.seq([parser, ...])`

Takes any number of arguments.

Return:  Parser that matches all of the given `parser`s in order, and returns
an Array of their results.

<!-- !test in seq -->

    const parser = p.seq(
      p.string('a'),
      p.regex(/[xyz]/))

    console.log(parser('ax'))

<!-- !test out seq -->

> ```
> { status: true, index: 2, value: [ 'a', 'x' ] }
> ```

#### `p.alt([parser, ...])`

Takes any number of arguments.

Returns a parser that matches any of the given `parser`s, and returns the
result of the first one that matches.

<!-- !test in alt -->

    const parser = p.alt(
      p.string('a'),
      p.string('b'))

    console.log(parser('b'))

<!-- !test out alt -->

> ```
> { status: true, index: 1, value: 'b' }
> ```

#### `p.times(parser, min:Number [, max:Number])`

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
      p.seq(p.regex(/[0-9]+/), p.string('.'), p.regex(/[0-9]+/)),
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

    const expression = p.from(() => p.alt(listParser, dotParser))
    const dotParser = p.map(p.string('.'), (value, env) => env)
    const listParser = p.subEnv(
      p.map(
        p.seq(
          p.string('('),
          p.times(expression, 0, Infinity),
          p.string(')')),
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

    let parser = p.from((env) => env.myParser)

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

Nice for generating human-readable error messages, if you don't want to do it
yourself.

<!-- !test in formatError -->

    const parser = p.alt(p.string('a'), p.string('b'))

    const input = 'c'
    const result = parser(input)

    console.log(p.formatError(input, result))

<!-- !test out formatError -->

> ```
> expected one of 'b', 'a' at character 0, got 'c'
> ```

## Tips and patterns

 - Trying to pass a parser that isn't yet defined to a combinator?  Use
   [`p.from`](#pfromdecideparserfunction) to load it during parsing instead.

## License

[ISC](LICENSE)
