# partser ![](https://img.shields.io/npm/v/partser.svg?style=flat-square) ![](https://img.shields.io/travis/anko/partser.svg?style=flat-square) ![](https://img.shields.io/david/anko/partser.svg?style=flat-square)

Partser is a library for writing parsers that are made of parts that are also
parsers.  The user can switch out any parser part's behaviour for that of a
different parser.

This lets you write ridiculously modular parsers that keep your parser
adaptable and, if necessary, user-modifiable.

## Example

For example, suppose you wanted to make a parser that accepts string literals
like `"hi"` and outputs objects like `{ type: 'string', contents: 'hi' }`.

You could write this:

<!-- !test program
# Change the first line to the correct import, and strip the final newline.
sed '1s/.*/var p = require(".\\/index");/' \
| node \
| head -c -1 -->

<!-- !test in quick example -->

``` js
var p = require('partser')
// Construct a string parser
var quote = p.string('"')
var stringChar = p.except(p.any, quote)
var stringContents = p.map(
  p.times(stringChar, 0, Infinity),
  function (chars) {
    // The argument is an array like `[ 'h', 'i' ]`
    return chars.join('')
  })
var stringParser = p.map(
  p.seq(quote, stringContents, quote),
  function (parts) {
    // The argument is an array like `[ '"', 'hi', '"' ]`
    return {
      type: 'string',
      contents: parts[1]
    }
  })

// Use it to parse something
console.log(p.parse(stringParser, '"hi"'))

// Use single quotes instead
p.replace(quote, p.string("$"))

// The change propagates to everything that calls the `quote` parser.
console.log(p.parse(stringParser, '$hi$'))
```

Running it produces this:

<!-- !test out quick example -->

```
{ status: true, value: { type: 'string', contents: 'hi' } }
{ status: true, value: { type: 'string', contents: 'hi' } }
```

Note how the `quote` parser was `replace`'d partway through with a parser that
accepts `$` instead of `"`, and the change propagates to the `stringParser`.

## Usage

Partser gives you functions of a few different types:

 - [*primitive parsers*](#primitive-parsers) that consume strings and return
   tokens (e.g. `all` or `any`),
 - [*parser constructors*](#parser-constructors) that return new parsers based
   on arguments (e.g.  `string` or `regex`),
 - [*parser combinators*](#parser-combinators) that take parsers and produce
   new parsers that use them (e.g.  `seq` or `map`),
 - [`replace`](#replace), which allows a parser's logic to be changed, and
 - [`parse`](#parse), which performs the actual parsing.

Together these can be used to express how to turn text into a data structure.

### Primitive parsers

 - `all`: Matches all input and returns it.  Always succeeds.
 - `any`: Matches any 1 character and returns it.
 - `eof`: Matches the end of input and returns null.
 - `succeed`: Always succeeds and returns null.
 - `fail`: Always fails.
 - `index`: Consumes no input.  Returns an integer representing the number of
   characters that have been consumed from the input so far.  Always succeeds.

### Parser constructors

 - `string`: Takes a string argument.  The returned parser matches and returns
   that string exactly.
 - `regex`: Takes a RegExp argument and an optional number argument.  The
   returned parser matches anything that matches that regex and returns it.  If
   the number argument was given, that [capturing
   group](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp#grouping-back-references)
   is returned.
 - `test`: Takes a function argument.  Consumes 1 character and passes it as an
   argument to the function.  Succeeds and returns that character if the
   function returns true. Fails otherwise.
 - `custom`: Takes a function argument.  A bit complex to explain: [see this
   section](#defining-custom-primitive-parsers).

### Parser combinators

 - `seq`: Takes any number of parser arguments.  Returns a parser that matches
   those parsers in sequence and returns an arrey of their results.
 - `alt`: Takes any number of parser arguments.  Returns a parser that matches
   any one of those parsers.  It returns the result of the first that matches.
 - `times`: Takes a parser, a minimum number, and an optional maximum number.
   If 1 number is given, returns a parser that matches the parser exactly that
   many times.  If both numbers are given, the returned parser will match the
   given at least the minimum number of times, and at most the maximum number.
 - `map`: Takes a parser and a function.  Returns a parser that matches the
   same as the input parser, but transforms all of its results by passing them
   through the given function before returning them.
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
 - `chain`: Takes a parser and a function.  Returns a parser that matches the
   given parser, then calls the given function with its result.  That function
   is expected to return a parser, which match result is returned.
 - `clone`: Takes a parser.  Returns a parser with identical logic to the given
   parser, but a distinct object identity.

### `replace`

Switches a parser's logic for that of another one, without affecting either's
identity.  Returns `undefined`.

### `parse`

Takes a parser and a string, and returns the result of attempting to parse that
string with that parser.

### `formatError`

Takes an object representing a parse failure and the string input that caused
it, and produces a human-readable error string stating what went wrong, where
it went wrong, and what was expected instead.

## Tips and patterns

 - Getting infinite loops and overflowing the stack when replacing a parser
   with something that calls that parser?  You probably want to pass a `clone`
   of it instead.
 - You might want to structure your parser to export not just your main parser,
   but also all the notable sub-parsers that it calls.  That way, if your users
   wish they could parse some part differently, they can `replace` components
   individually.

## License

[MIT](#LICENSE).