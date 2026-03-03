# SamBasic Examples Cookbook

Short, copy-paste patterns for common tasks.

## Hello World

```
SETCOLOR LIGHTGREEN&
PRINT "Hello, World!"
```

## User Input

```
name$ = INPUT$ "What is your name? "
PRINT "Hello, " + name$ + "!"

age$ = INPUT$ "How old are you? "
age# = TONUMBER# age$
PRINT "In 10 years you'll be " + TOSTRING$ age# + 10
```

## Counting Loop

```
FOR i# FROM 1 TO 10
  PRINT "Line " + TOSTRING$ i#
END FOR
```

## Reverse Loop

```
FOR i# FROM 10 TO 1 STEP -1
  PRINT TOSTRING$ i# + "..."
END FOR
PRINT "Go!"
```

## While Loop with Exit

```
WHILE 1 = 1
  guess$ = INPUT$ "Guess a number (1-10): "
  IF TONUMBER# guess$ = 7 THEN
    PRINT "Correct!"
    BREAK
  END IF
  PRINT "Try again."
END WHILE
```

## Building and Using Arrays

```
names@ = ["Alice", "Bob", "Charlie"]

' Iterate
FOR i# FROM 1 TO LENGTH# names@
  PRINT TOSTRING$ i# + ": " + names@[i#]
END FOR

' Modify
APPEND names@, "Diana"
INSERT names@, 2, "Zoe"
REMOVE names@, 1
SORT names@
```

## 2D Array (Grid)

```
grid@ = SIZE 5, 5
FOR row# FROM 1 TO 5
  FOR col# FROM 1 TO 5
    grid@[row#][col#] = row# * col#
  END FOR
END FOR

PRINT grid@[3][4]    ' 12
```

## Structs

```
player& = {.name$ = "Hero", .hp# = 100, .x# = 5, .y# = 10}

PRINT player&.name$ + " has " + TOSTRING$ player&.hp# + " HP"
player&.hp# = player&.hp# - 25
```

## Custom Colors

```
' Predefined
SETCOLOR YELLOW&
PRINT "Yellow text"

' Custom
SETCOLOR {.r# = 255, .g# = 128, .b# = 0}
PRINT "Orange text"

' Inline per-print
PRINT "Danger!" COLOR RED&
PRINT "Safe" COLOR GREEN&
```

## Defining and Calling Functions

```
FUNCTION factorial# n#
  IF n# <= 1 THEN
    RETURN 1
  END IF
  RETURN n# * factorial# n# - 1
END FUNCTION

PRINT factorial# 5    ' 120
```

## Function with Named Parameters

```
FUNCTION greet$ NAME n$, OPTIONAL TITLE t$
  IF t$ = "" THEN
    RETURN "Hello, " + n$ + "!"
  END IF
  RETURN "Hello, " + t$ + " " + n$ + "!"
END FUNCTION

PRINT greet$ NAME "Smith", TITLE "Dr."
PRINT greet$ NAME "World"
```

## Function with REFERENCE

```
FUNCTION addItem list@, REFERENCE item$
  APPEND list@, item$
END FUNCTION

items@ = []
addItem items@, "sword"
addItem items@, "shield"
PRINT LENGTH# items@    ' 2
```

## Function with GLOBAL

```
score# = 0

FUNCTION addScore points#
  GLOBAL score#
  score# = score# + points#
END FUNCTION

addScore 10
addScore 25
PRINT score#    ' 35
```

## Play a Melody

```
' Simple scale
PLAY "T120 O4 L4 C D E F G A B >C"

' Dotted rhythm
PLAY "T100 O4 L4 E. L8 D L4 C. L8 D L2 E"

' Background music
PLAY "T140 O3 L4 C E G >C <G E C R", BACKGROUND YES, WAVE TRIANGLE
```

## Multi-Voice Music

```
PLAYPOLY (
  ["T130 O4 L4 E E F G G F E D" WAVE SQUARE]
  ["T130 O3 L2 C G E G" WAVE TRIANGLE]
)
```

Single-line also works: `PLAYPOLY ["..." WAVE SQUARE] ["..." WAVE TRIANGLE]`

For best results, keep voices at equal total beat counts so they stay in sync. Mismatched durations are allowed — shorter voices finish with silence.

## File Save/Load

