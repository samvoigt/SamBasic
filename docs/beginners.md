# SamBasic Beginner's Guide

Welcome to SamBasic! This guide will teach you the basics of programming using SamBasic, a language inspired by classic BASIC. No prior experience needed.

## Getting Started

Open `index.html` in your browser. You'll see a code editor on the left and an output screen on the right. Type your code in the editor and press the play button (or power button) to run it.

## Your First Program

```
PRINT "Hello, world!"
```

That's it. `PRINT` displays text on the screen. Whatever you put in quotes shows up as output.

```
PRINT "My name is Sam"
PRINT "I am learning SamBasic"
```

Each `PRINT` statement goes on its own line. SamBasic runs your code one line at a time, top to bottom.

## Comments

Use a single quote `'` to write notes to yourself. SamBasic ignores everything after it.

```
' This is a comment — SamBasic skips this line
PRINT "This runs"   ' This part is also a comment
```

Comments are useful for explaining what your code does. You'll thank yourself later.

## Variables

Variables store information so you can use it later. In SamBasic, every variable name ends with a symbol that tells you what kind of data it holds:

| Symbol | What it holds | Example |
|--------|--------------|---------|
| `#` | A number | `score#` |
| `$` | Text (a "string") | `name$` |
| `?` | Yes or no (a boolean) | `alive?` |

```
name$ = "Whalers"
score# = 42
isWinning? = YES

PRINT name$
PRINT score#
```

You don't need to declare variables ahead of time. Just use them and SamBasic figures it out. Numbers start at `0`, strings start as `""`, and booleans start as `NO`.

**Important:** `score#` and `score$` are two completely different variables! The symbol is part of the name.

## Math

SamBasic can do math with numbers:

```
a# = 10
b# = 3

PRINT a# + b#     ' 13 (addition)
PRINT a# - b#     ' 7  (subtraction)
PRINT a# * b#     ' 30 (multiplication)
PRINT a# / b#     ' 3.333... (division)
PRINT a# % b#     ' 1  (remainder / modulo)
PRINT a# ^ 2      ' 100 (power)
```

You can combine math with variables:

```
lives# = 3
lives# = lives# - 1
PRINT "Lives left: " + lives#
```

Notice that `+` also works for joining text together. SamBasic will automatically turn a number into text when you add it to a string.

## Making Decisions with IF

Programs need to make choices. `IF` checks whether something is true and runs code based on the answer:

```
temperature# = 35

IF temperature# > 30 THEN
  PRINT "It's hot outside!"
END IF
```

The code between `IF` and `END IF` only runs if the condition is true. You must always include `END IF` to mark where the block ends.

### Adding ELSE

What if you want to do something different when the condition is false?

```
score# = 75

IF score# >= 90 THEN
  PRINT "A grade"
ELSE IF score# >= 80 THEN
  PRINT "B grade"
ELSE IF score# >= 70 THEN
  PRINT "C grade"
ELSE
  PRINT "Keep studying!"
END IF
```

### Comparisons

| Symbol | Meaning |
|--------|---------|
| `=` | Equal to |
| `<>` | Not equal to |
| `<` | Less than |
| `>` | Greater than |
| `<=` | Less than or equal to |
| `>=` | Greater than or equal to |

**Watch out:** SamBasic uses `=` for both assignment and comparison. `score# = 10` sets the variable, but inside an `IF`, `score# = 10` checks if it equals 10. Context matters!

### Combining Conditions

Use `AND`, `OR`, and `NOT` to build more complex checks:

```
age# = 15
hasTicket? = YES

IF age# >= 12 AND hasTicket? THEN
  PRINT "Welcome to the movie!"
END IF

IF NOT hasTicket? THEN
  PRINT "You need a ticket"
END IF
```

## Booleans

Boolean variables use `?` and hold either `YES` or `NO`:

```
gameOver? = NO
found? = YES

IF found? THEN
  PRINT "You found it!"
END IF
```

Any non-zero number counts as `YES`, and `0` counts as `NO`.

## Loops

Loops let you repeat code without typing it over and over.

### FOR Loops

When you know how many times to repeat:

```
FOR i# FROM 1 TO 5
  PRINT "Count: " + i#
END FOR
```

This prints the numbers 1 through 5. The variable `i#` automatically changes each time through the loop.

You can count by different amounts with `STEP`:

```
' Count by twos
FOR i# FROM 2 TO 10 STEP 2
  PRINT i#
END FOR

' Count backwards
FOR i# FROM 10 TO 1 STEP -1
  PRINT i#
END FOR
```

### WHILE Loops

When you want to repeat until a condition changes:

```
count# = 1
WHILE count# <= 5
  PRINT "Count: " + count#
  count# = count# + 1
END WHILE
```

**Be careful!** If the condition never becomes false, your program will run forever. Make sure something inside the loop changes the condition.

### BREAK and CONTINUE

`BREAK` exits a loop early. `CONTINUE` skips the rest of the current pass and goes to the next one:

```
FOR i# FROM 1 TO 100
  IF i# = 5 THEN
    BREAK           ' Stop the loop at 5
  END IF
  PRINT i#
END FOR
' Prints 1, 2, 3, 4

FOR i# FROM 1 TO 6
  IF i# = 3 THEN
    CONTINUE        ' Skip 3
  END IF
  PRINT i#
END FOR
' Prints 1, 2, 4, 5, 6
```

## Arrays

An array holds a list of values. Array variable names end with `@`:

```
colors@ = ["red", "green", "blue"]
PRINT colors@[1]    ' prints "red"
PRINT colors@[3]    ' prints "blue"
```

**Arrays start at 1** in SamBasic, not 0. The first item is `[1]`, the second is `[2]`, and so on.

