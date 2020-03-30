# partser [![](https://img.shields.io/npm/v/partser.svg?style=flat-square)](https://www.npmjs.com/package/partser) [![](https://img.shields.io/travis/anko/partser.svg?style=flat-square)](https://travis-ci.org/anko/partser) [![](https://img.shields.io/david/anko/partser.svg?style=flat-square)](https://david-dm.org/anko/partser)

Partser is a combinatory parsing library for JavaScript with a focus on being
*ridiculously* flexible and modular.  Among other things, it—

 - can modify its own parsing logic *in the middle of parsing*,
 - passes an environment object to parsers,
 - can create nested sub-environments during parsing, and
 - lets you easily implement your own custom primitive parsers or combinators.

If you are looking for a combinatory parsing library that is similar but
friendlier and without these advanced features, try
[Parsimmon](https://github.com/jneen/parsimmon), which this project was
originally forked from.

## Example

Here's a demonstration of a string literal parser that reads the quote symbol
that it should use from the environment object passed by the caller:

<!-- !test program
# Change requires to the correct import, and strip the final newline.
sed "s/require('partser')/require('.\\/index.js')/g" \
| node \
| head -c -1 -->

<!-- !test in quick example -->

``` js
var p = require('./index.js')

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

Running it produces this:

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
 - [`replace`](#replace), which allows a parser's logic to be changed, and

Together these can be used to express how to turn text into a data structure.

### Calling a parser

   parser(inputString [, environment [, offset]])

Every parser must be called with

 - an input string,
 - *optionally* an environment object that is passed to other parsers, and to
   user-defined functions such as with the `map` parser, and
 - *optionally* an integer offset in characters where to start parsing (default
   0, i.e. at the beginning).

### Result format

When called, a parser returns an object with these fields:

 - `status`: a Boolean representing whether the parse succeeded (`true`) or
   failed (`false`).
 - `value`:
   - **If successful**, the return value of the parse.
   - **If failed**, an array of strings representing what input would have been
     acceptable at the point in the input that the parse failed.
 - `index`:
   - **If successful**, the point in the stream that the parse succeeded at.
     (Probably only useful for advanced users writing custom parser primitives
     that maybe called by other parsers.)
   - **If failed**, the furthest that the parser managed to match before
     encountering a dead end.

### Primitive parsers

 - `all`: Matches all input and returns it.  Always succeeds.
 - `any`: Matches any 1 character and returns it.
 - `eof`: Matches the end of input and returns null.
 - `succeed`: Always succeeds without consuming any input, and returns null.
 - `fail`: Always fails.
 - `index`: Consumes no input.  Returns a 0-based integer representing the
   number of characters that have been consumed from the input so far.  Always
   succeeds.
 - `lcIndex`: Consumes no input.  Returns an object with integer fields `line`
   (1-based), `column` (1-based) and character `offset` (0-based), which
   represents how much input has been consumed so far.  Always succeeds.

A parser is a function that can be called with a string to return a `{
status::Boolean, value::Any }`-object.  Don't touch their `_`-property, or
assume anything about what it is or does.  Feel free to assign other properties,
but don't expect `clone` to copy them.

### Parser constructors

 - `string`: Takes a string argument.  The returned parser matches and returns
   that string.
 - `regex`: Takes a RegExp argument and an optional number argument.  The
   returned parser matches anything that matches that regex and returns it.  If
   the number argument was given, that [capturing
   group](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp#grouping-back-references)
   is returned.
 - `test`: Takes a function argument.  Consumes 1 character and passes it and
   the environment as arguments to the function.  Succeeds and returns that
   character if the function returns true.  Fails otherwise.  Nice for checking
   Unicode character ranges for instance.
 - `custom`: Used to construct custom parser primitives with your own logic.
   Takes a function argument.  Your function should have the same interface as
   the built-in parsers: take 2 arguments (the input string, and integer offset
   into it that has been consumed so far) and return objects adhering to the
   [result format](#result-format)

### Parser combinators

 - `seq`: Takes any number of parser arguments.  Returns a parser that matches
   those parsers in sequence and returns an arrey of their results.
 - `alt`: Takes any number of parser arguments.  Returns a parser that matches
   any one of those parsers.  It returns the result of the first that matches.
 - `times`: Takes a parser, a minimum number, and an optional maximum number.
   If 1 number is given, returns a parser that matches the parser exactly that
   many times.  If both numbers are given, the returned parser will match the
   given at least the minimum number of times, and at most the maximum number.
 - `except`: Takes an "allowed" parser and a "forbidden" parser.  Returns a
   parser that matches anything that the allowed parser accepts *and* which the
   forbidden parser does *not* accept.
 - `desc`: Takes a parser and a string.  Returns a parser that works the same
   as the given parser, but always fails with the given string as its
   "expected" value.
 - `mark`: Takes a parser.  Returns a parser that works the same as the given
   parser, but instead returns an object of the form `{ value :
   whateverItReturned, start: Number, end: Number }` where `start` and `end`
   denote where in the input the match appeared.
 - `lcMark`: Takes a parser.  Returns a parser that works the same as the given
   parser, but instead returns an object, which `value` is what that parser
   returned, and `start` and `end` are objects with `offset`, `line` and
   `column` properties, just like `lcIndex` returns, which denote where in the
   input the match appeared.
 - `map`: Takes a parser and a function.  Returns a parser that matches the
   same as the input parser, but every time it matches, the value and
   environment object are passed to the given function, and its return value is
   used instead.
 - `chain`: Takes a parser and a function.  Returns a parser that matches the
   given parser, then calls the given function with its result and the
   environment object.  That function is expected to return a parser to call
   next, and the match result of that is returned.
 - `clone`: Takes a parser.  Returns a parser with identical logic to the given
   parser, but a distinct object identity.  Does not copy any properties
   assigned to the parser!
 - `subEnv`: Takes a parser, and a function that takes an environment and
   returns a derived environment.  Within the given parser, that derived
   environment is used instead of the original one.
 - `from`: Takes a function.  The function is called with the environment
   object as an argument whenever the parser is needed, and the function is
   expected to return a parser, which is then called.

### `isParser`

Checks if the argument is a real Partser parser.

### `replace`

Switches a parser's logic for that of another one, without affecting either's
identity.  Returns `undefined`.  You rarely need to use this, but it's here if
you need it for some reason.

### `formatError`

Takes a string that you parsed and the result object of a failed parse of that
string.  Produces a human-readable error string stating what went wrong, where
it went wrong, and what was expected instead.

<!-- !test program
# Insert import line to input, and delete final newline from output.
sed "1ivar p = require('.\\/index');" \
| node \
| head -c -1 -->

<!-- !test in formatError -->

    var parser = p.seq(p.string('Axe '), p.alt(p.string('fells you!'), p.string('sharpens!')))

    var input = 'Axe dies!'
    var result = parser(input)
    console.log(p.formatError(input, result))

<!-- !test out formatError -->

    expected one of 'sharpens!', 'fells you!' at character 4, got '...dies!'

## Tips and patterns

 - Getting infinite loops and overflowing the stack when replacing a parser
   with something that calls that parser?  You probably want to pass a `clone`
   of it instead.
 - You might want to structure your parser to load some notable parts of its
   parsing logic from the environment object using `from`.  That way, if your
   users wish they could parse some part differently, they can pass in the
   functionality they wished they had instead.

## License

[ISC](#LICENSE).