```
' Save
f# = OPEN# FILE "save.txt" MODE WRITE
WRITEFILELINE FILE f#, LINE "Player: Sam"
WRITEFILELINE FILE f#, LINE "Score: " + TOSTRING$ score#
CLOSE f#

' Load
IF FILEEXISTS? "save.txt" THEN
  f# = OPEN# FILE "save.txt" MODE READ
  WHILE NOT ENDOFFILE? f#
    line$ = READFILELINE$ FILE f#
    PRINT line$
  END WHILE
  CLOSE f#
END IF
```

## Non-blocking Key Input (Games)

```
WHILE 1 = 1
  key$ = GETKEY$
  IF key$ = "ArrowUp" THEN
    y# = y# - 1
  ELSE IF key$ = "ArrowDown" THEN
    y# = y# + 1
  ELSE IF key$ = "Escape" THEN
    BREAK
  END IF
  SLEEP 0.016
END WHILE
```

## Basic Animation with Double Buffering

```
BUFFERENABLED YES
x# = 0

WHILE GETKEY$ = ""
  CLEARBUFFER

  SETCOLOR YELLOW&
  DRAWCIRCLE x#, 240, 20, YES

  SHOWBUFFER
  x# = x# + 2
  IF x# > 660 THEN
    x# = 0 - 20
  END IF
  SLEEP 0.016
END WHILE
```

## Creating and Drawing a Sprite

Using palette indices (see [color-reference.md](color-reference.md)):

```
BUFFERENABLED YES

' Build a 6x6 checkerboard sprite
' 15 = yellow, 5 = red, 0 = transparent
data@ = ([15,  5, 15,  5, 15,  5]
         [ 5, 15,  5, 15,  5, 15]
         [15,  5, 15,  5, 15,  5]
         [ 5, 15,  5, 15,  5, 15]
         [15,  5, 15,  5, 15,  5]
         [ 5, 15,  5, 15,  5, 15])

id# = CREATESPRITE# data@
DRAWSPRITE SPRITE id#, X 100, Y 100
SHOWBUFFER
```

Color structs also work — you can mix both in the same sprite:

```
data@ = ([{.r# = 255, .g# = 0, .b# = 0}, 15]
         [15, {.r# = 0, .g# = 255, .b# = 0}])
id# = CREATESPRITE# data@
```

## Bouncing Ball

```
BUFFERENABLED YES
x# = 100
y# = 100
dx# = 3
dy# = 2

WHILE GETKEY$ = ""
  x# = x# + dx#
  y# = y# + dy#
  IF x# < 15 OR x# > 625 THEN
    dx# = 0 - dx#
  END IF
  IF y# < 15 OR y# > 465 THEN
    dy# = 0 - dy#
  END IF

  CLEARBUFFER
  SETCOLOR WHITE&
  DRAWCIRCLE x#, y#, 15, YES
  SHOWBUFFER
  SLEEP 0.016
END WHILE
```

## Timing with RUNNINGTIME#

```
' Move at constant speed regardless of frame rate
lastTime# = RUNNINGTIME#

WHILE GETKEY$ = ""
  now# = RUNNINGTIME#
  dt# = (now# - lastTime#) / 1000
  lastTime# = now#

  x# = x# + speed# * dt#
  SLEEP 0.016
END WHILE
```

## Random Number in Range

```
' Random integer between min and max (inclusive)
FUNCTION randRange# LOW low#, HIGH high#
  RETURN low# + RANDOM# high# - low#
END FUNCTION

roll# = randRange# LOW 1, HIGH 6
```

## String Processing

```
text$ = "  Hello, World!  "
PRINT TRIM$ text$                              ' "Hello, World!"
PRINT UPPERCASE$ text$                         ' "  HELLO, WORLD!  "
PRINT LENGTH# text$                            ' 17
PRINT SUBSTRING$ text$, 9, 5                   ' "orld!"
PRINT CONTAINS? text$, "World"                 ' 1 (YES)
PRINT INDEXOF# text$, "World"                  ' 10
```

## Colored Text Dashboard

```
CLEARSCREEN
SETCOLOR WHITE&
PRINTAT 1, 30, "=== DASHBOARD ==="

SETCOLOR CYAN&
PRINTAT 3, 5, "Status:"
PRINTAT 3, 15, "ONLINE" COLOR LIGHTGREEN&

SETCOLOR CYAN&
PRINTAT 5, 5, "Score:"
PRINTAT 5, 15, "1,250" COLOR YELLOW&

SETCOLOR CYAN&
PRINTAT 7, 5, "Health:"
PRINTAT 7, 15, "LOW" COLOR LIGHTRED&
```