### Working with Arrays

```
scores@ = [10, 25, 18, 30]

' How many items?
PRINT LENGTH# scores@    ' 4

' Change an item
scores@[2] = 99

' Add to the end
APPEND scores@, 42

' Loop through all items
FOR i# FROM 1 TO LENGTH# scores@
  PRINT scores@[i#]
END FOR
```

### Creating Empty Arrays

```
' Empty array
items@ = []

' Array of 10 zeros
grid@ = SIZE 10
```

## Functions

Functions are reusable blocks of code. They help you organize your program and avoid repeating yourself.

```
FUNCTION sayHello
  PRINT "Hello there!"
END FUNCTION

sayHello         ' Call the function
sayHello         ' Call it again
```

### Functions with Parameters

You can pass information into a function:

```
FUNCTION greet name$
  PRINT "Hello, " + name$ + "!"
END FUNCTION

greet "Sam"
greet "World"
```

### Functions that Return Values

The function name's symbol tells SamBasic what type it returns:

```
FUNCTION double# n#
  RETURN n# * 2
END FUNCTION

result# = double# 5
PRINT result#           ' 10

FUNCTION shout$ text$
  RETURN text$ + "!!!"
END FUNCTION

PRINT shout$ "wow"      ' wow!!!
```

Functions with no return value have no symbol:

```
FUNCTION drawBorder
  PRINT "==========="
END FUNCTION
```

## Text Output

### PRINT

`PRINT` writes text at the current cursor position and moves to the next line:

```
PRINT "Line 1"
PRINT "Line 2"
```

### PRINTAT

`PRINTAT` puts text at a specific row and column on the 80x25 screen:

```
PRINTAT 1, 1, "Top-left corner"
PRINTAT 12, 35, "Center-ish"
PRINTAT 25, 1, "Bottom-left"
```

The screen is 25 rows tall and 80 columns wide. Both start at 1.

### Colors

You can set the text color with `SETCOLOR`:

```
SETCOLOR RED&
PRINT "This is red"

SETCOLOR GREEN&
PRINT "This is green"

SETCOLOR WHITE&
PRINT "Back to white"
```

The built-in colors are: `BLACK&`, `WHITE&`, `RED&`, `GREEN&`, `BLUE&`, `YELLOW&`, `CYAN&`, `MAGENTA&`, `DARKGRAY&`, `LIGHTGRAY&`, `DARKRED&`, `DARKGREEN&`, `DARKBLUE&`, `DARKYELLOW&`, `DARKCYAN&`, `DARKMAGENTA&`.

## Reading Keyboard Input

You can check what keys the player is pressing:

```
WHILE YES
  key$ = GETKEY$
  IF key$ <> "" THEN
    PRINT "You pressed: " + key$
  END IF
  SLEEP 0.05
END WHILE
```

`GETKEY$` returns the name of the currently held key, or `""` if nothing is pressed. Common key names: `"ArrowUp"`, `"ArrowDown"`, `"ArrowLeft"`, `"ArrowRight"`, `"a"` through `"z"`, `" "` (space).

If you need to check for multiple keys at once (like moving diagonally), use `GETALLKEYS@`:

```
keys@ = GETALLKEYS@
FOR i# FROM 1 TO LENGTH# keys@
  IF keys@[i#] = "ArrowUp" THEN
    PRINT "Up is held!"
  END IF
END FOR
```

## Putting It Together: A Guessing Game

Here's a complete program that uses most of what you've learned:

```
' Number guessing game
secret# = RANDOM# MAX 100
guesses# = 0
found? = NO

PRINT "I'm thinking of a number between 0 and 100."
PRINT "Use UP and DOWN arrow keys to guess."
PRINT ""

guess# = 50
PRINTAT 5, 1, "Your guess: " + guess#

WHILE NOT found?
  key$ = GETKEY$

  IF key$ = "ArrowUp" THEN
    guess# = guess# + 1
    SLEEP 0.1
  ELSE IF key$ = "ArrowDown" THEN
    guess# = guess# - 1
    SLEEP 0.1
  ELSE IF key$ = " " THEN
    guesses# = guesses# + 1

    IF guess# = secret# THEN
      found? = YES
      PRINT "You got it in " + guesses# + " guesses!"
    ELSE IF guess# < secret# THEN
      PRINT guess# + " is too low"
    ELSE
      PRINT guess# + " is too high"
    END IF
  END IF

  PRINTAT 5, 1, "Your guess: " + guess# + "   "
  SLEEP 0.016
END WHILE
```

## Common Mistakes

1. **Forgetting `END IF` / `END FOR` / `END WHILE`** — Every block needs its closing statement.

2. **Using lowercase keywords** — `print` won't work. Use `PRINT`.

3. **Forgetting the variable symbol** — `score` isn't valid. Use `score#` for a number, `score$` for text, etc.

4. **Array index starting at 0** — In SamBasic, arrays start at 1. `arr@[0]` will cause problems.

5. **Using `==` instead of `=`** — SamBasic uses a single `=` for comparisons. `IF x# == 5` is wrong; use `IF x# = 5 THEN`.

6. **Forgetting `THEN` after `IF`** — Every `IF` condition needs `THEN` after it.

7. **Infinite loops** — If your program freezes, you probably have a `WHILE` loop whose condition never becomes false. Press the stop button and check your loop logic.

## What Next?

Once you're comfortable with these basics, try:

- **Drawing graphics** — SamBasic has a 640x480 graphics canvas. See `graphics-reference.md`.
- **Making sounds** — Play music with the `PLAY` command. See `audio-reference.md`.
- **Building a game** — Check out `examples/snake.sam` for a complete game example.
- **Full language details** — See `language-reference.md` for everything SamBasic can do.
