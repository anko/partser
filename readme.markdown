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

<!-- !test program
# Change requires to the correct import, and strip the final newline.
sed "s/require('partser')/require('.\\/index.js')/g" \
| node \
| head -c -1 -->

<!-- !test in quick example -->

``` js
var p = require('partser')

// Let's parse a string!

// Just for fun, let's make the quote character configurable.  We can define
// that it should be loaded from the environment.
var quote = p.from((env) => env.quoteParser)

// The string can contain anything except the quote character.
var stringChar = p.except(p.any, quote)

// The contents of a string (the stuff between the quotes) shall be that sort
// of character any number of times, all joined together.
var stringContents = p.map(
  p.times(stringChar, 0, Infinity),
  (chars) => chars.join(''))

// Putting it all together, we'll want a quote, contents, then another quote.
// Then we'll want to pick out just the content part, and return that.
var stringParser = p.map(
  p.seq(quote, stringContents, quote),
  ([startingQuote, contents, endingQuote]) => contents)

// Now we can pass an environment object as part of the call to the parser,
// telling it what that quoteParser should be.
console.log(stringParser('"hi"', { quoteParser: p.string('"') }))
console.log(stringParser('$hi$', { quoteParser: p.string('$') }))
console.log(stringParser('ohio', { quoteParser: p.string('o') }))
```

Output:

<!-- !test out quick example -->

```
{ status: true, index: 4, value: 'hi' }
{ status: true, index: 4, value: 'hi' }
{ status: true, index: 4, value: 'hi' }
```

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

#### `p.any`

Matches any 1 character and returns it.

#### `p.eof`

Matches the end of input (only matches if no more characters are remaining) and
returns null.

#### `p.index`

Always succeeds, without consuming any input.  Returns a 0-based integer
representing the offset into the input that has been consumed so far.

#### `p.lcIndex`

Always succeeds, without consuming any input.  Returns an object with integer
fields `line` (1-based), `column` (1-based) and character `offset` (0-based),
which represents how much input has been consumed so far.

This is a more verbose version of [`p.index`](#pindex).  For performance, use
that if you only need the character offset.

### Parser constructors

These functions let you construct your own parsers that match various things:

#### `p.succeed([value])`

Return:  Parser that always succeeds with `value` or undefined, without
consuming any input.

#### `p.fail([value])`

Return:  Parser that always fails with `value` or undefined, without consuming
any input.

#### `p.string(value:String)`

Return:  Parser that matches that string and returns it.

#### `p.regex(regex:RegExp [, group:Number])`

Return:  Parser that matches the given `regex` and returns the given capturing `group` (default: 0).

#### `p.test(predicate:Function)`

Return:  Parser that consumes 1 `character`, calls `predicate(character, env)`.
Succeeds and returns `character` if `predicate` returns true.  Otherwise fails.

Nice for when you need to do math on character values, like checking Unicode
character ranges.

#### `p.custom(implementation:Function)`

Return:  Parser that works according to the logic specified in the given
`implementation`.  The `implementation` should have the [the same API as the
built-in parsers do](#calling-a-parser).

### Parser combinators

These functions operate on parsers, acting as "wrappers" around them to modify
how they work.

#### `p.seq([parser, ...])

Takes any number of arguments.

Return:  Parser that matches all of the given `parser`s in order, and returns
an Array of their results.

#### `p.alt([parser, ...])`

Takes any number of arguments.

Returns a parser that matches any of the given `parser`s, and returns the result of the first one that matches.

#### `p.times(parser, min:Number [, max:Number])`

Returns a parser that matches the given `parser` at least `min`, and at most
`max` times, and returns an Array of the results.

If `max` is not given, `max = min`.

#### `p.except(allowedParser, forbiddenParser)`

Returns a parser that matches what `allowedParser` matches, except if what it
matched would also match `forbiddenParser`.

#### `p.desc(parser, description:String)`

Returns a parser that works exactly the same as `parser`, but always fails with
the `description` as its expected value.

Useful for making complex parsers show clearer error messages.

#### `p.mark(parser)`

Returns a parser that works exactly like `parser`, but when it succeeds, it
annotates the return `value` with the `start` and `end` offsets of where that
value was found.  The `value` becomes an Object with `{ value, start, end }`
instead.

Useful when you need to know not only that something matched, but *where* it
was matched, such as for generating a [source
map](https://github.com/mozilla/source-map).

#### `p.lcMark(parser)`

Like [`p.mark`](#pmarkparser), but also annotates the value with 1-based `line` and
`column` locations.  You can expect the value to look like—

    { value,
      start: { offset, line, column },
      end:   { offset, line, column } }

#### `p.map(parser, transformer:Function)`

Returns a parser that works exactly like `parser`, but when it succeeds with a
`value`, it instead returns `transformer(value, env)`.

Analogous to
[`Array.prototype.map`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map).

#### `p.chain(parser, decider:Function)`

Returns a parser that matches the given `parser` to get a `value`, then calls
`decider(value, env)` expecting it to return a parser.  Then matches and
returns *that parser* returned by `decider`.

:warning: *You almost certainly want [`p.from`](#pfromdecideparserfunction) instead.*  This is a classic
combinator possibly familiar to users of other parsing libraries.  I've
implemented it here mainly to reduce the cognitive load of porting parsers
between libraries.

#### `p.clone(parser)`

Returns a parser that works exactly like the given `parser`, but has a distinct
object identity.

Useful if you're intending to [`p.replace`](#preplacetargetparsersourceparser) the original and want a
copy that doesn't change to point to its new `p.replace`d implementation.

#### `p.subEnv(parser, derive:Function)`

Returns a parser that works exactly like the given `parser`, but with a
different environment object passed to its parsers.  The new environment object
is created by calling `derive(env)` where `env` is the current environment.

#### `p.from(decideParser:Function)`

Delegates to the parser returned by `decideParser(environment)`.

This lets you decide dynamically in the middle of parsing what you want this
parser to be, based on the `environment` or otherwise.

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
[`p.subEnv`](#psubenvparserderivefunction)s too, to keep your parsing
environments scoped and clean.  But the dirty large hammer is here if you need
it for some reason.

#### `p.isParser(value)`

Returns `true` if `value` is a Partser parser, and `false` otherwise.

#### `p.formatError(input:String, result:Object)`

Takes an `input` that you parsed, and the `result` of a failed parse of that
input.  Produces a human-readable error string stating what went wrong, where
it went wrong, and what was expected instead.

Nice for generating human-readable error messages, if you don't want to do it
yourself.

## Tips and patterns

 - Trying to pass a parser that isn't yet defined to a combinator?  Use
   [`p.from`](#pfromdecideparserfunction) to load it during parsing instead.

## License

[ISC](LICENSE)
