// A small full-screen program for the terminal driver's tests. It draws a title, the hex of the
// last input it read, and the printable input so far. With `--kitty` it first turns on the kitty
// keyboard protocol, and with `--mask` it draws each typed character as `*`.
const kitty = process.argv.includes('--kitty');
const mask = process.argv.includes('--mask');
let lastHex = '-';
let typed = '';

function draw(): void {
  process.stdout.write(
    `\u001B[2J\u001B[H\u001B[1mEcho TUI\u001B[0m\r\nkeys: ${lastHex}\r\ntyped: ${typed}`,
  );
}

if (kitty) {
  process.stdout.write('\u001B[>1u');
}

process.stdin.setRawMode(true);

process.stdin.on('data', (chunk: Buffer) => {
  lastHex = chunk.toString('hex');

  for (const character of chunk.toString('utf8')) {
    if (character >= ' ' && character !== '\u007F') {
      typed += mask ? '*' : character;
    }
  }

  draw();
});

draw();

process.stdout.write('\r\nready');

// The pending read keeps the program alive until the driver stops it.
process.stdin.resume();
